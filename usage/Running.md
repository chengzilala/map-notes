# 跑起来（Running）

> 零基础照着做就行。按顺序两步：先取一次数据，再起服务打开页面。

## 一、一次性准备

### 1. 需要的东西
| 东西 | 用途 | 检查命令 |
|---|---|---|
| Python 3 | 跑取数脚本与服务 | `python3 -V` |
| Google Chrome | 复用你的高德登录态（脚本用真实 Chrome，不用无头） | 打开一下即可 |
| Playwright | 驱动 Chrome | `python3 -c "import playwright; print('ok')"` |

### 2. 装依赖（缺哪个装哪个）
```bash
python3 -m pip install playwright
```
用本机真实 Chrome（`channel=chrome`）时**不需要**再下载 Playwright 自带的 Chromium。

### 3. 配地图 Key（可选，但地图要用）
1. 打开 https://console.amap.com/dev/key/app ，创建「Web 端 (JS API)」Key，做个人认证。
2. 拿到 **Key** 和 **安全密钥**，填进 [web/assets/js/config.js](../web/assets/js/config.js)：
   ```js
   AMAP_KEY: '你的Key',
   AMAP_SECURITY_CODE: '你的安全密钥',
   ```
3. Key 的域名白名单：本地调试填 `localhost`；部署后把正式域名也填上。
4. 不填也能用：列表、搜索、距离排序、备注都正常，只是没有底图。
5. 该文件含 Key 与安全密钥，已加入 `.gitignore`（只在本机保留，不会进仓库）。

## 二、取数据（每次想更新收藏时跑）

```bash
cd /Users/Admin/Knowledge/Coding/map-notes
python3 tools/sync.py
```

- 第一次会弹出 Chrome 窗口，**你扫码登录高德**，登录完脚本自己继续。
- 登录态存在本机 `.sync-profiles/local/amap|baidu/`（已忽略，不入库），下次不再需要扫码，只在过期时重扫。
- 跑完会打印统计，例如：`解析：原始 360 条 → 有效 263 个点（坐标来源 lonlat=225, 像素反算=38）`。
- 82 条收藏夹容器没有坐标，会被跳过并在日志里计数，属正常。
- 产物：写进 `web/data/map-notes.db`（SQLite，本机数据，不入库）。
- 接口结构变了导致解析不出东西时，脚本**不会覆盖旧数据**，可加 `--debug` 重跑留原始返回排查。

## 三、起服务并打开页面

```bash
cd /Users/Admin/Knowledge/Coding/map-notes
python3 tools/serve.py
```

会打印：
```
电脑：http://localhost:8931
手机（同 Wi-Fi）：http://192.168.x.x:8931
```
浏览器打开 `http://localhost:8931`。

> **不要双击 `web/index.html`**。数据读取和备注保存都依赖这个服务；`file://` 下会提示「备注服务未启动」。

端口被占用就换一个：`python3 tools/serve.py --port 9000`。

## 四、手机上打开（主要用法）

### 打开
**https://map.chesterlee.cn** — 直接打开，没有口令页。数据要登录统一账户后才可见（顶栏「登录 / 我的」，`productId=map-notes`）；未登录/不在白名单只看到登录墙。
Safari / Chrome 里「添加到主屏幕」，用起来跟 App 一样。

### 登录高德（每个账户各自一次）
1. 打开 **https://map.chesterlee.cn/admin**（手机或电脑都行），先在首页登录统一账户
2. 点「扫码登录高德」，页面出现二维码
3. 用高德 App 扫它。如果 `/admin` 就在这台手机上打开：**长按二维码存到相册 → 高德 App → 扫一扫 → 右上角「相册」选它**
4. 看到「高德登录态：有效」就完成了，登录动作始终由你本人确认

### 同步节奏（v0.9.9 多用户）
- 服务器 `map-notes-sync.timer` **每小时**检查一次：谁距上次尝试超过 `MN_SYNC_INTERVAL_HOURS`（默认 20 小时）就排进队列
- **调整间隔**：改 `tools/systemd/map-notes-sync.service` 里的 `Environment=MN_SYNC_INTERVAL_HOURS=20`（或写进 `/etc/map-notes/secrets.env`），同步到服务器后 `sudo systemctl daemon-reload`；调大更省请求、更不易触发风控，调小更新更勤
- `sync_worker.py` **串行**抓取（一次最多 2 个），避免 2C2G 上多个无头 Chrome 同时跑把内存打满
- 收藏刚改过想立刻拉：`/admin` 或「我的」页 → 「立即同步收藏」（只同步当前登录账户，20–60 秒）
- 页面顶部显示「更新于 X 小时前」；超过 72 小时会标红
- 登录态失效：同步失败时自动把 `/admin` 的登录态标记为「已过期 / 未登录」，页面提示 + 飞书提醒（`/etc/map-notes/secrets.env` 里配 `FEISHU_WEBHOOK` 后生效）；「我的」页同步卡会直接给「去重新扫码」入口
- 一键清除登录态：`/admin` → 「清除高德登录态」（只清自己的）

### 服务器上的东西（排错用）

