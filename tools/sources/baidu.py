# -*- coding: utf-8 -*-
"""百度地图收藏适配器：登录态 + 页内取数 → 统一地点结构。"""

import html
import json
import os
import pathlib
import time

from playwright.sync_api import sync_playwright

from coord import bd09mc_to_bd09, bd09_to_gcj02
from sources.base import SourceError, epoch_to_iso, make_item, unique_tags

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
HOME = "https://map.baidu.com/"
FAV_URL = (
    "https://map.baidu.com/?newmap=1&reqflag=pcmap&biz=1&from=webmap"
    "&da_par=direct&pcevaname=pc4.1&qt=fav&mode=get&type=favdata"
    "&limit=5000&lastver=0"
)
PLACE_TYPES = ("10", "11")  # 10=POI 收藏，11=自定义点
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)


def resolve_profile(profile=None):
    return pathlib.Path(
        profile or os.environ.get("MN_BAIDU_PROFILE") or (ROOT / ".sync-profile" / "baidu")
    )


def logged_in(context):
    try:
        for cookie in context.cookies("https://map.baidu.com"):
            if cookie.get("name") == "BDUSS" and cookie.get("value"):
                return True
    except Exception:
        pass
    return False


def fetch_raw(page):
    """优先直接打开收藏数据地址；失败时回到地图页里 fetch（带 cookie/referer）。"""
    raw = ""
    try:
        page.goto(FAV_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        raw = page.inner_text("body")
    except Exception:
        raw = ""
    if raw.strip().startswith("{"):
        return raw
    page.goto(HOME, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)
    return page.evaluate(
        """async (url) => {
            const r = await fetch(url, { credentials: 'include' });
            return await r.text();
        }""",
        FAV_URL,
    )


def parse_payload(data):
    result = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict) or result.get("error") not in (0, "0", None):
        code = result.get("error") if isinstance(result, dict) else "?"
        raise SourceError("百度返回异常（error=%s），登录态可能已过期" % code)

    rows = (data.get("sync") or {}).get("newdata") or []
    items = []
    skipped = {"deleted": 0, "route": 0, "tagDef": 0, "noCoord": 0, "noName": 0}
    seen = set()

    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("action") or "").lower() == "del":
            skipped["deleted"] += 1
            continue
        body = (row.get("detail") or {}).get("data")
        if not isinstance(body, dict):
            continue
        kind = str(body.get("type") or "")
        if kind in ("20", "21"):
            skipped["route"] += 1
            continue
        if kind == "30":
            skipped["tagDef"] += 1
            continue
        if kind not in PLACE_TYPES:
            continue

        ext = body.get("extdata") or {}
        src = body.get("sourcedata") or {}
        name = html.unescape(str(ext.get("name") or src.get("name") or "").strip())
        if not name:
            skipped["noName"] += 1
            continue

        x, y = ext.get("geoptx"), ext.get("geopty")
        if x in (None, "") or y in (None, ""):
            point = ((src.get("ext") or {}).get("detail_info") or {}).get("point") or {}
            x, y = point.get("x"), point.get("y")
        if x in (None, "") or y in (None, ""):
            skipped["noCoord"] += 1
            continue
        try:
            bd_lng, bd_lat = bd09mc_to_bd09(float(x), float(y))
            gcj_lng, gcj_lat = bd09_to_gcj02(bd_lng, bd_lat)
        except (TypeError, ValueError):
            skipped["noCoord"] += 1
            continue
        if not (-180 <= gcj_lng <= 180 and -90 <= gcj_lat <= 90):
            skipped["noCoord"] += 1
            continue

        source_id = str(body.get("fid") or body.get("sourceid") or "")
        if not source_id:
            skipped["noName"] += 1
            continue
        if source_id in seen:
            continue
        seen.add(source_id)

        tags = []
        for tag in body.get("tags") or []:
            if isinstance(tag, dict):
                tags.append(tag.get("name"))
            else:
                tags.append(tag)
        address = (src.get("addr") or src.get("address") or ext.get("content") or "")
        items.append(make_item(
            source="baidu",
            source_id=source_id,
            name=name,
            address=address,
            lng=gcj_lng,
            lat=gcj_lat,
            tags=unique_tags(tags),
            raw_lng=bd_lng,
            raw_lat=bd_lat,
            raw_coord_sys="bd09",
            created_at=epoch_to_iso(body.get("ctime")),
        ))

    return items, skipped


def fetch(profile=None, headless=True, timeout=120, channel=None, user_agent=None):
    """返回 (items, skipped)。登录态失效时抛 SourceError。"""
    profile_path = resolve_profile(profile)
    if not profile_path.exists():
        raise SourceError("还没有百度登录态，请先扫码登录")

    with sync_playwright() as playwright:
        try:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_path),
                headless=headless,
                channel=channel,
                viewport={"width": 1100, "height": 800} if headless else None,
                no_viewport=not headless,
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                user_agent=user_agent or UA,
                args=["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"],
            )
        except Exception as exc:
            raise SourceError("浏览器启动失败：%s" % exc)

        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(HOME, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(1500)
            if not logged_in(context):
                raise SourceError("百度登录态已失效，请重新扫码登录")

            deadline = time.time() + max(30, timeout)
            raw = ""
            while time.time() < deadline:
                raw = fetch_raw(page)
                if raw and raw.strip().startswith("{"):
                    break
                page.wait_for_timeout(2500)
            if not raw or not raw.strip().startswith("{"):
                raise SourceError("百度收藏接口没有返回 JSON，登录态可能已过期")
            try:
                data = json.loads(raw)
            except ValueError:
                raise SourceError("百度收藏接口返回的不是合法 JSON")
            return parse_payload(data)
        except SourceError:
            raise
        except Exception as exc:
            raise SourceError("百度取数失败：%s" % exc)
        finally:
            try:
                context.close()
            except Exception:
                pass
