#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多用户数据层：SQLite，所有数据按 uid 隔离。

用法：
    python3 tools/store.py            # 建库并打印路径与各 uid 数据量

表结构：
    users    (uid, created_at, last_seen_at)
    favorites(uid, item_id, seq, json, updated_at)   -- 收藏点，一条一行
    notes    (uid, item_id, text, updated_at)
    display  (uid, json, updated_at)                 -- 来源显示偏好
    kv       (uid, key, value, updated_at)           -- 收藏元信息 / 同步状态 / 登录状态

旧数据迁移：migrate_legacy(uid) 把 web/data/{favorites,notes,display}.json
搬到该 uid 名下，并把旧文件改名成 *.migrated（避免被当静态文件读走）。
"""

import datetime
import json
import os
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parent.parent
# MN_DATA 用于测试时把旧 JSON 迁移目录指到临时目录，平时不用配
DATA = pathlib.Path(os.environ.get("MN_DATA") or (ROOT / "web" / "data"))
DB = pathlib.Path(os.environ.get("MN_DB") or (DATA / "map-notes.db"))

DISPLAY_SOURCES = ("amap", "baidu")
MAX_TEXT = 20_000


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            uid          TEXT PRIMARY KEY,
            created_at   TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorites (
            uid        TEXT NOT NULL,
            item_id    TEXT NOT NULL,
            seq        INTEGER NOT NULL,
            json       TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (uid, item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_favorites_uid_seq ON favorites(uid, seq);
        CREATE TABLE IF NOT EXISTS notes (
            uid        TEXT NOT NULL,
            item_id    TEXT NOT NULL,
            text       TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (uid, item_id)
        );
        CREATE TABLE IF NOT EXISTS display (
            uid        TEXT PRIMARY KEY,
            json       TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv (
            uid        TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (uid, key)
        );
        """
    )
    conn.commit()


def touch_user(uid):
    if not uid:
        return
    stamp = now_iso()
    with connect() as conn:
        conn.execute(
            "INSERT INTO users (uid, created_at, last_seen_at) VALUES (?, ?, ?) "
            "ON CONFLICT(uid) DO UPDATE SET last_seen_at=excluded.last_seen_at",
            (uid, stamp, stamp),
        )


# ---------- 通用键值（同步状态 / 登录状态 / 收藏元信息） ----------

def get_kv(uid, key, default=None):
    with connect() as conn:
        row = conn.execute(
            "SELECT value FROM kv WHERE uid=? AND key=?", (uid, key)
        ).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return default


def set_kv(uid, key, value):
    raw = json.dumps(value, ensure_ascii=False)
    with connect() as conn:
        conn.execute(
            "INSERT INTO kv (uid, key, value, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(uid, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (uid, key, raw, now_iso()),
        )


# ---------- 收藏 ----------

def get_favorites(uid):
    meta = get_kv(uid, "favorites_meta") or {}
    with connect() as conn:
        rows = conn.execute(
            "SELECT json FROM favorites WHERE uid=? ORDER BY seq", (uid,)
        ).fetchall()
    items = []
    for row in rows:
        try:
            item = json.loads(row["json"])
        except (TypeError, ValueError):
            continue
        if isinstance(item, dict):
            items.append(item)
    return {
        "schemaVersion": 2,
        "syncedAt": meta.get("syncedAt"),
        "count": len(items),
        "sources": meta.get("sources") or {},
        "skipped": meta.get("skipped"),
        "items": items,
    }


def replace_favorites(uid, payload):
    """整份替换（同步脚本调用）。payload 为 sync_all 产出的 v2 结构。"""
    if not isinstance(payload, dict):
        raise ValueError("收藏数据格式不对")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("items 必须是数组")

    stamp = now_iso()
    rows = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not item.get("id"):
            continue
        rows.append((uid, str(item["id"]), index, json.dumps(item, ensure_ascii=False), stamp))

    with connect() as conn:
        conn.execute("DELETE FROM favorites WHERE uid=?", (uid,))
        conn.executemany(
            "INSERT OR REPLACE INTO favorites (uid, item_id, seq, json, updated_at) VALUES (?, ?, ?, ?, ?)",
            rows,
        )
    set_kv(uid, "favorites_meta", {
        "syncedAt": payload.get("syncedAt") or stamp,
        "sources": payload.get("sources") or {},
        "skipped": payload.get("skipped"),
        "count": len(rows),
    })
    return len(rows)


# ---------- 备注 ----------

def get_notes(uid):
    with connect() as conn:
        rows = conn.execute(
            "SELECT item_id, text, updated_at FROM notes WHERE uid=? ORDER BY updated_at", (uid,)
        ).fetchall()
    notes = {row["item_id"]: {"text": row["text"], "updatedAt": row["updated_at"]} for row in rows}
    updated_at = max((row["updated_at"] for row in rows), default=None)
    return {"schemaVersion": 1, "updatedAt": updated_at, "notes": notes}


