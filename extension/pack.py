#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""留个点 · 扩展一键打包（商店上架用）

按 extension/manifest.json 的引用自动收集运行文件，校验缺失后打成 zip。
不再手写文件清单，避免漏打 lib/ 或 icons/。

用法：
    python3 extension/pack.py

产物：
    release/map-notes-v<manifest 版本号>.zip

注意：
- zip 内路径以正斜杠、以 extension/ 为根（manifest.json 在包根），可直接上传 Edge。
- 只含运行文件；plan/、dev/、test/、screenshots/、release/ 不会进包。
"""

import json
import sys
import zipfile
from pathlib import Path

EXT = Path(__file__).resolve().parent
ROOT = EXT.parent
OUT_DIR = ROOT / "release"
NAME = "map-notes"
MANIFEST = EXT / "manifest.json"


def collect(manifest):
    files = []

    def add(path):
        if path and path not in files:
            files.append(path)

    add("manifest.json")
    add(manifest.get("background", {}).get("service_worker"))

    for cs in manifest.get("content_scripts", []):
        for path in cs.get("js", []):
            add(path)
        for path in cs.get("css", []):
            add(path)

    action = manifest.get("action", {})
    add(action.get("default_popup"))
    for path in (action.get("default_icon") or {}).values():
        add(path)

    for path in manifest.get("icons", {}).values():
        add(path)

    for war in manifest.get("web_accessible_resources", []):
        for path in war.get("resources", []):
            add(path)

    for msg in sorted((EXT / "_locales").glob("*/messages.json")):
        add(msg.relative_to(EXT).as_posix())

    return files


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    version = manifest["version"]
    files = collect(manifest)

    missing = [f for f in files if not (EXT / f).is_file()]
    if missing:
        print("❌ 打包中止：manifest 引用了以下文件，但本地不存在：")
        for f in missing:
            print("   - " + f)
        sys.exit(1)

    OUT_DIR.mkdir(exist_ok=True)
    zip_path = OUT_DIR / ("%s-v%s.zip" % (NAME, version))

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(EXT / f, arcname=f)

    size_kb = zip_path.stat().st_size / 1024
    print("✅ 校验通过：共 %d 个运行文件" % len(files))
    print("📦 已生成 %s  (%.1f KB)" % (zip_path.relative_to(ROOT), size_kb))
    print("   版本 v%s，包内文件：" % version)
    for f in files:
        print("   - " + f)


if __name__ == "__main__":
    main()
