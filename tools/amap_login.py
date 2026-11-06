#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫码登录高德：无头浏览器打开登录页，把二维码截图写到 web/data/amap-qr.png。

用法（服务器上，由 /admin 页面触发）：
    python3 tools/amap_login.py

手机打开 /admin → 点「扫码登录高德」→ 用高德 App 扫页面上的二维码。
登录态保存在 .amap-profile/，之后由 tools/server_sync.py 复用。
"""

import argparse
import datetime
import json
import os
import pathlib
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from sync import FETCH_JS, collect_items, log  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = WEB / "data"
import paths  # noqa: E402

FAVES_URL = "https://www.amap.com/faves"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
TIMEOUT = int(os.environ.get("MN_LOGIN_TIMEOUT") or 300)

# 由 configure(uid) 设定：登录态目录、二维码、状态文件都按 uid 分开
UID = paths.default_uid()
PROFILE = paths.profile(UID, "amap")
QR = paths.qr(UID, "amap")
STATUS = paths.login_status(UID, "amap")


def configure(uid):
    global UID, PROFILE, QR, STATUS
    UID = uid or paths.default_uid()
    PROFILE = paths.profile(UID, "amap")
    QR = paths.qr(UID, "amap")
    STATUS = paths.login_status(UID, "amap")


configure(os.environ.get("MN_LOGIN_UID") or UID)


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def write_status(**fields):
    data = {"state": "pending", "checkedAt": now_iso()}
    try:
        old = json.loads(STATUS.read_text(encoding="utf-8"))
        if isinstance(old, dict):
            data.update(old)
    except (OSError, ValueError):
        pass
    data.update(fields)
    data["checkedAt"] = now_iso()
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=str(STATUS.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as writer:
            json.dump(data, writer, ensure_ascii=False, indent=2)
        os.replace(tmp, STATUS)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)


def save_shot(page, path):
    """优先截二维码本身（近似正方形的元素），截不到就截整页。"""
    try:
        for element in page.query_selector_all("img, canvas, [class*='qrcode'], [class*='qr-code']"):
            try:
                box = element.bounding_box()
            except Exception:
                continue
            if not box:
                continue
            width, height = box.get("width") or 0, box.get("height") or 0
            if width < 120 or height < 120 or width > 480 or height > 480:
                continue
            if abs(width - height) > 24:
                continue
            handle, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".qr-", suffix=".png")
            os.close(handle)
            element.screenshot(path=tmp)
            os.replace(tmp, path)
            return True
    except Exception:
        pass
    try:
        handle, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".qr-", suffix=".png")
        os.close(handle)
        page.screenshot(path=tmp)
        os.replace(tmp, path)
        return True
    except Exception as exc:
        log("截图失败：%s" % exc)
        return False


def mouse_click(page, selector):
    """用鼠标点元素中心（避免被浮层遮挡导致 Playwright 的点击检查超时）。"""
    try:
        element = page.query_selector(selector)
        if not element:
            return False
        box = element.bounding_box()
        if not box or box.get("width", 0) < 2:
            return False
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(700)
        return True
    except Exception:
        return False


def open_login(page):
    """点开登录入口：头像气泡 → 「登录」按钮 → 「扫码登录」文字，直到二维码出现。"""
    if page.query_selector("img[class*='qrcode']"):
        return
    if not mouse_click(page, "button.login-button"):
        mouse_click(page, "[class*='user-avatar']")
        mouse_click(page, "button.login-button")
    if page.query_selector("img[class*='qrcode']"):
        return
    for text in ("扫码登录", "二维码登录", "扫码", "登录"):
        try:
            page.get_by_text(text, exact=True).first.click(timeout=500)
            page.wait_for_timeout(800)
            if page.query_selector("img[class*='qrcode']"):
                return
        except Exception:
            continue


def logged_in(page):
    try:
        result = page.evaluate(FETCH_JS)
        if result and result.get("ok") and result.get("text"):
            return bool(collect_items(json.loads(result["text"])))
    except Exception:
        pass
    return False


def main():
    parser = argparse.ArgumentParser(description="扫码登录高德（按 uid 分开保存登录态）")
    parser.add_argument("--uid", default=os.environ.get("MN_LOGIN_UID") or paths.default_uid())
    args = parser.parse_args()
    configure(args.uid)
    paths.migrate_legacy(UID)

    QR.parent.mkdir(parents=True, exist_ok=True)
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    write_status(state="pending", loginRunning=True, error=None)
    if QR.exists():
        QR.unlink()

    headless = os.environ.get("MN_HEADLESS", "1") != "0"
    with sync_playwright() as playwright:
        try:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(PROFILE),
                headless=headless,
                channel=os.environ.get("MN_BROWSER_CHANNEL") or None,
                viewport={"width": 900, "height": 900},
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                user_agent=UA,
                args=["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"],
            )
        except Exception as exc:
            log("浏览器启动失败：%s" % exc)
            write_status(state="expired", loginRunning=False, error="浏览器启动失败：%s" % exc)
            return 1

        page = context.pages[0] if context.pages else context.new_page()
        try:
            log("打开高德收藏页…")
            page.goto(FAVES_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(3000)

            if logged_in(page):
                log("高德登录态仍然有效，无需扫码。")
                write_status(state="ok", loginRunning=False, error=None)
                return 0

            clicked = False
            deadline = time.time() + TIMEOUT
            while time.time() < deadline:
                if logged_in(page):
                    log("扫码登录成功。")
                    write_status(state="ok", loginRunning=False, error=None)
                    if QR.exists():
                        QR.unlink()
                    return 0

                if not clicked:
                    open_login(page)
                    if page.query_selector("img[class*='qrcode']"):
                        clicked = True
                        page.wait_for_timeout(600)

                for text in ("点击刷新", "刷新二维码", "刷新"):
                    try:
                        page.get_by_text(text, exact=True).first.click(timeout=300)
                        page.wait_for_timeout(800)
                        break
                    except Exception:
                        continue

                if save_shot(page, QR):
                    write_status(state="pending", loginRunning=True, qrUpdatedAt=now_iso(), error=None)
                page.wait_for_timeout(2500)

            log("等待扫码超时。")
            write_status(state="expired", loginRunning=False, error="扫码超时，请重新点「扫码登录高德」")
            return 2
        finally:
            try:
                context.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
