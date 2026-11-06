#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""串行同步 worker：一次只抓一个用户，避免 2G 小机器被多个浏览器压垮。

用法（服务器上，由 systemd timer 每小时触发一次）：
    python3 tools/sync_worker.py              # 跑一批到期的用户
    python3 tools/sync_worker.py --dry-run    # 只打印谁到期，不真抓

规则：
- 只处理「已经绑过登录态」的用户；
- 距上次尝试 ≥ MN_SYNC_INTERVAL_HOURS（默认 20 小时）才算到期；
- 每次最多跑 MN_SYNC_BATCH 个（默认 2），跑完就退出，剩下的等下一次定时；
- 单个用户超 MN_SYNC_TIMEOUT（默认 240 秒）就放弃，记在 sync_status 里。
"""

import argparse
import datetime
import fcntl
import os
import pathlib
import subprocess
import sys
import time

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import paths  # noqa: E402
import store  # noqa: E402
from sources.base import SOURCE_LABELS  # noqa: E402

LOCK_FILE = ROOT / ".sync-worker.lock"
INTERVAL_HOURS = float(os.environ.get("MN_SYNC_INTERVAL_HOURS") or 20)
BATCH = int(os.environ.get("MN_SYNC_BATCH") or 2)
TIMEOUT = int(os.environ.get("MN_SYNC_TIMEOUT") or 240)
JITTER = float(os.environ.get("MN_SYNC_JITTER") or 0)


def log(message):
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("[%s] %s" % (stamp, message), flush=True)


def now():
    return datetime.datetime.now().astimezone()


def age_hours(iso_text):
    if not iso_text:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(str(iso_text))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.astimezone()
    return (now() - stamp).total_seconds() / 3600.0


def bound_uids():
    """用户表里、至少绑过一个来源登录态的人。"""
    uids = [row["uid"] for row in store.stats()]
    if not uids:
        uids = [paths.default_uid()]
    bound = []
    for uid in uids:
        if any(paths.profile(uid, source).exists() for source in SOURCE_LABELS):
            bound.append(uid)
    return bound


def due_uids(uids):
    due = []
    for uid in uids:
        status = store.get_kv(uid, "sync_status") or {}
        age = age_hours(status.get("lastAttemptAt"))
        if age is None or age >= INTERVAL_HOURS:
            due.append((age if age is not None else 1e9, uid))
    due.sort(reverse=True)  # 最久没试过的排前面
    return [uid for _, uid in due]


def sync_one(uid):
    log("开始同步 uid=%s" % uid)
    started = time.time()
    try:
        result = subprocess.run(
            [sys.executable, str(TOOLS / "server_sync.py"), "--uid", uid],
            cwd=str(ROOT),
            timeout=TIMEOUT,
        )
        code = result.returncode
    except subprocess.TimeoutExpired:
        log("uid=%s 超时（%d 秒），记一次失败" % (uid, TIMEOUT))
        status = dict(store.get_kv(uid, "sync_status") or {})
        status.update({
            "ok": False,
            "running": False,
            "lastAttemptAt": now().isoformat(timespec="seconds"),
            "error": "同步超时（%d 秒）" % TIMEOUT,
            "consecutiveFailures": int(status.get("consecutiveFailures") or 0) + 1,
        })
        store.set_kv(uid, "sync_status", status)
        return 1
    log("uid=%s 结束，退出码 %d，用时 %.0f 秒" % (uid, code, time.time() - started))
    return code


def main():
    parser = argparse.ArgumentParser(description="串行同步多个用户的收藏")
    parser.add_argument("--dry-run", action="store_true", help="只打印到期名单")
    parser.add_argument("--uid", default="", help="只同步这一个用户")
    parser.add_argument("--batch", type=int, default=BATCH, help="本次最多几个（默认 %(default)s）")
    args = parser.parse_args()

    store.connect().close()
    lock = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("已有一个 worker 在跑，本次跳过")
        return 0

    try:
        uids = [args.uid] if args.uid else due_uids(bound_uids())
        if not uids:
            log("没有到期的用户")
            return 0
        log("到期 %d 个：%s" % (len(uids), "、".join(uids[:8])))
        if args.dry_run:
            return 0

        failed = 0
        for index, uid in enumerate(uids[:max(1, args.batch)]):
            if index and JITTER:
                time.sleep(JITTER)
            failed += 1 if sync_one(uid) else 0
        log("本批完成：%d 个，失败 %d 个" % (min(len(uids), args.batch), failed))
        return 0
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
