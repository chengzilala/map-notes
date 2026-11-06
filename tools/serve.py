#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map-notes 服务：静态页面 + 备注读写 + 同步管理。

用法：
    python3 tools/serve.py                    # 本地起服务（公开，无鉴权）
    MN_SECRETS_FILE=/etc/map-notes/secrets.env python3 tools/serve.py

统一账户登录：
    由账户中心 Token 换 uid（POST /api/session），签发 7 天签名 Cookie；
    uid 在 MN_OWNER_UID / MN_ALLOWED_UIDS 白名单内才放行；
    所有数据接口按会话 uid 读写（多用户隔离）。
        MN_ALLOWED_UIDS=uid1,uid2       # 放行名单（最多 30 个）
        MN_SESSION_SECRET=...           # 不配则进程内随机（重启后需重新登录）
        MN_AUTH_HEADER=X-Auth-User      # 备用：反向代理注入用户头
        MN_LOGIN_URL=https://auth.xxx/  # 未登录时页面跳这里；不设则返回 401

接口：
    GET  /api/notes              读取全部备注
    POST /api/notes              保存一条备注 {id, text}，text 为空即删除
    GET  /api/display            读取来源显示偏好
    POST /api/display            覆盖写入来源显示偏好 {enabledSources, currentFilter, showSourceLabel}
    GET  /api/status             收藏 / 备注 / 登录 / 同步状态
    GET  /api/amap/status        高德登录态
    POST /api/amap/login/start   开始扫码登录（服务器无头浏览器）
    GET  /api/amap/login/qr.png  扫码登录页截图
    POST /api/amap/logout        清除高德登录态
    GET  /api/baidu/status       百度登录态
    POST /api/baidu/login/start  开始百度扫码登录
    GET  /api/baidu/login/qr.png 百度扫码登录二维码
    POST /api/baidu/logout       清除百度登录态
    POST /api/sync/run           立即同步收藏
    GET  /api/health             健康检查