| 项 | 值 |
|---|---|
| 目录 | `/srv/chesterlee/map`（`web/` + `tools/` + `.venv/`） |
| 服务 | `map-notes.service` → `127.0.0.1:8931`（`sudo systemctl status\|restart map-notes`） |
| 定时器 | `map-notes-sync.timer`（每小时检查、串行同步；`systemctl list-timers`） |
| 反代 | Caddy `map.chesterlee.cn` → 127.0.0.1:8931（改完 `sudo systemctl reload caddy`） |
| 统一登录 / 飞书 | `/etc/map-notes/secrets.env`（`600`，不入库）；白名单 `MN_OWNER_UID` + `MN_ALLOWED_UIDS`；扩展备注同步 `MN_EXT_ALLOW_ALL=1`（可选 `MN_EXT_NOTE_LIMIT`，默认 2000） |
| 数据库 | `/srv/chesterlee/map/web/data/map-notes.db`（按 uid 隔离；**备份就拷它**） |
| 登录态 | `/srv/chesterlee/map/.sync-profiles/<uid>/amap|baidu`（不入库，可一键清除） |
| 同步日志 | `web/data/server_sync.log`、`web/data/amap_login.log`、`web/data/sync_worker.log`（由 systemd 收集时看 `journalctl -u map-notes-sync`） |
| 更新页面 | `rsync -az --exclude 'data' --exclude '.venv' --exclude '.sync-profiles' -e "ssh -i ~/.ssh/chesterlee_web" web/ ubuntu@43.136.92.125:/srv/chesterlee/map/web/` |
| 对外官网 | `site/` → `/srv/chesterlee/map/site/`，公开免登录：**https://map.chesterlee.cn/site/**；更新：`rsync -az -e "ssh -i ~/.ssh/chesterlee_web" site/ ubuntu@43.136.92.125:/srv/chesterlee/map/site/` |

> 本机 `python3 tools/sync.py --upload` 仍可用，作为「服务器同步坏掉时」的备用通道；日常不需要它。

### 备选：同一个 Wi-Fi（不上网也能用）
1. 电脑上 `python3 tools/serve.py`。
2. 手机连同一个 Wi-Fi，浏览器输入终端打印的 `http://192.168.x.x:8931`。
3. 手机用 `http` 时浏览器禁用 GPS → 点右上角 ◎ 失败后，**在地图上点一下**设定「我在这」，距离照样能排。

## 五、改哪个文件看哪里

| 想改 | 改这个文件 |
|---|---|
| 高德 Key / 默认半径 / 地图缩放 | `web/assets/js/config.js` |
| 页面结构 | `web/index.html` |
| 样式 / 配色 / 窄屏 | `web/assets/css/style.css` |
| 列表、搜索、备注、距离、地图 | `web/assets/js/app.js` |
| 取数逻辑 / 抓哪些字段 | `tools/sync.py` |
| 多源合并 / 去重 | `tools/sync_all.py` |
| 数据表结构 / 按 uid 读写 | `tools/store.py` |
| 定时调度（谁到期、串行） | `tools/sync_worker.py` |
| 服务端口 / 数据接口 | `tools/serve.py` |

改完刷新页面即可，没有构建步骤。

## 六、数据在哪

| 文件 | 内容 | 谁写 |
|---|---|---|
| `web/data/map-notes.db` | 所有用户数据（收藏 / 备注 / 偏好 / 同步状态，按 uid 隔离） | `sync_worker.py` 写收藏；页面调 `serve.py` 写备注与偏好 |
| `.sync-profiles/<uid>/amap|baidu` | 各账户的地图登录态 | `amap_login.py` / `baidu_login.py` |
| `web/data/qr/`、`web/data/login/` | 二维码与登录状态（按 uid） | 同上 |

数据库与登录态都在 `.gitignore` 里，不会进仓库。同步只覆盖收藏，**备注永不被覆盖**。

线上数据库在 `/srv/chesterlee/map/web/data/map-notes.db`，备份拷这一个文件即可（备之前先停服务或 `sqlite3 ... ".backup"`）。

## 七、出问题了

| 现象 | 看这里 |
|---|---|
| 页面提示「收藏数据未加载」 | 先跑 `python3 tools/sync_all.py`，确认日志里写入数据库的地点数为正 |
| 提示「备注服务未启动」 | 没用 `serve.py` 打开，或端口不对；用 `http://localhost:8931` |
| 打开页面只看到登录墙 | 服务端配了白名单，先在页面登录统一账户；uid 不在 `MN_ALLOWED_UIDS` 里也会被拦 |
| 脚本 302 / 一直跳登录 | 登录态过期，重跑会重新弹窗扫码 |
| 地图不显示 | 没配或配错 Key / 安全密钥；看浏览器控制台；其余功能不受影响 |
| 同步只解析出很少的点 | 高德接口可能改了字段；加 `--debug` 留原始返回，旧数据不会被覆盖 |
| 手机上排不出距离 | `http` 下无 GPS 是正常的，用地图点选设定位置；部署成 HTTPS 后可直接定位 |
| 端口 8931 被占用 | `python3 tools/serve.py --port 9000` |
