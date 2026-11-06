#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把高德网页版「我的收藏」抓成本地 JSON。

用法：
    python3 tools/sync.py
    python3 tools/sync.py --upload   # 抓完顺带同步到服务器（收藏上传 + 备注拉回）

首次运行会弹出真实 Chrome 窗口，请在窗口里扫码登录高德（登录/验证码由你本人完成），
登录成功后脚本自动继续。登录态保存在 .sync-profile/（已忽略，不会入库）。

产物：web/data/favorites.json
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".sync-profile"
OUT = ROOT / "web" / "data" / "favorites.json"
RAW_DEBUG = ROOT / "web" / "data" / "_raw_cloudSync.json"
FAVES_URL = "https://www.amap.com/faves"
ZOOM = 20  # 高德 point_x / point_y 的缩放级别（实测 z=20）

# --upload 用：把收藏推上服务器，并把服务器上的备注拉回本机（服务器为准）
SSH_KEY = os.path.expanduser("~/.ssh/chesterlee_web")
REMOTE = "ubuntu@43.136.92.125:/srv/chesterlee/map/web/data/"
NOTES = ROOT / "web" / "data" / "notes.json"

# 在页面内请求收藏接口：带上登录态，返回原始文本
# 2026-11：高德把收藏接口从 /ssr/api/cloudSync 换成了 /service/fav/getFav（旧地址现在返回网页 HTML）
FAV_URLS = ("/service/fav/getFav", "/ssr/api/cloudSync")
FETCH_JS = r"""
async () => {
  let last = null;
  for (const url of ['/service/fav/getFav', '/ssr/api/cloudSync']) {
    try {
      const r = await fetch(url, {
        credentials: 'include',
        headers: { 'accept': 'application/json, text/plain, */*' }
      });
      const text = await r.text();
      const head = text.trim().slice(0, 1);
      if (r.ok && (head === '{' || head === '[')) {
        return { ok: true, status: r.status, text: text, url: url };
      }
      last = { ok: false, status: r.status, text: text, url: url };
    } catch (e) {
      last = { ok: false, error: String(e), url: url };
    }
  }
  return last || { ok: false, error: '空返回' };
}
"""

# 判断一条记录像不像「地点」：至少命中两个关键字段
ITEM_KEYS = (
    "name", "custom_name", "lon", "lng", "latitude", "lat",
    "point_x", "point_y", "item_id", "poi_id", "address",
)


def log(msg):
    print("[sync] " + msg, flush=True)


def to_float(value):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or math.isinf(num):
        return None
    return num


def pick(item, *keys):
    """按顺序返回第一个有值的字段。"""
    for key in keys:
        value = item.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def mercator_to_lnglat(point_x, point_y, zoom=ZOOM):
    """按 Web Mercator（高德/谷歌同一套）把像素坐标反算成经纬度。"""
    world = 256.0 * (2 ** zoom)
    lng = point_x / world * 360.0 - 180.0
    mercator = math.pi * (1.0 - 2.0 * point_y / world)
    lat = math.degrees(math.atan(math.sinh(mercator)))
    return lng, lat


def parse_coords(item):
    """返回 (lng, lat, 来源) 或 None。lon/lat 优先，其次 location 字符串，最后像素反算。"""
    lng = to_float(pick(item, "lon", "lng", "longitude"))
    lat = to_float(pick(item, "lat", "latitude"))
    if lng is not None and lat is not None and abs(lng) <= 180 and abs(lat) <= 90:
        return lng, lat, "lonlat"

    location = pick(item, "location", "poi_location")
    if isinstance(location, str) and "," in location:
        parts = location.split(",")
        if len(parts) >= 2:
            lng, lat = to_float(parts[0]), to_float(parts[1])
            if lng is not None and lat is not None and abs(lng) <= 180 and abs(lat) <= 90:
                return lng, lat, "location"

    point_x = to_float(pick(item, "point_x", "pointX"))
    point_y = to_float(pick(item, "point_y", "pointY"))
    if point_x is not None and point_y is not None and point_x != 0 and point_y != 0:
        lng, lat = mercator_to_lnglat(point_x, point_y)
        if abs(lng) <= 180 and abs(lat) <= 90:
            return lng, lat, "point"

    return None


def parse_tags(item):
    raw = pick(item, "tag", "tags", "item_tag", "label", "labels")
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        parts = [str(x) for x in raw]
    else:
        parts = re.split(r"[,，、/|;；]+", str(raw))
    tags = []
    for part in parts:
        part = part.strip()
        if part and part not in tags:
            tags.append(part)
    return tags


def parse_created_at(item):
    raw = pick(item, "create_time", "createTime", "ctime")
    if raw is None:
        return None
    try:
        num = float(raw)
    except (TypeError, ValueError):
        return None
    if num > 1e12:  # 毫秒
        num = num / 1000.0
    if not 1e9 < num < 2e9:
        return None
    return datetime.datetime.fromtimestamp(num).astimezone().isoformat(timespec="seconds")


