# -*- coding: utf-8 -*-
"""高德收藏适配器：复用 tools/sync.py 的登录态、接口与解析逻辑。"""

import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

TOOLS = pathlib.Path(__file__).resolve().parent.parent
ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import sync as amap_sync  # noqa: E402
from sources.base import SourceError, make_item  # noqa: E402


def resolve_profile(profile=None):
    return pathlib.Path(profile or os.environ.get("MN_AMAP_PROFILE") or (ROOT / ".sync-profile"))


def fetch(profile=None, headless=True, timeout=120, channel=None, user_agent=None):
    """返回 (items, skipped)。登录态失效时抛 SourceError。"""
    profile_path = resolve_profile(profile)
    if not profile_path.exists():
        raise SourceError("还没有高德登录态，请先扫码登录")

    captured = {"payload": None, "last": None}
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
                user_agent=user_agent,
                args=["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"],
            )
        except Exception as exc:
            raise SourceError("浏览器启动失败：%s" % exc)

        page = context.pages[0] if context.pages else context.new_page()

        def on_response(response):
            try:
                if any(url in response.url for url in amap_sync.FAV_URLS) and response.status == 200:
                    payload = response.json()
                    if payload:
                        captured["payload"] = payload
            except Exception:
                pass

        page.on("response", on_response)
        try:
            page.goto(amap_sync.FAVES_URL, wait_until="domcontentloaded", timeout=60000)
            payload = amap_sync.wait_for_payload(page, timeout, captured)
        except Exception as exc:
            raise SourceError("打开高德收藏页失败：%s" % exc)
        finally:
            try:
                context.close()
            except Exception:
                pass

    if payload is None:
        raise SourceError("高德登录态可能已过期，请重新扫码登录")
    raw_items = amap_sync.collect_items(payload)
    if not raw_items:
        raise SourceError("高德返回里没有地点，登录态可能已过期")

    items, skipped, point_sources = amap_sync.normalize(raw_items)
    out = []
    for item in items:
        out.append(make_item(
            source="amap",
            source_id=item["id"],
            name=item["name"],
            address=item.get("address") or "",
            lng=item["lng"],
            lat=item["lat"],
            tags=item.get("tags"),
            raw_lng=item["lng"],
            raw_lat=item["lat"],
            raw_coord_sys="gcj02",
            created_at=item.get("createdAt"),
        ))
    skipped = dict(skipped or {})
    skipped["pointSources"] = point_sources
    return out, skipped
