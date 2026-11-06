#!/usr/bin/env python3
"""高德控制台小助手：给「Map应用」新增 Web端(JS API) Key。

按项目规则：本机真实 Chrome + 可见窗口 + 持久化 profile（.autoshot/amap-profile）。
登录（扫码/密码）由你完成；脚本只做导航、填表和读取，最后一步「确认」也由你点。

用法：
  python3 tools/amap_key_setup.py login     # 打开控制台，等你登录（登录态会记住）
  python3 tools/amap_key_setup.py inspect   # 截图 + 打印按钮文字，确认页面状态
  python3 tools/amap_key_setup.py dialog    # 点开「添加Key」弹窗，截图 + dump 结构
  python3 tools/amap_key_setup.py add       # 填表 → 停下等你点确认 → 读取新 Key
"""

import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = ROOT / ".autoshot" / "amap-profile"
SHOTS = ROOT / "screenshots"
URL = "https://console.amap.com/dev/key/app"
KEY_NAME = "MAP-JS"


def log(msg):
    print(f"[amap] {msg}", flush=True)


def shoot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"amap-{name}.png"
    page.screenshot(path=str(path), full_page=True)
    log(f"截图：{path}")
    return path


def is_console(page):
    return "console.amap.com" in page.url and page.locator("text=我的应用").count() > 0


def open_console(page, timeout=900):
    """进入「我的应用」；未登录则等你登录。"""
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    deadline = time.time() + timeout
    tip_at = 0
    while time.time() < deadline:
        if is_console(page):
            log("已在「我的应用」页面。")
            return True
        if time.time() - tip_at > 30:
            tip_at = time.time()
            log("等待登录：请在弹出的 Chrome 窗口点右上角「登录」并完成扫码/密码登录。")
        page.wait_for_timeout(2000)
    log("等待登录超时。")
    return False


def dump(page, label):
    log(f"--- {label} ---")
    log(f"url={page.url}")
    try:
        buttons = page.eval_on_selector_all(
            "button,a,span,label,div.ivu-radio-wrapper",
            "els => els.map(e => (e.innerText || '').trim())"
            ".filter(t => t && t.length <= 14)",
        )
        keep = []
        for t in buttons:
            if any(k in t for k in ("Key", "应用", "添加", "设置", "确认", "创建", "服务", "平台", "端")):
                if t not in keep:
                    keep.append(t)
        log(f"候选文字: {keep[:40]}")
    except Exception as exc:
        log(f"dump 失败: {exc}")


def click_map_app_add(page):
    card = page.locator("text=Map应用").first
    if card.count() == 0:
        log("没找到「Map应用」卡片。")
        return False
    row = card.locator("xpath=ancestor::div[.//text()[contains(., '添加Key')]][1]")
    target = row.locator("text=添加Key").first if row.count() else page.locator("text=添加Key").first
    log("点「添加Key」…")
    target.click()
    page.wait_for_timeout(1500)
    return True


def action_login(page):
    ok = open_console(page)
    shoot(page, "login" if not ok else "logged-in")
    log("登录态已保存，下次不用再扫码。" if ok else "未登录成功。")


def action_inspect(page):
    if not open_console(page):
        shoot(page, "login")
        return
    page.wait_for_timeout(1500)
    dump(page, "我的应用")
    shoot(page, "apps")


def action_dialog(page):
    if not open_console(page):
        return
    page.wait_for_timeout(1200)
    if not click_map_app_add(page):
        return
    shoot(page, "dialog")
    dump(page, "添加Key 弹窗")


def fill_form(page):
    """选 Web端(JS API) + 填 Key 名称（不提交）。"""
    page.locator("text=Web端(JS API)").first.click()
    page.wait_for_timeout(800)
    box = page.locator("input[placeholder*='支持汉字']").first
    box.click()
    box.fill(KEY_NAME)
    page.wait_for_timeout(500)
    shoot(page, "filled")


def action_add(page):
    if not open_console(page):
        return
    page.wait_for_timeout(1200)
    if not click_map_app_add(page):
        return
    fill_form(page)
    log(f"已选「Web端(JS API)」、Key 名称填好 {KEY_NAME}。")
    log("请你在窗口里核对，然后**亲手点「确认」**；我会自动检测创建结果（等 10 分钟）。")
    deadline = time.time() + 600
    while time.time() < deadline:
        page.wait_for_timeout(2000)
        if KEY_NAME in page.inner_text("body"):
            log(f"已看到新 Key「{KEY_NAME}」。")
            shoot(page, "created")
            dump(page, "创建后")
            return
    log("等待超时。")


ACTIONS = {
    "login": action_login,
    "inspect": action_inspect,
    "dialog": action_dialog,
    "add": action_add,
}


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "inspect"
    fn = ACTIONS.get(action)
    if not fn:
        log(f"未知动作：{action}，可用：{', '.join(ACTIONS)}")
        sys.exit(2)

    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            channel="chrome",
            headless=False,
            no_viewport=True,
            args=["--start-maximized"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            fn(page)
            log("脚本结束（浏览器窗口保留 20 秒后关闭）。")
            page.wait_for_timeout(20000)
        finally:
            ctx.close()


if __name__ == "__main__":
    main()