def count_notes(uid):
    with connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM notes WHERE uid=?", (uid,)).fetchone()
    return int(row["n"] if row else 0)


def has_note(uid, item_id):
    with connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM notes WHERE uid=? AND item_id=?", (uid, str(item_id or "").strip())
        ).fetchone()
    return bool(row)


def save_note(uid, item_id, text, updated_at=None):
    item_id = str(item_id or "").strip()
    if not item_id:
        raise ValueError("缺少 id")
    if not isinstance(text, str):
        raise ValueError("text 必须是字符串")
    if len(text) > MAX_TEXT:
        raise ValueError("备注过长")
    stamp = updated_at or now_iso()
    with connect() as conn:
        if text.strip():
            conn.execute(
                "INSERT INTO notes (uid, item_id, text, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(uid, item_id) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
                (uid, item_id, text, stamp),
            )
        else:
            conn.execute("DELETE FROM notes WHERE uid=? AND item_id=?", (uid, item_id))
    return stamp


# ---------- 来源显示偏好 ----------

def default_display():
    return {
        "enabledSources": list(DISPLAY_SOURCES),
        "currentFilter": "all",
        "showSourceLabel": True,
    }


def get_display(uid):
    stored = get_kv(uid, "display")
    if not isinstance(stored, dict) or not stored:
        return default_display()
    enabled = [s for s in (stored.get("enabledSources") or []) if s in DISPLAY_SOURCES]
    if not enabled:
        enabled = list(DISPLAY_SOURCES)
    current = stored.get("currentFilter")
    if current not in ("all",) + tuple(enabled):
        current = "all"
    show = stored.get("showSourceLabel")
    return {
        "enabledSources": enabled,
        "currentFilter": current,
        "showSourceLabel": show if isinstance(show, bool) else True,
    }


def save_display(uid, body):
    if not isinstance(body, dict):
        raise ValueError("请求体必须是对象")
    enabled = body.get("enabledSources")
    if not isinstance(enabled, list):
        raise ValueError("enabledSources 必须是数组")
    enabled = [s for s in enabled if isinstance(s, str) and s in DISPLAY_SOURCES]
    if not enabled:
        enabled = list(DISPLAY_SOURCES)
    current = body.get("currentFilter")
    if current not in ("all",) + tuple(enabled):
        current = "all"
    show = body.get("showSourceLabel")
    data = {
        "enabledSources": enabled,
        "currentFilter": current,
        "showSourceLabel": show if isinstance(show, bool) else True,
    }
    set_kv(uid, "display", data)
    return data


# ---------- 旧数据迁移（全局单份 → 指定 uid） ----------

def _read_json(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def migrate_legacy(uid):
    """把 web/data 下的旧 JSON 搬到 uid 名下；已迁移过则跳过。返回迁移了什么。"""
    if not uid:
        return []
    done = []
    touch_user(uid)

    legacy_favorites = DATA / "favorites.json"
    if legacy_favorites.exists():
        payload = _read_json(legacy_favorites)
        items = payload.get("items")
        if isinstance(items, list) and items:
            count = replace_favorites(uid, payload)
            done.append("收藏 %d 个" % count)
        legacy_favorites.rename(DATA / "favorites.json.migrated")

    legacy_notes = DATA / "notes.json"
    if legacy_notes.exists():
        payload = _read_json(legacy_notes)
        notes = payload.get("notes")
        if isinstance(notes, dict):
            for item_id, note in notes.items():
                text = note.get("text") if isinstance(note, dict) else None
                if isinstance(text, str) and text.strip():
                    save_note(uid, item_id, text, note.get("updatedAt"))
            done.append("备注 %d 条" % len(notes))
        legacy_notes.rename(DATA / "notes.json.migrated")

    legacy_display = DATA / "display.json"
    if legacy_display.exists():
        payload = _read_json(legacy_display)
        if payload:
            save_display(uid, payload)
            done.append("来源偏好")
        legacy_display.rename(DATA / "display.json.migrated")

    return done


def stats():
    with connect() as conn:
        rows = conn.execute(
            "SELECT u.uid, "
            "  (SELECT COUNT(*) FROM favorites f WHERE f.uid=u.uid) AS favs, "
            "  (SELECT COUNT(*) FROM notes n WHERE n.uid=u.uid) AS notes "
            "FROM users u ORDER BY u.created_at"
        ).fetchall()
    return [dict(row) for row in rows]


def main():
    connect().close()
    print("数据库：%s" % DB)
    rows = stats()
    if not rows:
        print("还没有用户数据")
        return
    for row in rows:
        print("  %s  收藏 %d  备注 %d" % (row["uid"], row["favs"], row["notes"]))


if __name__ == "__main__":
    main()