def item_id_of(item, name, lng, lat):
    raw = pick(item, "item_id", "poi_id", "poiid", "id", "sid", "fid", "uid", "data_id")
    if raw not in (None, ""):
        return str(raw)
    seed = "%s|%s|%.6f,%.6f" % (name, pick(item, "address", "custom_address") or "", lng, lat)
    return "h" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def find_item_lists(node, found, depth=0):
    """递归找出所有「像地点列表」的数组。接口结构可能改，所以不写死路径。"""
    if depth > 10:
        return
    if isinstance(node, list):
        if node and all(isinstance(x, dict) for x in node):
            first = node[0]
            probe = first.get("data") if isinstance(first.get("data"), dict) else first
            hits = sum(1 for key in ITEM_KEYS if key in probe)
            if hits >= 2:
                found.append(node)
        for child in node:
            find_item_lists(child, found, depth + 1)
    elif isinstance(node, dict):
        for child in node.values():
            find_item_lists(child, found, depth + 1)


def collect_items(payload):
    lists = []
    find_item_lists(payload, lists)
    seen_lists = set()
    merged = []
    for group in lists:
        key = id(group)
        if key in seen_lists:
            continue
        seen_lists.add(key)
        merged.extend(group)
    return merged


def normalize(items):
    """把原始记录转成页面要的字段；跳过没有坐标/名称的记录。

    接口返回的是「变更流」：每条是 {type, id, act, ts, data}，同一 id 可能有多条，
    取时间最新的一条；act 为 d 表示已删除，直接丢弃。
    """
    result = []
    seen = set()
    skipped = {"noCoord": 0, "noName": 0, "duplicate": 0, "deleted": 0}
    point_sources = {"lonlat": 0, "location": 0, "point": 0}

    latest = {}
    for raw in items:
        if not isinstance(raw, dict):
            continue
        body = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        rid = pick(body, "item_id", "poi_id", "poiid", "id", "fid", "sid")
        key = str(rid) if rid not in (None, "") else "obj%d" % id(raw)
        ts = to_float(raw.get("ts")) or 0.0
        prev = latest.get(key)
        if prev is None or ts >= prev[0]:
            latest[key] = (ts, body, str(raw.get("act") or "u").lower())

    for _, raw, act in sorted(latest.values(), key=lambda x: x[0]):
        if act == "d":
            skipped["deleted"] += 1
            continue
        name = pick(raw, "custom_name", "name", "poi_name", "title")
        coords = parse_coords(raw)
        if not name:
            skipped["noName"] += 1
            continue
        if not coords:
            skipped["noCoord"] += 1
            continue
        lng, lat, source = coords
        uid = item_id_of(raw, str(name), lng, lat)
        if uid in seen:
            skipped["duplicate"] += 1
            continue
        seen.add(uid)
        point_sources[source] += 1
        item = {
            "id": uid,
            "name": str(name).strip(),
            "address": str(pick(raw, "custom_address", "address", "poi_address", "addr") or "").strip(),
            "lng": round(lng, 6),
            "lat": round(lat, 6),
            "tags": parse_tags(raw),
        }
        created_at = parse_created_at(raw)
        if created_at:
            item["createdAt"] = created_at
        result.append(item)

    return result, skipped, point_sources


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def upload(path):
    """把 favorites.json 推上服务器，再把服务器上的 notes.json 拉回本机。"""
    if not os.path.exists(SSH_KEY):
        log("找不到 SSH 私钥 %s，跳过上传。" % SSH_KEY)
        return False
    push = subprocess.run(
        ["scp", "-q", "-i", SSH_KEY, str(path), REMOTE + "favorites.json"],
        capture_output=True, text=True,
    )
    if push.returncode != 0:
        log("上传失败：%s" % (push.stderr.strip() or push.returncode))
        return False
    log("已上传到服务器：%sfavorites.json" % REMOTE)

    pull = subprocess.run(
        ["scp", "-q", "-i", SSH_KEY, REMOTE + "notes.json", str(NOTES)],
        capture_output=True, text=True,
    )
    if pull.returncode == 0:
        log("已把服务器备注拉回本机：%s" % NOTES)
    else:
        log("服务器还没有 notes.json，本机备注保持不变。")
    return True


def fetch_once(page):
    try:
        result = page.evaluate(FETCH_JS)
    except Exception as exc:  # 页面被关闭 / 跳转中
        return None, {"error": str(exc)}
    if not result or not result.get("ok"):
        return None, result or {"error": "空返回"}
    try:
        return json.loads(result["text"]), result
    except ValueError:
        return None, {"error": "返回内容不是 JSON", "status": result.get("status")}