备注 / 收藏 / 来源偏好 / 同步状态都落在 web/data/map-notes.db，按 uid 隔离。
  同步由 tools/sync_worker.py 串行调度 tools/server_sync.py 写入。"""

import argparse
import base64
import datetime
import hashlib
import hmac
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SITE = ROOT / "site"
DATA = WEB / "data"
ADMIN_HTML = WEB / "admin.html"

if str(pathlib.Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import paths  # noqa: E402  （按 uid 约定登录态 / 二维码 / 登录状态路径）
import store  # noqa: E402  （多用户数据层：SQLite + 按 uid 隔离）

LOCK = threading.Lock()
MAX_BODY = 1_000_000

# ---------- 配置（统一登录头、飞书 webhook） ----------

SECRETS_FILE = pathlib.Path(os.environ.get("MN_SECRETS_FILE", "/etc/map-notes/secrets.env"))


def load_secrets():
    data = {}
    try:
        for line in SECRETS_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    for key, value in os.environ.items():
        if key.startswith("MN_") or key == "FEISHU_WEBHOOK":
            data[key] = value
    return data


SECRETS = load_secrets()
AUTH_HEADER = (SECRETS.get("MN_AUTH_HEADER") or "").strip()
LOGIN_URL = (SECRETS.get("MN_LOGIN_URL") or "").strip()

# ---------- 统一账户登录（会话 cookie + uid 白名单） ----------

ACCOUNT_API = (SECRETS.get("MN_ACCOUNT_API") or "https://account.chesterlee.cn").rstrip("/")


def _uid_list(value):
    return {item.strip() for item in (value or "").split(",") if item.strip()}


# MN_OWNER_UID 保留兼容；多用户用 MN_ALLOWED_UIDS（逗号分隔，最多 30 个）
OWNER_UIDS = _uid_list(SECRETS.get("MN_OWNER_UID"))
ALLOWED_UIDS = OWNER_UIDS | _uid_list(SECRETS.get("MN_ALLOWED_UIDS"))
ALLOW_ALL_USERS = (SECRETS.get("MN_ALLOW_ALL_USERS") or "").strip() in ("1", "true", "yes")

# 浏览器扩展：只对持有账户 Token 的用户放开「备注」接口（收藏、状态等仍只给白名单）
EXT_ALLOW_ALL = (SECRETS.get("MN_EXT_ALLOW_ALL") or "").strip() in ("1", "true", "yes")
EXT_PATHS = ("/api/notes",)
EXT_NOTE_LIMIT = int(SECRETS.get("MN_EXT_NOTE_LIMIT") or 2000)
EXT_WRITE_PER_MIN = 60
EXT_READ_PER_MIN = 120
EXT_BODY = 200_000
RATE = {}

# 没配置就用进程内随机密钥：重启后需重新登录一次（页面会自动静默续上）
SESSION_SECRET = (SECRETS.get("MN_SESSION_SECRET") or "").encode("utf-8") or os.urandom(32)
SESSION_COOKIE = "mn_session"
SESSION_TTL = 7 * 24 * 3600
TOKEN_CACHE = {}
TOKEN_TTL = 300


def sign_session(uid):
    exp = int(time.time()) + SESSION_TTL
    payload = base64.urlsafe_b64encode(
        json.dumps({"uid": uid, "exp": exp}, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    sig = hmac.new(SESSION_SECRET, payload.encode("ascii"), hashlib.sha256).hexdigest()
    return payload + "." + sig


def read_session(value):
    try:
        payload, sig = value.split(".", 1)
        expected = hmac.new(SESSION_SECRET, payload.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        pad = "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload + pad).decode("utf-8"))
        if int(data.get("exp") or 0) < time.time():
            return None
        return str(data.get("uid") or "") or None
    except (ValueError, TypeError, KeyError):
        return None


def rate_allow(uid, kind, limit):
    """固定窗口限流：同一 uid 每分钟最多 limit 次（进程内，重启清零）。"""
    now = time.time()
    key = (uid, kind)
    window, count = RATE.get(key, (now, 0))
    if now - window >= 60:
        window, count = now, 0
    if count >= limit:
        return False
    RATE[key] = (window, count + 1)
    return True


def verify_account_token(token):
    """把账户中心 Token 换成 uid；结果缓存 5 分钟，失败一律当未登录。"""
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    hit = TOKEN_CACHE.get(key)
    if hit and hit[1] > now:
        return hit[0]
    request = urllib.request.Request(
        ACCOUNT_API + "/accountCenter",
        data=json.dumps({"action": "me"}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if not body.get("ok"):
        return None
    uid = str((body.get("data") or {}).get("uid") or "").strip()
    if not uid:
        return None
    TOKEN_CACHE[key] = (uid, now + TOKEN_TTL)
    return uid



def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def read_json(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as writer:
            json.dump(data, writer, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def age_hours(iso_text):
    if not iso_text:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(str(iso_text))
    except ValueError:
        return None
    now = datetime.datetime.now().astimezone()
    if stamp.tzinfo is None:
        stamp = stamp.astimezone()
    return round((now - stamp).total_seconds() / 3600.0, 1)


PROCESSES = {}


def spawn_tool(name, script, extra_env=None, args=None):
    """后台跑一个脚本，返回 (started, message)。同一 name 同时只跑一个。"""
    path = ROOT / "tools" / script
    if not path.exists():
        return False, "找不到 %s" % script
    with LOCK:
        running = PROCESSES.get(name)
        if running and running.poll() is None:
            return True, "已在运行"
        DATA.mkdir(parents=True, exist_ok=True)
        log_path = DATA / (name + ".log")
        try:
            log_file = open(log_path, "ab")
        except OSError:
            log_file = subprocess.DEVNULL
        env = dict(os.environ)
        env.update({k: v for k, v in SECRETS.items() if k.startswith("MN_") or k == "FEISHU_WEBHOOK"})
        env.update(extra_env or {})
        try:
            PROCESSES[name] = subprocess.Popen(
                [sys.executable, str(path)] + list(args or []),
                cwd=str(ROOT),
                stdout=log_file,
                stderr=log_file,
                env=env,
                start_new_session=True,
            )
        except OSError as exc:
            return False, "启动失败：%s" % exc
        finally:
            if log_file is not subprocess.DEVNULL:
                log_file.close()
    return True, "已启动"


def process_running(name):
    with LOCK:
        proc = PROCESSES.get(name)
        return bool(proc and proc.poll() is None)


def login_key(provider, uid):
    """每个用户的登录进程单独记账，互不影响。"""
    return "%s_login:%s" % (provider, uid)


class Handler(SimpleHTTPRequestHandler):
    server_version = "map-notes"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    # ---------- 基础 ----------

    def end_headers(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/") or path.startswith("/data/"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def bearer_token(self):
        raw = (self.headers.get("Authorization") or "").strip()
        if raw.lower().startswith("bearer "):
            return raw[7:].strip()
        return ""

    def cookie_uid(self):
        raw = self.headers.get("Cookie") or ""
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE and value:
                return read_session(value)
        return None

    def request_uid(self):
        uid = self.cookie_uid()
        if uid:
            return uid
        token = self.bearer_token()
        if token:
            return verify_account_token(token)
        return None

    def data_uid(self):
        """数据归属：已登录用其 uid；未启用鉴权时落到本地单用户。"""
        uid = self.request_uid()
        if uid:
            return uid
        return (SECRETS.get("MN_DEFAULT_UID") or "local").strip()

    def uid_allowed(self, uid):
        return ALLOW_ALL_USERS or uid in ALLOWED_UIDS

    def is_authed(self):
        """三种模式：反代用户头 / 账户登录（白名单）/ 公开（未配置时）。"""
        if AUTH_HEADER:
            return bool((self.headers.get(AUTH_HEADER) or "").strip())
        if not (ALLOWED_UIDS or ALLOW_ALL_USERS):
            return True
        path = urllib.parse.urlparse(self.path).path
        # 页面与静态资源保持公开，数据接口与 data/ 需要登录
        if not (path.startswith("/api/") or path.startswith("/data/")):
            return True
        uid = self.request_uid()
        if not uid:
            return False
        if self.uid_allowed(uid):
            return True
        # 扩展用户：仅备注接口可用，且必须带账户 Token（不认白名单，也不放开收藏）
        if EXT_ALLOW_ALL and path in EXT_PATHS and self.bearer_token():
            return True
        print("[auth] 拒绝未授权账户 uid=%s" % uid, file=sys.stderr)
        return False

    def require_auth(self):
        if self.is_authed():
            return True
        path = urllib.parse.urlparse(self.path).path
        accept = (self.headers.get("Accept") or "").lower()
        if not path.startswith("/api/") and not path.startswith("/data/") \
                and LOGIN_URL and "text/html" in accept:
            self.redirect(LOGIN_URL)
            return False
        self.send_json(401, {"ok": False, "error": "请先登录统一账户"})
        return False

    def handle_session(self):
        """用账户中心 Token 换本站会话 cookie。"""
        token = self.bearer_token()
        if not token:
            return self.send_json(401, {"ok": False, "error": "缺少登录票据"})
        uid = verify_account_token(token)
        if not uid:
            return self.send_json(401, {"ok": False, "error": "登录态无效或已过期"})
        if not self.uid_allowed(uid):
            print("[auth] 拒绝未授权账户 uid=%s" % uid, file=sys.stderr)
            return self.send_json(403, {"ok": False, "error": "该账户无权访问", "uid": uid})
        store.touch_user(uid)
        secure = (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"
        cookie = "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s" % (
            SESSION_COOKIE, sign_session(uid), SESSION_TTL, "; Secure" if secure else "")
        return self.send_json(
            200,
            {"ok": True, "uid": uid, "enforced": bool(ALLOWED_UIDS or ALLOW_ALL_USERS)},
            headers=[("Set-Cookie", cookie)],
        )

    def send_json(self, code, payload, headers=None):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        for key, value in (headers or []):
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def send_file(self, path, content_type):
        try:
            raw = path.read_bytes()
        except OSError:
            return self.send_json(404, {"ok": False, "error": "not found"})
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json_body(self, limit=MAX_BODY):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("请求体长度非法")
        if length <= 0 or length > limit:
            raise ValueError("请求体为空或过大")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def redirect(self, target):
        self.send_response(302)
        self.send_header("Location", target)
        self.end_headers()

    # ---------- GET ----------

    def serve_site(self, path):
        """对外官网（site/）：纯静态，公开访问，不带任何用户数据。"""
        rel = path[len("/site"):].lstrip("/") or "index.html"
        if rel.endswith("/"):
            rel += "index.html"
        target = (SITE / rel).resolve()
        try:
            target.relative_to(SITE.resolve())
        except ValueError:
            return self.send_json(404, {"ok": False, "error": "not found"})
        if target.is_dir():
            target = target / "index.html"
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".ico": "image/x-icon",
        }.get(target.suffix.lower(), "application/octet-stream")
        return self.send_file(target, ctype)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        # data/ 下是用户数据与登录态，一律不给静态访问，只走按 uid 隔离的接口
        if path == "/data" or path.startswith("/data/"):
            return self.send_json(404, {"ok": False, "error": "not found"})

        if path == "/api/health":
            return self.send_json(200, {
                "ok": True,
                "auth": bool(AUTH_HEADER) or bool(ALLOWED_UIDS or ALLOW_ALL_USERS),
                "mode": "header" if AUTH_HEADER else (
                    "open" if not (ALLOWED_UIDS or ALLOW_ALL_USERS) else (
                        "all" if ALLOW_ALL_USERS else "allowlist")),
                "users": len(ALLOWED_UIDS),
                "ext": EXT_ALLOW_ALL,
            })

        if path == "/api/session":
            return self.send_json(200, {
                "ok": True,
                "uid": self.request_uid(),
                "enforced": bool(ALLOWED_UIDS or ALLOW_ALL_USERS),
            })

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        # 官网：公开静态页，放在登录判断之前
        if path == "/site":
            return self.redirect("/site/")
        if path.startswith("/site/"):
            return self.serve_site(path)


        if not self.require_auth():
            return

        uid = self.data_uid()
        # 只有已登录的请求才登记用户；页面外壳在公开模式下不该造出 "local"
        if self.request_uid():
            store.touch_user(uid)

        if path == "/api/favorites":
            return self.send_json(200, store.get_favorites(uid))
        if path == "/api/notes":
            if not rate_allow(uid, "read", EXT_READ_PER_MIN):
                return self.send_json(429, {"ok": False, "error": "读取太频繁，请稍后再试"})
            return self.send_json(200, store.get_notes(uid))
        if path == "/api/display":
            return self.send_json(200, store.get_display(uid))
        if path == "/api/status":
            return self.send_json(200, self.status_payload(uid))
        if path == "/api/amap/status":
            return self.send_json(200, self.login_payload(uid, "amap"))
        if path == "/api/amap/login/qr.png":
            qr = paths.qr(uid, "amap")
            if not qr.exists():
                return self.send_json(404, {"ok": False, "error": "二维码还没生成"})
            return self.send_file(qr, "image/png")
        if path == "/api/baidu/status":
            return self.send_json(200, self.login_payload(uid, "baidu"))
        if path == "/api/baidu/login/qr.png":
            qr = paths.qr(uid, "baidu")
            if not qr.exists():
                return self.send_json(404, {"ok": False, "error": "二维码还没生成"})
            return self.send_file(qr, "image/png")
        if path in ("/admin", "/admin.html"):
            return self.send_file(ADMIN_HTML, "text/html; charset=utf-8")

        return super().do_GET()

    def status_payload(self, uid):
        favorites = store.get_favorites(uid)
        notes = store.get_notes(uid)
        sync = store.get_kv(uid, "sync_status") or {}
        synced_at = favorites.get("syncedAt") or sync.get("lastSuccessAt")
        running = process_running("server_sync:%s" % uid)
        if not running and sync.get("running"):
            attempt_age = age_hours(sync.get("lastAttemptAt"))
            running = attempt_age is not None and attempt_age < 1 / 6.0
        return {
            "ok": True,
            "uid": uid,
            "favorites": {
                "count": favorites.get("count") or 0,
                "syncedAt": synced_at,
                "ageHours": age_hours(synced_at),
            },
            "notes": {
                "count": len(notes.get("notes") or {}),
                "updatedAt": notes.get("updatedAt"),
            },
            "sync": {
                "running": running,
                "ok": sync.get("ok"),
                "lastAttemptAt": sync.get("lastAttemptAt"),
                "lastSuccessAt": sync.get("lastSuccessAt"),
                "error": sync.get("error"),
                "consecutiveFailures": sync.get("consecutiveFailures") or 0,
                "sources": sync.get("sources") or {},
            },
            "amap": self.login_state(uid, "amap"),
            "baidu": self.login_state(uid, "baidu"),
        }

    def login_state(self, uid, provider):
        data = read_json(paths.login_status(uid, provider))
        return {
            "state": data.get("state") or "unknown",
            "checkedAt": data.get("checkedAt"),
            "qrUpdatedAt": data.get("qrUpdatedAt"),
            "loginRunning": process_running(login_key(provider, uid)),
            "error": data.get("error"),
        }

    def login_payload(self, uid, provider):
        return dict({"ok": True}, **self.login_state(uid, provider))

    # ---------- POST ----------

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/session":
            return self.handle_session()

        if not self.require_auth():
            return

        uid = self.data_uid()
        if self.request_uid():
            store.touch_user(uid)

        if path == "/api/notes":
            return self.handle_save_note(uid)
        if path == "/api/display":
            return self.handle_save_display(uid)
        if path == "/api/amap/login/start":
            started, message = spawn_tool(
                login_key("amap", uid), "amap_login.py", args=["--uid", uid])
            return self.send_json(200 if started else 500, {"ok": started, "message": message, "running": started})
        if path == "/api/amap/logout":
            return self.handle_logout(uid, "amap")
        if path == "/api/baidu/login/start":
            started, message = spawn_tool(
                login_key("baidu", uid), "baidu_login.py", args=["--uid", uid])
            return self.send_json(200 if started else 500, {"ok": started, "message": message, "running": started})
        if path == "/api/baidu/logout":
            return self.handle_logout(uid, "baidu")
        if path == "/api/sync/run":
            started, message = spawn_tool(
                "server_sync:%s" % uid, "server_sync.py", args=["--uid", uid])
            return self.send_json(200 if started else 500, {"ok": started, "message": message, "running": started})

        return self.send_json(404, {"ok": False, "error": "not found"})

    def handle_save_note(self, uid):
        if not rate_allow(uid, "write", EXT_WRITE_PER_MIN):
            return self.send_json(429, {"ok": False, "error": "写得太频繁，请稍后再试"})
        try:
            body = self.read_json_body(limit=EXT_BODY)
            item_id = str(body.get("id") or "").strip()
            text = body.get("text")
            if not item_id:
                raise ValueError("缺少 id")
            if not isinstance(text, str):
                raise ValueError("text 必须是字符串")
        except Exception as exc:
            return self.send_json(400, {"ok": False, "error": str(exc)})

        # 非白名单的扩展用户限制备注条数，避免小机器被刷
        if not self.uid_allowed(uid) and text.strip() and not store.has_note(uid, item_id) \
                and store.count_notes(uid) >= EXT_NOTE_LIMIT:
            return self.send_json(
                400, {"ok": False, "error": "备注条数已达上限（%d 条）" % EXT_NOTE_LIMIT})

        try:
            updated_at = store.save_note(uid, item_id, text)
        except ValueError as exc:
            return self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            return self.send_json(500, {"ok": False, "error": "写入失败：%s" % exc})

        return self.send_json(200, {"ok": True, "updatedAt": updated_at})

    def handle_save_display(self, uid):
        try:
            body = self.read_json_body()
            data = store.save_display(uid, body)
        except Exception as exc:
            return self.send_json(400, {"ok": False, "error": str(exc)})
        return self.send_json(200, {"ok": True, "display": data})

    def handle_logout(self, uid, provider):
        key = login_key(provider, uid)
        with LOCK:
            proc = PROCESSES.get(key)
            if proc and proc.poll() is None:
                proc.terminate()
            profile = paths.profile(uid, provider)
            if profile.exists():
                shutil.rmtree(profile, ignore_errors=True)
            qr = paths.qr(uid, provider)
            if qr.exists():
                qr.unlink()
            write_json(
                paths.login_status(uid, provider),
                {"state": "unknown", "checkedAt": now_iso(), "error": "已清除登录态"},
            )
        return self.send_json(200, {"ok": True})

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s %s\n" % (self.address_string(), fmt % args))


def lan_ips():
    ips = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ips.append(sock.getsockname()[0])
        sock.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    parser = argparse.ArgumentParser(description="map-notes 静态服务 + 备注读写 + 同步管理")
    parser.add_argument("--port", type=int, default=8931, help="端口，默认 8931")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0")
    args = parser.parse_args()

    if not (WEB / "index.html").exists():
        print("找不到 web/index.html，请确认在项目根目录运行。", file=sys.stderr)
        return 1

    store.connect().close()
    owner_uid = (sorted(OWNER_UIDS) or sorted(ALLOWED_UIDS) or ["local"])[0]
    migrated = store.migrate_legacy(owner_uid)
    profiles_migrated = paths.migrate_legacy(owner_uid)
    if profiles_migrated:
        print("  旧登录态已迁到 uid=%s：%s" % (owner_uid, "、".join(profiles_migrated)))

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print("端口 %d 启动失败：%s\n换个端口试试：python3 tools/serve.py --port 9000" % (args.port, exc))
        return 1

    print("map-notes 已启动")
    print("  电脑：http://localhost:%d" % args.port)
    for ip in lan_ips():
        print("  手机（同 Wi-Fi）：http://%s:%d" % (ip, args.port))
    if AUTH_HEADER:
        auth_note = "反代用户头（%s）" % AUTH_HEADER
    elif ALLOW_ALL_USERS:
        auth_note = "统一账户登录（任何已登录用户都可访问）"
    elif ALLOWED_UIDS:
        auth_note = "统一账户登录（白名单 %d 个 uid）" % len(ALLOWED_UIDS)
    else:
        auth_note = "未启用（公开；配 MN_ALLOWED_UIDS 后只给名单内用户）"
    print("  访问保护：%s" % auth_note)
    print("  数据库：%s" % store.DB)
    if migrated:
        print("  旧数据已迁到 uid=%s：%s" % (owner_uid, "、".join(migrated)))
    print("按 Ctrl+C 停止")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
