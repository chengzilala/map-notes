# 留个点 · 地图地点笔记（map-notes）

> 版本 **v0.15.0**（Web v0.11.6：同步失败自动把登录态标记为「已过期/未登录」，「我的」页同步卡直接给「去重新扫码」入口；同步间隔可用 `MN_SYNC_INTERVAL_HOURS` 调整）｜ 2026-11-10

> 把高德 / 百度地图里**已收藏**的地点自动取出来，补一段自由备注，并随时按「离我多远」排序。
> 两种形态：Web 站（白名单最多 30 人）+ 浏览器扩展（公开上架，收藏只在本机读取，备注可选多设备同步）。不注册站点账号、不分享、不写回地图、不做导航。

## 它解决什么问题

高德能收藏、能打标签、能置顶，但**没有自由文本备注**，也**不能按距离排附近的点**。
这个页面只补这两件事，其余一概不做。

## 当前状态

- ✅ 取数：登录态抓收藏、自定义点坐标反算、去重入库（SQLite）
- ✅ 多用户：每个账户只看到自己的收藏 / 备注 / 来源偏好；登录态与二维码按 uid 分开存放在 `.sync-profiles/<uid>/`
- ✅ 多源：高德 + 百度双源合并入库（百度 BD09MC → GCJ-02），来源标签与筛选可配置并记住
- ✅ 页面：地图撒点、附近排序、搜索、备注即存、窄屏适配、四类兜底
- ✅ 收藏画像（Web v0.11.0，v0.11.3 起内置收藏同步）：首页右上头像 → `stats.html`；先显示统一账户，再展示时间线、城市足迹、收藏类型、来源构成、常用标签、收藏范围、备注画像与趣味事实。**纯前端本地计算，不新增统计接口、不上传新数据；收藏 ≠ 到访**。顶部「收藏同步」卡片可直接查看更新时间 / 新鲜度 / 来源并点「立即同步收藏」（复用 `/api/status` 与 `/api/sync/run`，同步完成后本页自动刷新）。
- ✅ 服务：本地静态服务 + 备注读写（电脑与手机同一地址即同一份）
- ✅ 上线：**https://map.chesterlee.cn**（腾讯云轻量 + Caddy，`map-notes.service` → `127.0.0.1:8931`，页脚已挂 ICP / 公安备案号）
- ✅ 官网：**https://map.chesterlee.cn/site/**（`site/` 纯静态，由 `serve.py` 的 `/site/` 路由直出；更新：`rsync -az --delete site/ ubuntu@43.136.92.125:/srv/chesterlee/map/site/`）
- ✅ 手机优先：打开即用，无口令页；`/admin` 可扫码登录高德、立即同步、看数据新鲜度
- ✅ 自动同步：`sync_worker.py` 每小时检查一次、**串行**同步到期用户（默认 20 小时，可用 `MN_SYNC_INTERVAL_HOURS` 调长/调短，一次最多 2 个），避免 2G 小机器被多个浏览器压垮；登录态失效时同步失败会自动把 `/admin` 的登录态改成「已过期」并发飞书提醒
- ✅ 同步入口：「我的」收藏画像页与 `/admin` 都有「立即同步收藏」；失败时「我的」页直接给「去重新扫码」入口（跳到对应平台登录卡）
- ✅ 统一账户：Logo 右侧头像入口（`assets/js/account.js`，SDK 为 `assets/js/ps-auth.js`，`productId=map-notes`）；**访问保护已启用：未登录／非本人账户看不到任何数据**（见下「访问保护」）
- ✅ AI Key：`/admin` 的「AI Key」卡片（`assets/js/ai-key.js`，组件走 chesterlee.cn CDN）；Key 由账户中心按 uid 加密托管，未登录时保存会提示先登录
- ✅ 浏览器扩展（v0.3.0）：高德/百度页读收藏、就地备注、搜索、距离排序、附近筛选，备注可多设备同步（`extension/`，详见下文）
- ✅ 扩展上架准备：三档图标、一键打包脚本、隐私政策页、Edge / 360 素材与上架文档（见 [plan/plan_store_上架总览.md](plan/plan_store_上架总览.md)）
- ⬜ 待办：在 `/admin` 分别扫码登录一次高德与百度（之后服务器自动同步，电脑不用开）
- 📄 需求：[plan/RPD_需求文档.md](plan/RPD_需求文档.md)

## 目录结构