def wait_for_payload(page, timeout, captured):
    deadline = time.time() + timeout
    last_hint = 0.0
    last_visit = time.time()
    info = None

    while time.time() < deadline:
        if captured["payload"] and collect_items(captured["payload"]):
            return captured["payload"]
        payload, info = fetch_once(page)
        if payload:
            if collect_items(payload):
                return payload
            captured["last"] = payload

        now = time.time()
        if now - last_hint > 15:
            hint = ""
            if captured["last"]:
                last = captured["last"]
                hint = "（最近返回 items=%d, code=%s, msg=%s）" % (
                    len(last.get("items") or []) if isinstance(last, dict) else 0,
                    last.get("code") if isinstance(last, dict) else "?",
                    str(last.get("message") if isinstance(last, dict) else "")[:40],
                )
            elif info:
                hint = "（请求异常：%s）" % str(info)[:150]
            log("等待收藏数据…请在 Chrome 窗口里登录高德；已登录会自动继续" + hint)
            last_hint = now

        # 长时间没数据就重进收藏页：登录后页面可能停留在旧的未登录状态
        try:
            url = page.url or ""
        except Exception:
            log("Chrome 窗口已关闭，已中止")
            return None
        if "passport" not in url and now - last_visit > 30:
            try:
                page.goto(FAVES_URL, wait_until="domcontentloaded", timeout=30000)
                last_visit = now
            except Exception:
                pass

        time.sleep(3)

    return None


def main():
    parser = argparse.ArgumentParser(description="高德收藏 → web/data/favorites.json")
    parser.add_argument("--timeout", type=int, default=600, help="等待登录/数据的秒数，默认 600")
    parser.add_argument("--debug", action="store_true", help="把接口原始返回另存一份，便于排查字段变化")
    parser.add_argument("--force", action="store_true", help="解析出的点很少时仍覆盖旧数据")
    parser.add_argument("--upload", action="store_true", help="抓完把 favorites.json 传到服务器，并拉回服务器备注")
    args = parser.parse_args()

    PROFILE.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    log("启动本机 Chrome（可见窗口）…")
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            channel="chrome",
            headless=False,
            no_viewport=True,
            args=["--start-maximized"],
        )
        pages = context.pages
        page = pages[0] if pages else context.new_page()

        # 页面自己加载收藏时也会请求收藏接口，顺手截下来（比主动 fetch 更稳）
        captured = {"payload": None, "last": None}

        def on_response(response):
            try:
                if any(url in response.url for url in FAV_URLS) and response.status == 200:
                    data = response.json()
                    if data:
                        captured["payload"] = data
            except Exception:
                pass

        page.on("response", on_response)

        try:
            log("打开高德收藏页：" + FAVES_URL)
            page.goto(FAVES_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception as exc:
            log("打开收藏页失败：%s" % exc)

        payload = wait_for_payload(page, args.timeout, captured)
        if payload is None:
            if args.debug and captured["last"]:
                save_json(RAW_DEBUG, captured["last"])
                log("原始返回已保存：%s（里面没有地点，通常是还没登录）" % RAW_DEBUG)
            log("没有拿到数据。请确认已登录高德、能正常打开收藏页，然后重跑本脚本。")
            context.close()
            return 1

        if args.debug:
            save_json(RAW_DEBUG, payload)
            log("原始返回已保存：%s" % RAW_DEBUG)

        raw_items = collect_items(payload)
        if not raw_items:
            log("返回里没有找到地点列表，疑似接口结构变化。为保护旧数据，本次不覆盖。")
            if not args.debug:
                log("可加 --debug 再跑一次，把原始返回存下来排查。")
            context.close()
            return 2

        items, skipped, sources = normalize(raw_items)
        log(
            "解析：原始 %d 条 → 有效 %d 个点（坐标来源 lonlat=%d, 像素反算=%d）"
            % (len(raw_items), len(items), sources["lonlat"], sources["point"])
        )
        if skipped["noName"] or skipped["noCoord"] or skipped["duplicate"] or skipped["deleted"]:
            log(
                "跳过：无名称 %d、无坐标 %d（含收藏夹）、重复 %d、已删除 %d"
                % (skipped["noName"], skipped["noCoord"], skipped["duplicate"], skipped["deleted"])
            )

        if not items:
            log("没有可写入的点，保留旧数据。")
            context.close()
            return 2

        old_count = 0
        if OUT.exists():
            try:
                old = json.loads(OUT.read_text(encoding="utf-8"))
                old_count = int(old.get("count") or 0)
            except Exception:
                old_count = 0

        if not args.force and old_count and len(items) < old_count * 0.5:
            log(
                "本次只解析出 %d 个点，旧数据有 %d 个，差距过大。为保护旧数据未覆盖；确认无误可加 --force。"
                % (len(items), old_count)
            )
            context.close()
            return 2

        output = {
            "schemaVersion": 1,
            "source": "amap.com /ssr/api/cloudSync",
            "syncedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "count": len(items),
            "skipped": skipped,
            "items": items,
        }
        save_json(OUT, output)
        log("已写入 %s（%d 个点）" % (OUT, len(items)))

        for sample in items[:3]:
            log(
                "示例：%s  %.5f,%.5f  %s"
                % (sample["name"], sample["lng"], sample["lat"], "、".join(sample["tags"]))
            )

        if args.upload:
            upload(OUT)

        context.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
