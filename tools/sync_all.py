#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多地图源收藏同步：逐源取数 → 跨源去重 → 写数据库（v2，按 uid）。

用法：
    python3 tools/sync_all.py               # 本机可见 Chrome，同步全部启用的源
    python3 tools/sync_all.py --source baidu
    python3 tools/sync_all.py --headless    # 服务器无头模式

约定：
- 单源失败只影响该源：保留该源上一次数据，其他源照常更新；
- 新解析出的点少于上次一半时不覆盖（--force 可强制）；
- 数据只落本机 web/data/，不上传、不写日志。
"""

import argparse
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import sync as amap_sync  # noqa: E402
import paths  # noqa: E402
import store  # noqa: E402
from sources import amap, baidu  # noqa: E402
from sources.base import (  # noqa: E402
    DEDUPE_METERS, SOURCE_LABELS, SOURCE_ORDER, SourceError, haversine, now_iso,
)

DATA = ROOT / "web" / "data"
OUT = DATA / "favorites.json"
V1_BACKUP = ROOT / "data" / "favorites-v1-backup.json"

ADAPTERS = {"amap": amap, "baidu": baidu}

log = amap_sync.log

_BRACKETS = re.compile(r"[（(【\[].*?[）)】\]]")
_PUNCT = re.compile(r"[\s·•\-—_、,，.。:：;；/\\|+\"'“”‘’!！?？]+")


def read_json(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as writer:
            json.dump(data, writer, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def norm_name(value):
    """名称归一：去掉括号内容、空格与标点，用于跨源判断是否同一地点。"""
    text = _BRACKETS.sub("", str(value or ""))
    return _PUNCT.sub("", text).lower()


def similar_name(a, b):
    if not a or not b:
        return False
    return a == b or a in b or b in a


def default_uid():
    """数据归属：MN_SYNC_UID > MN_OWNER_UID 第一个 > local（本机单用户）。"""
    return paths.default_uid()


def load_previous(uid=None):
    """读该 uid 上一次的收藏 → {source: [items]}；库里没有就回退旧 favorites.json。"""
    raw_items = None
    if uid:
        raw_items = store.get_favorites(uid).get("items")
    if not raw_items:
        raw_items = read_json(OUT).get("items")
    if not isinstance(raw_items, list):
        return {}
    grouped = {}
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "amap")
        grouped.setdefault(source, []).append(item)
    return grouped


def backup_v1():
    if not OUT.exists():
        return
    if int(read_json(OUT).get("schemaVersion") or 0) != 1:
        return
    if V1_BACKUP.exists():
        return
    V1_BACKUP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(str(OUT), str(V1_BACKUP))
    log("已备份 v1 数据：%s" % V1_BACKUP)


def merge_sources(groups):
    """跨源去重：距离 ≤ 50 m 且名称归一后相同/包含才合并；宁可少合并不错合并。"""
    merged = []
    keys = []
    for source in SOURCE_ORDER:
        for item in groups.get(source) or []:
            item = dict(item)
            item.setdefault("mergedFrom", [])
            name_key = norm_name(item.get("name"))
            target_index = None
            for index, existing in enumerate(merged):
                if source in (existing.get("sources") or [existing.get("source")]):
                    continue
                if not similar_name(name_key, keys[index]):
                    continue
                try:
                    distance = haversine(
                        float(item["lng"]), float(item["lat"]),
                        float(existing["lng"]), float(existing["lat"]),
                    )
                except (KeyError, TypeError, ValueError):
                    continue
                if distance <= DEDUPE_METERS:
                    target_index = index
                    break

            if target_index is None:
                merged.append(item)
                keys.append(name_key)
                continue

            target = merged[target_index]
            sources = list(target.get("sources") or [target.get("source")])
            for value in item.get("sources") or [item.get("source")]:
                if value and value not in sources:
                    sources.append(value)
            target["sources"] = [s for s in SOURCE_ORDER if s in sources]
            target.setdefault("sourceIds", {}).update(item.get("sourceIds") or {})
            tags = list(target.get("tags") or [])
            for tag in item.get("tags") or []:
                if tag not in tags:
                    tags.append(tag)
            target["tags"] = tags
            target.setdefault("mergedFrom", []).append(item.get("id"))

    return merged


def run(selected=None, headless=True, timeout=120, force=False, channel=None, uid=None, profiles=None):
    """同步指定来源并写数据。返回 (output, exit_code)；output 为 None 表示没写。

    uid 不为空时写入该用户的数据（SQLite），否则只写 web/data/favorites.json。
    profiles 形如 {"amap": <登录态目录>, "baidu": <登录态目录>}，按用户传。
    """
    selected = list(selected or SOURCE_ORDER)

    previous = load_previous(uid)
    previous_counts = {name: len(previous.get(name) or []) for name in SOURCE_ORDER}
    if uid:
        previous_sources = (store.get_kv(uid, "favorites_meta") or {}).get("sources") or {}
    else:
        previous_sources = read_json(OUT).get("sources") or {}

    if channel is None and not headless:
        channel = "chrome"

    groups = {}
    statuses = {}
    for name in SOURCE_ORDER:
        label = SOURCE_LABELS.get(name, name)
        old_count = previous_counts.get(name, 0)
        previous_meta = previous_sources.get(name) or {}

        if name not in selected:
            statuses[name] = {
                "syncedAt": previous_meta.get("syncedAt"),
                "status": "skipped",
                "count": old_count,
            }
            groups[name] = previous.get(name) or []
            continue

        log("同步%s…" % label)
        try:
            items, skipped = ADAPTERS[name].fetch(
                headless=headless, timeout=timeout, channel=channel,
                profile=(profiles or {}).get(name),
            )
        except SourceError as exc:
            message = str(exc)
            log("%s失败：%s" % (label, message))
            statuses[name] = {
                "syncedAt": previous_meta.get("syncedAt"),
                "status": "not_configured" if message.startswith("还没有") else "error",
                "count": old_count,
                "error": message,
            }
            groups[name] = previous.get(name) or []
            continue
        except Exception as exc:  # 适配器里的未预期异常也不拖垮其他源
            message = "未预期错误：%s" % exc
            log("%s失败：%s" % (label, message))
            statuses[name] = {
                "syncedAt": previous_meta.get("syncedAt"),
                "status": "error",
                "count": old_count,
                "error": message,
            }
            groups[name] = previous.get(name) or []
            continue

        if not items:
            log("%s没有解析出地点，保留上一次数据" % label)
            statuses[name] = {
                "syncedAt": previous_meta.get("syncedAt"),
                "status": "error",
                "count": old_count,
                "error": "本次没有解析出地点，保留上一次数据",
            }
            groups[name] = previous.get(name) or []
            continue

        if not force and old_count and len(items) < old_count * 0.5:
            log("%s本次只有 %d 个点，上次 %d 个，差距过大，保留旧数据" % (label, len(items), old_count))
            statuses[name] = {
                "syncedAt": previous_meta.get("syncedAt"),
                "status": "error",
                "count": old_count,
                "error": "本次点数不到上次一半，为保护旧数据未覆盖",
            }
            groups[name] = previous.get(name) or []
            continue

        groups[name] = items
        statuses[name] = {
            "syncedAt": now_iso(),
            "status": "ok",
            "count": len(items),
            "skipped": skipped,
        }
        log("%s解析到 %d 个地点" % (label, len(items)))

    merged = merge_sources(groups)
    if not merged:
        log("所有来源都没有数据，保留旧文件不动")
        return {
            "schemaVersion": 2,
            "syncedAt": now_iso(),
            "count": 0,
            "sources": statuses,
            "items": [],
            "written": False,
        }, 2

    merged_count = sum(len(groups.get(name) or []) for name in SOURCE_ORDER)
    merged_pairs = merged_count - len(merged)
    log("合并：%d 个原始点 → %d 个地点（跨源合并 %d 对）" % (merged_count, len(merged), merged_pairs))

    backup_v1()
    output = {
        "schemaVersion": 2,
        "syncedAt": now_iso(),
        "count": len(merged),
        "sources": statuses,
        "items": merged,
    }
    if uid:
        stored = store.replace_favorites(uid, output)
        log("已写入数据库（uid=%s，%d 个地点）" % (uid, stored))
    else:
        write_json(OUT, output)
        log("已写入 %s（%d 个地点）" % (OUT, len(merged)))

    for name in SOURCE_ORDER:
        meta = statuses[name]
        if meta["status"] == "ok":
            log("  %s：%d 个" % (SOURCE_LABELS.get(name, name), meta["count"]))
    return output, 0


def main():
    parser = argparse.ArgumentParser(description="多地图源收藏 → web/data/favorites.json（v2）")
    parser.add_argument("--source", default="", help="只同步指定源，逗号分隔：amap,baidu")
    parser.add_argument("--timeout", type=int, default=120, help="单个源等待数据的秒数，默认 120")
    parser.add_argument("--headless", action="store_true", help="无头模式（服务器用）")
    parser.add_argument("--force", action="store_true", help="点数明显变少时仍覆盖旧数据")
    parser.add_argument("--uid", default=default_uid(), help="数据写进哪个用户（默认 %(default)s）")
    args = parser.parse_args()

    selected = [s.strip() for s in args.source.split(",") if s.strip()] or list(SOURCE_ORDER)
    unknown = [s for s in selected if s not in ADAPTERS]
    if unknown:
        log("不认识的来源：%s（可选：%s）" % ("、".join(unknown), "、".join(SOURCE_ORDER)))
        return 1

    channel = os.environ.get("MN_BROWSER_CHANNEL") or (None if args.headless else "chrome")
    paths.migrate_legacy(args.uid)
    _, code = run(
        selected=selected,
        headless=args.headless,
        timeout=args.timeout,
        force=args.force,
        channel=channel,
        uid=args.uid,
        profiles={name: paths.profile(args.uid, name) for name in SOURCE_ORDER},
    )
    return code


if __name__ == "__main__":
    sys.exit(main())