```
map-notes/
├── README.md              # 本文件
├── plan/                  # 需求文档
├── usage/                 # 跑起来的步骤（Running.md）
├── dev/                   # 会话记录、可复制项目指南
├── brand/                 # Logo 与设计理念（logo-spec.html）
├── test/                  # 验收清单
├── site/                  # 对外官网（纯静态，零构建；深色大图 + 滚动动效）
│   ├── index.html
│   ├── privacy.html       # 隐私政策（商店必填 URL）
│   └── assets/{css,js,img}
├── extension/             # 浏览器扩展（MV3，零构建）
│   ├── manifest.json      # 版本 / 权限 / 图标（v0.3.0）
│   ├── background.js      # 工具栏图标开关侧栏 + 备注同步（Bearer 调 /api/notes）
│   ├── content.js         # 侧栏 UI、取数、备注、距离、同步状态
│   ├── site-auth.js       # 仅在本站跑：把 ps_token 转交给扩展
│   ├── icons/             # 16 / 48 / 128 三档图标
│   ├── lib/parse.js       # 高德/百度收藏解析、坐标转换、跨源去重
│   └── pack.py            # 一键打包上架 zip（按 manifest 收集 + 校验）
├── web/                   # 页面（纯静态，零构建）
│   ├── index.html
│   ├── stats.html         # 我的 · 收藏画像（账户 + 统计，纯前端计算）
│   ├── admin.html         # 同步管理（扫码登录高德 / 立即同步）
│   ├── assets/{css,js,img}   # config.js 填 Key；app.js 全逻辑；stats.js 收藏画像
│   └── data/              # 本机数据，不入库
│       ├── map-notes.db      # 多用户数据（SQLite：收藏 / 备注 / 偏好 / 状态，按 uid 隔离）
│       ├── qr/<uid>-<源>.png # 扫码登录二维码（按 uid）
│       └── login/<uid>-<源>.json # 登录状态（按 uid）
├── tools/
│   ├── store.py           # SQLite 数据层：按 uid 读写收藏 / 备注 / 偏好 / 状态
│   ├── paths.py           # 按 uid 的登录态、二维码、状态文件路径
│   ├── sync_all.py        # 多源汇总：逐源取数 → 去重 → 写数据库
│   ├── sources/           # 各源适配器（amap.py / baidu.py / base.py）
│   ├── coord.py           # 百度墨卡托 → BD-09 → GCJ-02
│   ├── sync.py            # 高德单源取数（备用）
│   ├── server_sync.py     # 单用户同步：无头 Chromium 抓收藏写数据库
│   ├── sync_worker.py     # 串行调度：扫描到期用户，逐个调 server_sync
│   ├── amap_login.py      # 扫码登录高德（/admin 触发，按 uid）
│   ├── baidu_login.py     # 扫码登录百度（/admin 触发，按 uid）
│   ├── systemd/           # 服务与定时器单元文件
│   ├── make_store_assets.py # 生成扩展图标 + Edge / 360 商店素材
│   └── serve.py           # 静态服务 + 按 uid 的数据接口 + 同步管理（不含登录页）
├── screenshots/           # 截图
└── inbox/                 # 临时素材
```

## 怎么跑

```bash
python3 -m http.server 8899 --directory site   # 预览官网（http://localhost:8899）
python3 tools/serve.py                 # 本地起服务（http://localhost:8931）
python3 tools/sync_all.py              # 本机取数（高德 + 百度，可见 Chrome，写入 uid=local）
python3 tools/sync_all.py --source baidu
python3 tools/sync_worker.py --dry-run # 看服务器上谁到期该同步
```

百度首次使用：`python3 tools/sync_all.py` 会弹出 Chrome，在窗口里扫码登录百度地图；登录态存 `.sync-profiles/local/baidu/`，之后直接复用。

线上同步不依赖你的电脑：

1. 手机打开 <https://map.chesterlee.cn>，登录统一账户后直接用（可加到主屏幕）。
2. 打开 `/admin` → 「扫码登录高德」→ 用高德 App 扫码（页面上的二维码）。
3. 之后服务器每小时检查一次，到期的用户串行同步；页面显示「更新于 X 小时前」，过期会标红并飞书提醒你。

> 一个高德账号对应一个 uid 的登录态；**换账号要重新扫码**，不会共用。

线上地址：<https://map.chesterlee.cn>。

### 访问保护（统一账户登录 + 白名单）

页面**没有口令页**，但数据默认锁着：未登录时打开只会看到「登录后查看」的登录墙，收藏、备注、同步状态以及 `data/*` 直链（已 404）一律拿不到。

链路：页面用账户中心 Token 调 `POST /api/session` → 服务端向 `https://account.chesterlee.cn/accountCenter` 的 `{action:"me"}` 换回 uid → uid 在白名单里才签发 7 天有效的签名 Cookie `mn_session`（HMAC-SHA256，HttpOnly）→ 之后 `/api/*` 都按这个 Cookie 取 uid，**所有数据按 uid 隔离**。

```bash
# /etc/map-notes/secrets.env（改完 sudo systemctl restart map-notes）
MN_OWNER_UID=u_你的uid               # 本人 uid（旧数据与旧登录态会迁到这个名字下）
MN_ALLOWED_UIDS=u_a,u_b,u_c         # 放行名单，逗号分隔，最多 30 个
MN_ALLOW_ALL_USERS=0                # 设为 1 则放行所有已登录账户（不建议）
MN_SESSION_SECRET=一串足够长的随机值   # 不配则进程内随机（重启后需重新登录）
MN_ACCOUNT_API=https://account.chesterlee.cn   # 可省，默认就是这个
```

