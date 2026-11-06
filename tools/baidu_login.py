#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫码登录百度：服务器上无头打开百度 Passport 登录页，把二维码截图写到 web/data/baidu-qr.png。

用法（服务器上，由 /admin 页面触发）：
    python3 tools/baidu_login.py

手机打开 /admin → 点「扫码登录百度」→ 用百度 App 扫页面上的二维码。
登录态保存在 .sync-profile/baidu/（可用 MN_BAIDU_PROFILE 覆盖），之后由 tools/server_sync.py 复用。
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

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from sync import log  # noqa: E402

DATA = ROOT / "web" / "data"
import paths  # noqa: E402

LOGIN_URL = "https://passport.baidu.com/v2/?login&tpl=mn&u=https%3A%2F%2Fmap.baidu.com%2F"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
TIMEOUT = int(os.environ.get("MN_LOGIN_TIMEOUT") or 300)
QR_SELECTORS = ("img.tang-pass-qrcode-img", "#TANGRAM__PSP_3__QrcodeMain")

# 由 configure(uid) 设定：登录态目录、二维码、状态文件都按 uid 分开
UID = paths.default_uid()
PROFILE = paths.profile(UID, "baidu")
QR = paths.qr(UID, "baidu")
STATUS = paths.login_status(UID, "baidu")


def configure(uid):
    global UID, PROFILE, QR, STATUS
    UID = uid or paths.default_uid()
    PROFILE = paths.profile(UID, "baidu")
    QR = paths.qr(UID, "baidu")
    STATUS = paths.login_status(UID, "baidu")


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


def logged_in(context):
    try:
        for cookie in context.cookies("https://map.baidu.com"):
            if cookie.get("name") == "BDUSS" and cookie.get("value"):
                return True
    except Exception:
        pass
    return False


def save_qr(page):
    """截二维码元素；截不到就返回 False，下一轮再试。"""
    for selector in QR_SELECTORS:
        element = page.query_selector(selector)
        if not element:
            continue
        try:
            box = element.bounding_box()
            if not box or box.get("width", 0) < 80:
                continue
            handle, tmp = tempfile.mkstemp(dir=str(QR.parent), prefix=".qr-", suffix=".png")
            os.close(handle)
            element.screenshot(path=tmp)
            os.replace(tmp, QR)
            return True
        except Exception:
            continue
    return False


def refresh_qr(page):
    for text in ("刷新", "点击刷新", "刷新二维码"):
        try:
            page.get_by_text(text, exact=True).first.click(timeout=500)
            page.wait_for_timeout(800)
            return True
        except Exception:
            continue
    return False


def main():
    parser = argparse.ArgumentParser(description="扫码登录百度（按 uid 分开保存登录态）")
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
                viewport={"width": 1200, "height": 820},
                device_scale_factor=2,
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
            log("打开百度登录页…")
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(3000)

            if logged_in(context):
                log("百度登录态仍然有效，无需扫码。")
                write_status(state="ok", loginRunning=False, error=None)
                return 0

            deadline = time.time() + TIMEOUT
            qr_saved = False
            while time.time() < deadline:
                if logged_in(context):
                    log("扫码登录成功。")
                    page.goto("https://map.baidu.com/", wait_until="domcontentloaded", timeout=30000)
                    write_status(state="ok", loginRunning=False, error=None)
                    if QR.exists():
                        QR.unlink()
                    return 0

                if not qr_saved:
                    if save_qr(page):
                        write_status(state="pending", loginRunning=True, qrUpdatedAt=now_iso(), error=None)
                        qr_saved = True

                if page.get_by_text("二维码已失效", exact=False).count():
                    refresh_qr(page)
                    qr_saved = False

                page.wait_for_timeout(2000)

            log("等待扫码超时。")
            write_status(state="expired", loginRunning=False, error="扫码超时，请重新点「扫码登录百度」")
            return 2
        finally:
            try:
                context.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
