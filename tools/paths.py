#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按 uid 约定本机路径：登录态目录、二维码、登录状态文件。

目录约定（默认都在项目根下，可用 MN_PROFILES 改登录态根目录）：
    .sync-profiles/<uid>/amap/        高德登录态（无头浏览器 profile）
    .sync-profiles/<uid>/baidu/       百度登录态
    web/data/qr/<uid>-amap.png        扫码二维码（页面通过接口读取）
    web/data/login/<uid>-amap.json    登录状态

旧的单用户目录 .sync-profile/ 会在首次迁移时搬进 <uid>/，只搬一次。
"""

import hashlib
import os
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = pathlib.Path(os.environ.get("MN_DATA") or (ROOT / "web" / "data"))
DEFAULT_PROFILES = ROOT / ".sync-profiles"
PROFILES = pathlib.Path(os.environ.get("MN_PROFILES") or DEFAULT_PROFILES)

SOURCES = ("amap", "baidu")


def safe(uid):
    """uid 来自账户中心，正常是数字/UUID；异常字符用哈希兜底，避免路径穿越。"""
    uid = str(uid or "").strip() or "local"
    if all(ch.isalnum() or ch in "-_" for ch in uid):
        return uid
    return "u" + hashlib.sha256(uid.encode("utf-8")).hexdigest()[:16]


def default_uid():
    """未指定 uid 时的归属：MN_SYNC_UID > MN_OWNER_UID 第一个 > local。"""
    uid = (os.environ.get("MN_SYNC_UID") or "").strip()
    if uid:
        return uid
    owner = (os.environ.get("MN_OWNER_UID") or "").split(",")[0].strip()
    return owner or "local"


def profile(uid, source):
    return PROFILES / safe(uid) / source


def qr(uid, source):
    return DATA / "qr" / ("%s-%s.png" % (safe(uid), source))


def login_status(uid, source):
    return DATA / "login" / ("%s-%s.json" % (safe(uid), source))


def migrate_legacy(uid):
    """把旧的单用户登录态搬到该 uid 名下（只搬一次）。返回搬了什么。"""
    done = []
    # 测试或自定义 profile 目录时不动项目里的真实登录态
    if PROFILES != DEFAULT_PROFILES:
        return done
    legacy = ROOT / ".sync-profile"
    if not legacy.exists():
        return done

    target_baidu = profile(uid, "baidu")
    legacy_baidu = legacy / "baidu"
    if legacy_baidu.exists() and not target_baidu.exists():
        target_baidu.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(legacy_baidu), str(target_baidu))
        done.append("百度登录态")

    target_amap = profile(uid, "amap")
    if legacy.exists() and not target_amap.exists():
        target_amap.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(legacy), str(target_amap))
        done.append("高德登录态")

    for source, legacy_name in (("amap", "amap-login.json"), ("baidu", "baidu-login.json")):
        old = DATA / legacy_name
        new = login_status(uid, source)
        if old.exists() and not new.exists():
            new.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(old), str(new))
            old.unlink()

    return done
