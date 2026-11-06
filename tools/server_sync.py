#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""服务器端多源同步：无头 Chromium 抓高德 + 百度收藏 → 写 web/data/favorites.json（v2）。

用法（服务器上）：
    python3 tools/server_sync.py

登录态来自 .sync-profile/（百度在 .sync-profile/baidu/；可用 MN_AMAP_PROFILE / MN_BAIDU_PROFILE 覆盖）。
单源失效只影响该源：保留该源上一次数据，其他源照常更新；全部失败时：
- 写 web/data/sync-status.json 供 /admin 页面显示；
- 若配置了 FEISHU_WEBHOOK，发一条飞书消息（同一故障 24 小时内只发一次）。
"""

import argparse
import datetime
import json
import os
import pathlib
import sys
import tempfile
import urllib.request

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import sync_all  # noqa: E402
import paths  # noqa: E402
import store  # noqa: E402
from sources.base import SOURCE_LABELS  # noqa: E402

DATA = ROOT / "web" / "data"
STATUS = DATA / "sync-status.json"
TIMEOUT = int(os.environ.get("MN_SYNC_TIMEOUT") or 120)

log = sync_all.log


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


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


def load_secrets():
    data = {}
    path = pathlib.Path(os.environ.get("MN_SECRETS_FILE", "/etc/map-notes/secrets.env"))
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    for key in ("FEISHU_WEBHOOK",):
        if os.environ.get(key):
            data[key] = os.environ[key]
    return data


def notify(text):
    url = load_secrets().get("FEISHU_WEBHOOK")
    if not url:
        log("未配置 FEISHU_WEBHOOK，跳过提醒")
        return
    payload = json.dumps({"msg_type": "text", "content": {"text": text}}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(request, timeout=8)
        log("已发飞书提醒")
    except Exception as exc:
        log("飞书提醒发送失败：%s" % exc)


def report(ok, error=None, count=None, sources=None, uid=None):
    previous = (store.get_kv(uid, "sync_status") or {}) if uid else read_json(STATUS)
    failures = 0 if ok else int(previous.get("consecutiveFailures") or 0) + 1
    data = {
        "ok": ok,
        "running": False,
        "lastAttemptAt": now_iso(),
        "lastSuccessAt": now_iso() if ok else previous.get("lastSuccessAt"),
        "error": error,
        "consecutiveFailures": failures,
        "count": count if count is not None else previous.get("count"),
        "sources": sources if isinstance(sources, dict) else previous.get("sources"),
        "notifiedAt": previous.get("notifiedAt"),
    }

    if not ok:
        last_notice = previous.get("notifiedAt")
        should_notify = True
        if last_notice:
            try:
                stamp = datetime.datetime.fromisoformat(last_notice)
                if stamp.tzinfo is None:
                    stamp = stamp.astimezone()
                should_notify = (datetime.datetime.now().astimezone() - stamp).total_seconds() > 24 * 3600
            except ValueError:
                pass
        if should_notify:
            notify(
                "map-notes 收藏同步失败：%s\n打开 https://map.chesterlee.cn/admin 检查高德 / 百度登录态。"
                % (error or "未知原因")
            )
            data["notifiedAt"] = now_iso()

    write_json(STATUS, data)
    if uid:
        store.set_kv(uid, "sync_status", data)
    return data


def source_error_text(statuses, names):
    parts = []
    for name in names:
        meta = statuses.get(name) or {}
        label = SOURCE_LABELS.get(name, name)
        parts.append("%s：%s" % (label, meta.get("error") or meta.get("status") or "失败"))
    return "；".join(parts)


def main():
    parser = argparse.ArgumentParser(description="服务器端同步某个用户的收藏")
    parser.add_argument("--uid", default=paths.default_uid(), help="同步哪个用户（默认 %(default)s）")
    args = parser.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    uid = args.uid
    paths.migrate_legacy(uid)
    profiles = {name: paths.profile(uid, name) for name in SOURCE_LABELS}
    write_json(STATUS, dict(read_json(STATUS), running=True, ok=None, lastAttemptAt=now_iso()))
    store.set_kv(uid, "sync_status", dict(store.get_kv(uid, "sync_status") or {},
                                          running=True, ok=None, lastAttemptAt=now_iso()))

    headless = os.environ.get("MN_HEADLESS", "1") != "0"
    try:
        output, _ = sync_all.run(
            selected=list(SOURCE_LABELS),
            headless=headless,
            timeout=TIMEOUT,
            channel=os.environ.get("MN_BROWSER_CHANNEL") or None,
            uid=uid,
            profiles=profiles,
        )
    except Exception as exc:
        log("同步异常：%s" % exc)
        report(False, "同步异常：%s" % exc, uid=uid)
        return 1

    if output is None:
        report(False, "所有来源都没有可用数据，保留旧文件", uid=uid)
        return 2

    statuses = output.get("sources") or {}
    ok_names = [name for name in SOURCE_LABELS if (statuses.get(name) or {}).get("status") == "ok"]
    failed_names = [
        name for name in SOURCE_LABELS
        if (statuses.get(name) or {}).get("status") in ("error", "not_configured")
    ]

    if ok_names:
        if failed_names:
            log("部分来源失败：%s" % source_error_text(statuses, failed_names))
            report(True, "部分来源失败：" + source_error_text(statuses, failed_names),
                   output.get("count"), statuses, uid=uid)
        else:
            report(True, None, output.get("count"), statuses, uid=uid)
        return 0

    message = source_error_text(statuses, failed_names) or "未知原因"
    log("全部来源失败：%s" % message)
    report(False, message, output.get("count"), statuses, uid=uid)
    return 2


if __name__ == "__main__":
    sys.exit(main())