全部留空＝不拦（公开单用户模式，数据落在 `local`）。

公开与受限的边界：`/`、`/admin.html`、`assets/*` 这类页面外壳和静态资源保持公开（否则登录墙自己都打不开），**所有数据接口需要登录，`data/` 下的文件一律 404**。`/admin.html` 打开后若未登录，接口返回 401，页面提示「请先在首页登录统一账户」。

> 注意：线上由 systemd 以 `--host 127.0.0.1` 启动，外部只能经 Caddy 进来；若哪天直接暴露端口，等于绕过这层保护。

另有一条备用方式（反向代理先鉴权、再注入用户名头），仍保留可用：`MN_AUTH_HEADER=X-Auth-User` + `MN_LOGIN_URL=...`，配了 `MN_AUTH_HEADER` 时优先按它判断。

地图需要在 [web/assets/js/config.js](web/assets/js/config.js) 填高德 Web 端 Key（不填也能用列表、搜索、距离和备注）。

细节见 [usage/Running.md](usage/Running.md)。

## 浏览器扩展（v0.3.0）

在 `extension/`，零构建。装法：Chrome / Edge 打开「扩展管理」→ 开启开发者模式 → 「加载已解压的扩展程序」→ 选 `extension/` 目录。

用法：

1. 先在地图网页登录高德或百度（收藏要能正常打开）。
2. 打开任意高德 / 百度地图页，右下角出现「留个点」，点开右侧栏。
3. 自动读取该站点收藏；两个站点各打开一次后，侧栏会合并双源、去重展示。
4. 点条目写备注，自动存本机；点「定位」后可按距离排序、筛 1/3/10km。

备注多设备同步（可选）：

- 侧栏底部显示同步状态：未登录是「登录后多设备同步」，登录后是「已同步 HH:MM」，失败是「同步失败，点此重试」。
- 点它跳统一账户登录；登录完成后回到任意地图页，扩展会自动拿到登录态（`site-auth.js` 从 `map.chesterlee.cn` 的 `ps_token` 转交），不需要在扩展里再登一次。
- 同步规则：本地与云端按备注的 `updatedAt` 取新的，双向补齐；清空备注会同时删掉云端那一条，不会「复活」。
- 上传的只有**备注文本**，收藏快照仍只在本机，不上传。

边界：收藏只读进本机缓存、不上传；不做导出/互导/写回地图。

服务端开关（扩展用户同步必需）：

```bash
# /etc/map-notes/secrets.env（改完 sudo systemctl restart map-notes）
MN_EXT_ALLOW_ALL=1        # 持 Bearer 账户 Token 的非白名单用户只能用 /api/notes，收藏/状态接口仍 401
MN_EXT_NOTE_LIMIT=2000    # 非白名单用户备注条数上限（改已有备注不占新额度）
```

限流：读 120 次/分钟、写 60 次/分钟（按 uid，进程内固定窗口，超限 429）。改完用 `curl https://map.chesterlee.cn/api/health` 确认返回里有 `"ext": true`。**所有备注按 uid 隔离，接口只认 Token 里的 uid。**

上架准备：

```bash
python3 tools/make_store_assets.py   # 图标 + Edge / 360 商店素材
python3 extension/pack.py            # 出上架包 release/map-notes-v0.3.0.zip
```

隐私政策：<https://map.chesterlee.cn/site/privacy.html>。上架流程见 [plan/plan_store_上架总览.md](plan/plan_store_上架总览.md)、[plan/plan_edge_store.md](plan/plan_edge_store.md)、[plan/plan_360_store.md](plan/plan_360_store.md)。

需求与验收：[plan/RPD_浏览器扩展.md](plan/RPD_浏览器扩展.md)。

## 边界（不做的）

导出、备份按钮、手动导入、批量编辑、评分、照片、行程统计、年度报告、回写高德。
理由：你只要「写备注 + 找附近的」。

## 相关文档

- 需求：[RPD_需求文档.md](plan/RPD_需求文档.md)、[RPD_多地图源收藏接入.md](plan/RPD_多地图源收藏接入.md)
- 扩展：[RPD_浏览器扩展.md](plan/RPD_浏览器扩展.md)、[上架总览](plan/plan_store_上架总览.md)、[Edge](plan/plan_edge_store.md)、[360](plan/plan_360_store.md)、[隐私政策](site/privacy.html)
- 分析：[可行性分析_高德收藏地点再编辑H5.md](../Idea/可行性分析_高德收藏地点再编辑H5.md)、[可行性分析_高德出行数据二次分析.md](../Idea/可行性分析_高德出行数据二次分析.md)
- 记录：[dev/session_log.md](dev/session_log.md)
- 规则：[.trae/rules/project_rules.md](.trae/rules/project_rules.md)
