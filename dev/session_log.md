# 会话记录 · map-notes

> 每条固定 6 段：目标 / 已做 / 关键结论 / 产出物 / 待办 / 风险。

---

## 2026-11-03 会话条目：建工作区骨架（已完成）
- **目标**：按「先不开始写代码，先建设工作区」的要求，把 `map-notes` 项目从零搭到可开工。
- **已做**：跑 `new-project-scaffold` 建骨架（web 型）；改写 `.trae/rules/general_rules.md` 头部；派生 `.trae/rules/project_rules.md`；补 `.gitignore`（`data/`、`web/data/`、`.env`）；写 README / Running / RPD v0.2 / 本记录；建独立工作区文件；登记进规划库台账。
- **关键结论/决定**：项目名 `map-notes`；形态＝一打开就是地图、手机也要能打开；功能收缩为 5 个 P0（自动取数 / 地图首屏 / 附近排序 / 搜索 / 备注即存）+ 手机可访问；不做导出、不做导航、不预纠偏坐标。
- **产出物**：`README.md`、`plan/RPD_需求文档.md`、`usage/Running.md`、`dev/session_log.md`、`map-notes.code-workspace`、`.trae/rules/*`。
- **待办**：① 你确认 RPD；② 申请高德 Web 端 Key；③ 决定手机取数方式（局域网 or 部署）；④ 再开 P0 编码。
- **风险/注意事项**：手机 http 下浏览器禁 GPS（改用地图点选）；高德内部接口可能改字段（失败保留上次数据）。

---

## 2026-11-03 会话条目：P0 开发完成 + 架构定案（已完成）

- **目标**：落实「备注写回 notes.json」「手机走自有域名」两项决定，完成 P0 全部代码并本地自测。
- **已做**：写 `tools/sync.py`（登录态抓 cloudSync → 灵活解析 → z=20 像素反算 → 去重 → 写 JSON，失败保留旧数据）；写 `tools/serve.py`（静态服务 + `GET/POST /api/notes`，原子写、线程锁、端口 8931）；写前端四件套（地图撒点 / 距离排序 / 搜索 / 备注 500ms 即存 + 关页补存 / 窄屏抽屉 / 四类兜底）；补 `.gitignore` 的 `.sync-profile/`；回灌 RPD v0.3、README、Running。
- **关键结论/决定**：备注与收藏分离成 `favorites.json` + `notes.json`，同步永不覆盖备注；页面必须经 `serve.py` 打开（放弃 `file://` 与 IndexedDB）；部署方案为 Caddy 反代 `serve.py` + Basic Auth；验收点数为 ≥250（82 条收藏夹容器无坐标，原 350 的口径不可达）。
- **产出物**：`tools/sync.py`、`tools/serve.py`、`web/index.html`、`web/assets/css/style.css`、`web/assets/js/{config.js,app.js}`、`plan/RPD_需求文档.md`（v0.3）、`README.md`、`usage/Running.md`。
- **待办**：① 你在高德开放平台申请 JS API Key + 安全密钥并填 `config.js`；② 跑一次 `sync.py` 出真实数据；③ 本地浏览器验收；④ 定子域与 Basic Auth 后部署、手机验收。
- **风险/注意事项**：高德 JS Key 域名白名单（localhost / 正式域名）；公网部署必须开 Basic Auth；本机 8921 已被 coros-dashboard 占用，本项目改用 8931；像素反算已用样例验证得出 (113.9544, 22.5330)，真实数据首次同步时仍需看日志核对。

---

## 2026-11-03 会话条目：上线 map.chesterlee.cn（已完成）

- **目标**：把 P0 站点挂到自有域名，手机在任何网络都能用；数据以服务器为准。
- **已做**：页脚补 ICP + 公安备案号 + 官方图标（`web/assets/img/beian-police.png`，样式加 `.mn-footer`）；阿里云加 A 记录 `map` → `43.136.92.125`（浏览器接管真实 Chrome 操作，含「解析变更确认」二次弹窗）；服务器建 `/srv/chesterlee/map`（`web/` + `tools/serve.py`），新建 `map-notes.service` → `127.0.0.1:8931`；Caddyfile 加 `map.chesterlee.cn` 反代块并 reload（自动签证书）；`sync.py` 加 `--upload`（scp 上传 favorites.json + 拉回服务器 notes.json）。
- **关键结论/决定**：**不设访问密码**（你的决定，单人自用，风险已知）；数据以服务器为准；部署台账 §二 / §2.1 / §2.2 / §六 已回填。
- **产出物**：`web/index.html`（页脚）、`web/assets/css/style.css`（`.mn-footer`）、`web/assets/img/beian-police.png`、`tools/sync.py`（`--upload`）、`README.md`、`usage/Running.md`、`plan/RPD_需求文档.md`、`部署上线备案/README.md`。
- **待办**：① 在 `config.js` 填高德 JS Key 并把 `map.chesterlee.cn` 加进 Key 白名单；② 跑 `python3 tools/sync.py --upload` 出真实数据；③ 手机验收。
- **风险/注意事项**：公网无密码，任何知道域名的人都能读收藏、改备注；线上备注只存在服务器 `web/data/notes.json`，本机靠 `--upload` 拉回；`/srv/chesterlee/map/web/data` 不能随 `rsync --delete` 覆盖。

## 2026-11-03 会话条目：真实数据接入（已完成）

- **目标**：把高德真实收藏抓下来，并在线上页面跑通。
- **已做**：修 `sync.py` 两处真问题——① 等待循环把「items 为空的返回」误当成成功（未登录时秒退），改为「有地点才返回」，并每 30 秒重进收藏页触发重新拉取；② 接口真实结构是变更流 `{type,id,act,ts,data}`，记录体在 `data` 里，`normalize` 改为按 id 取最新 ts、`act=d` 丢弃（`skipped.deleted` 计数）。跑 `python3 tools/sync.py --upload`：359 条 → 349 个点（lonlat 307 / 像素反算 42），上传服务器并拉回备注。
- **关键结论/决定**：高德 Key 在 `.env` 与线上 `config.js` 一致，实测线上地图正常渲染，**无需加域名白名单**；线上验收：`更新于 … · 349 个点`、3 km 内 10 个、关闭半径后 349 个、列表按距离升序、页脚备案齐全。
- **产出物**：`tools/sync.py`、`web/data/favorites.json`（349 点）、`/srv/chesterlee/map/web/data/favorites.json`。
- **待办**：手机端验收（定位、备注双向一致）；决定是否加访问密码；P1（标签筛选 / 在高德打开 / Key 页面自填 / 手动加点）。
- **风险/注意事项**：调试产物 `_raw_cloudSync.json` 含全量收藏，已删除；改 `normalize` 后旧数据结构若再变（如 `data` 改名）要先看 `--debug` 原始返回。
---

## 2026-11-03 会话条目：手机优先改造（口令登录 + 服务器自动同步）（已完成）

- **目标**：按「肯定是手机端使用」重做数据同步与登录方式——手机上不碰电脑也能更新收藏，登录一次长期免输。
- **已做**：① `serve.py` 重写：口令登录 `POST /api/login` 下发 HMAC-SHA256 签名的 365 天 Cookie（`mn_auth`，HttpOnly/SameSite=Lax/Secure），未登录 302 → `/login?next=`、接口 401，同 IP 10 分钟 8 次失败即拒；新增 `/api/status`、`/api/amap/*`、`/api/sync/run`、`/api/health`；`spawn_tool()` 互斥拉起子进程。② 新增 `web/login.html`（手机优先：16px 输入防缩放、48px 按钮、`next` 同源校验）、`web/admin.html`（扫码登录 / 二维码每 2s 刷新 / 立即同步 / 新鲜度 / 清除登录态，20s 轮询状态）。③ 新增 `tools/server_sync.py`（服务器无头抓 cloudSync，写 `sync-status.json`，点数不足旧数据一半时保留旧数据，失败推飞书且 24h 去重）。④ 新增 `tools/amap_login.py`（无头打开高德收藏页，截近似正方形二维码元素，失败退回整页；写 `amap-login.json`）。⑤ 服务器建 `.venv`、装 Playwright Chromium（改 npmmirror 源）、`/etc/map-notes/secrets.env`（600）、三个 systemd unit（常驻 / oneshot / 每天 07:30±30min 定时器）。⑥ 回灌 README、Running 第四节、RPD v0.4。
- **关键结论/决定**：同步触发＝服务器（电脑不参与日常）；访问保护＝口令页 + 一年 Cookie（否掉 Caddy Basic Auth）；失效提醒＝页面 + 飞书（Mac 通知在关机时收不到）；服务器保存高德登录态（用户已确认，配 `.gitignore` 排除 + `/admin` 一键清除 + 每天 1 次请求 + 连续失败自动停）。
- **产出物**：`tools/serve.py`（重写）、`tools/server_sync.py`、`tools/amap_login.py`、`tools/systemd/{map-notes,map-notes-sync}.service`、`map-notes-sync.timer`、`web/login.html`、`web/admin.html`、`web/index.html`（页脚「同步」入口）、`README.md`、`usage/Running.md`、`plan/RPD_需求文档.md`（v0.4）、`.gitignore`（`.amap-profile/`）。
- **待办**：① 你去 `https://map.chesterlee.cn/admin` 扫码登录高德一次（同一台手机：长按二维码存相册 → 高德 App 扫一扫 → 右上角相册）；② 提供飞书自定义机器人 webhook 填 `FEISHU_WEBHOOK`；③ 次日核对 `sync-status.json` 的 `lastSuccessAt` 与点数。
- **风险/注意事项**：口令与签名密钥只在 `/etc/map-notes/secrets.env`，改口令需同时换 `MN_SECRET` 让旧 Cookie 失效；`.amap-profile` 与 `web/data` 都不能被 `rsync --delete` 覆盖；高德登录态约一年有效，失效后页面标红 + 飞书提醒，重扫即可。
---

## 2026-11-03 会话条目：手机端地图清晰度（超采样）（已完成）

- **目标**：解决手机 3x 屏上底图发糊（用户反馈「地图的清晰度极低」）。
- **已做**：`app.js` 加 `SS = devicePixelRatio > 2 ? 2 : 1`；为真时给 `<html>` 加 `mn-ss`，`#map` 按 200%×200% 布局 + `transform: scale(0.5)`（style.css），缩放级别 `+ZOOM_SHIFT(1)` 保持可视范围不变，标记尺寸与 `offset` 同步 ×2；`.mn-map-fallback` 从 `#map` 内移到 body 直下（否则会被一起拉大）。用真实 Chrome + CDP 实测：dpr3 下 canvas `1560x3376`（原 `780x1688`），可视经纬跨度与不超采样完全一致（lngSpan 0.13390 / latSpan 0.25298），pin 视觉尺寸不变（18×18），点标记能正常打开详情。
- **关键结论/决定**：高德 JS API 2.0 把像素比硬钳在 2（`dpr` 构造参数、`setStatus({dpr})` 均无效），只能靠容器超采样绕过；只在 dpr>2 时开启，桌面视网膜屏不加负担。
- **产出物**：`web/assets/js/app.js`、`web/assets/css/style.css`、`web/index.html`、`README.md`（v0.5），已 `rsync` 到 `/srv/chesterlee/map/web/`。
- **待办**：手机实机看一眼清晰度是否可接受；若老机型卡顿，可把 `SS` 条件收紧。
- **风险/注意事项**：超采样后画布像素 ×4（约 5.3M px），首屏底图加载会比以前慢 1–2 秒；`transform` 靠浏览器缩放合成，个别旧 WebView 可能不支持合成缩放。
---

## 2026-11-03 会话条目：用真实 Chrome 走查手机端，逐项修 UX（已完成）

- **目标**：你说「页面有很多需要优化调整的内容」，要求接管浏览器全面测试后一一修。
- **已做**：用本机真实 Chrome（CDP，`/tmp/mn-cdp-profile`）+ Playwright 接管，按 390×844（iPhone）、320×700（SE）、1280×860（桌面）三档走查首页、列表、详情、备注、搜索、半径、定位、`/admin`，逐条修：
  1. 「更新于 2026-11-03 01:53」改为相对时间「更新于 14 小时前」，超 72 小时显示「超过 3 天未同步」并标红；「跳过 N 条无坐标」移入 `title`。
  2. 搜索框 15px → 16px、备注框 14px → 16px（iOS 聚焦不再自动放大）。
  3. 备注框去掉缩放把手（`resize:none`）、随内容自动增高（上限 36vh）。
  4. 页脚备案信息由「一整段文字」改为 flex 分项、链接 `nowrap`，窄屏不再把「甘公网安备62052302000062号」拆行。
  5. 空状态（搜不到 / 附近没有）改为在抽屉内垂直居中，不再贴在底部。
  6. 半径按钮在未定位时显示「全部」并可点，点了提示「先点 ◎ 定位」；不再是无反馈的灰按钮。
  7. 点地图空白处可关闭详情卡（点选位置模式下仍优先设定位置）。
  8. 修 `setPosition` 缩放少加 `ZOOM_SHIFT`（超采样屏上定位后视角偏小一档）。
  9. `/admin`：修 `.row{display:flex}` 压过 `[hidden]` 导致「上次失败」空行常显；`清除登录态` 只在有效时可用；`立即同步` 失败后按钮卡死（`this` 指向错）修好；同步错误归到「收藏数据」卡；补 `safe-area-inset-top`；登录成功后自动刷新状态。
  10. 列表关闭详情后保留滚动位置；点抽屉标题栏也能展开/收起（原来只有 5px 小白条可点）。
  11. 加 emoji favicon；桌面搜索框限宽 464px。
- **关键结论/决定**：只改前端（`app.js` / `style.css` / `index.html` / `admin.html`），接口与部署方式不动；`serve.py` 本轮未改。
- **产出物**：`web/assets/js/app.js`、`web/assets/css/style.css`、`web/index.html`、`web/admin.html`、`README.md`（v0.7）、`plan/RPD_需求文档.md`（v0.7）。
- **待办**：手机上再实际点一遍（尤其 Safari 加到主屏幕后的安全区与键盘遮挡）。
- **风险/注意事项**：Chrome CDP 的移动模拟与真机 Safari 仍有差异，CSS `dvh`、`env(safe-area-inset-*)` 只能真机确认；本次没有改动地图超采样逻辑。
---

## 2026-11-03 会话条目：去掉口令页，改预留统一账户登录（已完成）

- **目标**：按你的要求撤掉口令页——后续接统一账户登录，手机打开即用。
- **已做**：① 删 `web/login.html`；`serve.py` 移除口令 / HMAC Cookie / 失败限流 / `/api/login` / `/api/logout` / `/login` 路由（-约 90 行）；② 改成「信任反代注入的用户头」：`MN_AUTH_HEADER`（如 `X-Auth-User`）配了才校验，为空＝公开；`MN_LOGIN_URL` 决定未登录页面跳转，不配则 401；`/api/health` 始终公开；③ `/admin` 删掉「账号 / 退出登录」卡片；④ 回灌 README（v0.6，含 Caddy `forward_auth` 示意）、Running、RPD v0.6；⑤ 清理 `.env` 与服务器 `secrets.env` 里的 `MN_PASSWORD` / `MN_SECRET`。
- **关键结论/决定**：鉴权统一放在反代层（统一账户登录），`serve.py` 只认用户头、不碰账号体系；线上仍以 `--host 127.0.0.1` 启动，防止外部绕过反代伪造头。
- **产出物**：`tools/serve.py`、`web/admin.html`、`README.md`（v0.6）、`usage/Running.md`、`plan/RPD_需求文档.md`（v0.6）、`.env`（删旧口令）、删 `web/login.html`。
- **待办**：① 统一账户登录接好后，在服务器 `secrets.env` 填 `MN_AUTH_HEADER` / `MN_LOGIN_URL` 并重启；② 仍未做的：`/admin` 扫码登录高德、飞书 webhook。
- **风险/注意事项**：当前站点公开，任何知道域名的人都可改备注、点「清除高德登录态」；这是明确接受的中转状态，别把域名外传。
---

## 2026-11-03 会话条目：线上全面走查补修 v0.7.1（已完成）

- **目标**：在已上线的 map.chesterlee.cn 上再走一遍手机端 / 后台，把走查发现的小问题一并修掉。
- **已做**：① 详情卡未编辑时隐藏「只有圆点没有文字」的保存行（`saveRow`），编辑后才出现「保存中 / 已保存」；② 列表计数从「3 个」改为「附近 3 个 / 找到 3 个 / 共 349 个」，定位与筛选状态一眼可辨；③ `/admin` 长错误文案不再把 `/admin` 从中间断行（`word-break: break-all` → `overflow-wrap: anywhere`）；④ 修服务器扫码登录：原逻辑只试「扫码登录 / 扫码」文字，过期登录态下页面只有头像入口，导致一直拿整页截图当二维码；改为「头像 → `button.login-button` → 文字兜底」并用鼠标点元素中心，二维码改为元素截图（292×292）；⑤ `/admin` 二维码出现后自动滚动到可见区；⑥ 桌面详情卡补 `box-sizing: border-box`，宽度从 408 回到 376。
- **关键结论/决定**：二维码整页截图的根因是「登录弹层没打开」，不是截图尺寸；改成先点开头像气泡里的「登录」按钮再截元素。登录仍是用户本人扫码，脚本不代登录。
- **产出物**：`web/assets/js/app.js`、`web/index.html`、`web/admin.html`、`web/assets/css/style.css`、`tools/amap_login.py`、`README.md`（v0.7.1）、`plan/RPD_需求文档.md`（v0.7.1）。
- **待办**：① 你在 `/admin` 重新点「扫码登录高德」并扫码（二维码有效期 5 分钟）；② 统一账户登录接入；③ 飞书 webhook；④ 真机 Safari 确认键盘与安全区。
- **风险/注意事项**：线上二维码流程已实测能出可扫的码，但每次登录尝试只有 5 分钟，超时需重新点；本次未改同步与鉴权逻辑。
---
## 2026-11-04 会话条目：手机地图交互修复 v0.9.6（已完成）

- **目标**：解决手机上「放大地图时选中点不在中间、越放越往下跑」以及地图可视区太小的问题；电脑端保持原样。
- **已做**：① 移除 v0.5 的超采样（`#map` 200% + `transform: scale(0.5)` 与 `SS`/`ZOOM_SHIFT` 相关代码），恢复高德原生坐标与手指位置一致；② 手机底部抽屉默认高度 40dvh → 32dvh（提示条同步上移），地图可视区变大；③ 新增 `focusPoint()`：选中列表项 / 点「◎ 定位」时，按底部卡片实际高度计算偏移，把点摆到未被遮挡区域的正中；桌面（≥900px）不加偏移。
- **关键结论/决定**：可用性优先于清晰度——CSS transform 超采样会让高德内部容器尺寸与可视尺寸不一致，导致点击与缩放锚点错位，无法可靠补偿，故整体撤销。
- **产出物**：`web/assets/js/app.js`、`web/assets/css/style.css`、`README.md`（v0.9.6）、`plan/RPD_需求文档.md`（v0.9.6）；已 `rsync` 到 `/srv/chesterlee/map/web/`。
- **待办**：真机再点一遍：双指缩放锚点、点选详情卡时点的位置、32dvh 抽屉后的列表可读性。
- **风险/注意事项**：手机 3x 屏底图会回到「钳到 2x」的清晰度，可能略软；若之后仍嫌弃模糊，优先考虑改高德底图图层或换方案，不要再用 transform 缩放整个容器。
---

## 2026-11-04 会话条目：手机详情卡「返回」与选中点居中修正 v0.9.8（已完成）

- **目标**：你在真机反馈「选中的点不在中间、放大一次往下跑」，并要求手机上有明显的「返回上一级」。
- **已做**：① 详情卡左上角加「‹ 返回」按钮；② 详情打开时 `history.pushState`，系统返回键 / Safari 侧滑返回先关详情回列表（`popstate`；主动关闭产生的回退用标记吞掉，避免误退出）；③ 手机看详情时隐藏顶部来源筛选与「更新于 / 已定位」条，地图可视区从约 40% 提到约 67%；④ 修正 `focusPoint` 的居中算法：原来把目标像素直接设为中心，点会落到对称位置（实测目标 347、实际 499）；改为取 `height - targetY` 的对称点，实测落到 349（约等于可视区正中）。
- **关键结论/决定**：上轮移除超采样后缩放锚点已正常；这次用真实 Chrome + CDP（390×844）验证：详情打开 → 点 y=349（可视区 64–630 的正中）→ 点「返回」列表恢复 → `history.back()` 只关详情不离开页面。
- **产出物**：`web/index.html`、`web/assets/js/app.js`、`web/assets/css/style.css`、`README.md`（v0.9.8）、`plan/RPD_需求文档.md`（v0.9.8）；线上已包含以上改动。
- **待办**：真机点一遍「返回」与系统返回键；如果还觉得地图小，下一步考虑抽屉默认再压到 26–28dvh 或加「全屏地图」开关。
- **风险/注意事项**：另一会话同时在改「访问保护」，版本号由 v0.9.7 接到 v0.9.8；两边都在改 `web/`，后续部署前先确认文件已包含双方改动。
---
## 2026-11-04 会话条目：多用户改造（30 人白名单）v0.9.9（代码完成，待上线验证）

- **目标**：把「单人自用」扩到白名单 30 人；每人登录后各自扫码绑定地图账号、各自自动同步，**全程不需要手动录入/导入数据**。
- **已做**：① 新增 `tools/store.py`（SQLite：`users / favorites / notes / display / kv`，全部带 uid）+ `tools/paths.py`（登录态、二维码、登录状态按 uid 分目录）；② `tools/serve.py` 全部数据接口改为按会话 uid 读写，新增 `GET /api/favorites`，`/data/*` 一律 404，`/api/health` 返回 `mode/users`；③ 登录/同步接口按 uid 起进程（`amap_login:uid`、`server_sync:uid`），扫码二维码与登录状态互不覆盖；④ `sync_all.py` / `server_sync.py` 支持 `--uid` 写数据库；⑤ 新增 `tools/sync_worker.py`：每小时扫描「已绑定且距上次尝试 ≥ 20 小时」的用户，**串行**抓取、每批 2 个、单用户 240 秒超时；⑥ systemd 定时器改为每小时触发 worker；⑦ `.gitignore` 增加 `.sync-profiles/`、`*.db`、`.sync-worker.lock`；⑧ 前端 `app.js` 收藏改走 `/api/favorites`。
- **关键结论/决定**：2C2G 只能串行（一个无头 Chrome 约 400–600MB，并发 2 会 OOM）；同出口 IP 30 个账号按 20 小时一次、只读收藏，属可接受范围，后续观察掉登录频率再调；旧单份 JSON 与旧登录态在启动时一次性迁到 `MN_OWNER_UID` 名下。
- **验证**：`py_compile` 全过；两个 uid 的备注/偏好互不可见；匿名与陌生 uid 均 401；`/api/status` 返回正确 uid；`/data/map-notes.db` 404；`sync_worker.py --dry-run` 能正确列出到期用户。
- **产出物**：`tools/store.py`、`tools/paths.py`、`tools/sync_worker.py`、`tools/serve.py`、`tools/sync_all.py`、`tools/server_sync.py`、`tools/amap_login.py`、`tools/baidu_login.py`、`tools/systemd/*`、`web/assets/js/app.js`、`.gitignore`、`README.md`（v0.9.9）、`plan/RPD_需求文档.md`（v0.9.9）、`usage/Running.md`、`.trae/rules/project_rules.md`。
- **待办**：① 线上部署（`tools/` + `web/`，排除 `data/`、`.sync-profiles/`）+ 重启服务；② `secrets.env` 增加 `MN_ALLOWED_UIDS`（30 个）、确认 `MN_SESSION_SECRET`；③ 装新 timer（每小时）；④ 服务器上验证旧数据与旧登录态已迁到本人 uid；⑤ 走一遍「白名单账户登录 → 扫码绑定 → 自动同步」闭环。
- **风险/注意事项**：本机测试时旧登录态 `.sync-profile/` 被迁移到临时目录后随 `/tmp` 清理删除，**本机下次取数需重新扫码一次**（服务器上的登录态不受影响）；`paths.migrate_legacy` 已加保护：设置了 `MN_PROFILES` 时不再搬动项目里的真实登录态。
---
## 2026-11-04 会话条目：多用户版本上线（v0.9.9 → 线上 v0.10.1 环境）

- **目标**：把多用户改造部署到 `43.136.92.125`，完成旧数据/旧登录态迁移，换每小时串行 worker，验证自动同步闭环。
- **已做**：① 备份 `web/data` + `.sync-profile`（22MB）+ `secrets.env` + 旧 unit 到 `~/backups/`；② rsync `tools/`（不含 `__pycache__`）与 `web/`（排除 `data`、`assets/js/config.js`）；③ `secrets.env` 追加 `MN_ALLOWED_UIDS=`（待填 30 个）+ `MN_ALLOW_ALL_USERS=0`；④ 安装新 `map-notes-sync.service`（调 `sync_worker.py`）+ `map-notes-sync.timer`（每小时），`daemon-reload` 并重启 `map-notes`。
- **迁移结果**：旧数据 → `uid=u_7ad0ee59bb400e2c`：收藏 513、备注 1、来源偏好；旧 JSON 改名 `*.migrated`；旧登录态 `.sync-profile` → `.sync-profiles/u_7ad0ee59bb400e2c/{amap,baidu}`。
- **验证**：`/api/health` → `mode=allowlist, users=1`；域名首页 200、匿名与陌生 uid 均 401、`/data/*` 404；本人会话拿到 513 个点且 `amap/baidu` 登录态均 `ok`；`sync_worker --dry-run` 正确列出 1 个到期用户；手动跑通同步：高德 351 + 百度 163 → 514 个点写库，用时 10 秒，`lastSuccessAt` 更新，timer 下一轮 18:06。
- **修复**：① 静态页面请求会因 `data_uid()` 回退凭空造出 `local` 用户 → 改为只有已登录请求才 `touch_user`；② 旧数据迁移后 `users` 表没有本人 → `store.migrate_legacy` 里补 `touch_user(uid)`；已清理服务器上的空 `local` 行。
- **待办**：把 30 个白名单 uid 填进 `MN_ALLOWED_UIDS`（或临时 `MN_ALLOW_ALL_USERS=1` 放开），再让白名单用户各自走「登录 → 扫码绑定 → 自动同步」。
---
## 2026-11-06 会话条目：默认全部 + 搜索面板（Web v0.10.2，已上线）

- **目标**：列表默认显示全部（不再默认 3 km 内）；搜索框聚焦时参考高德 App，给「距离快捷 / 历史搜索 / 经常去的地方」。
- **已做**：`state.radiusOnly` 默认 `false`、`radiusBtn` 初始「全部」；新增 `state.radius` 支持 500m/1km/3km/5km/10km 快捷档；搜索框聚焦弹出 `#searchPanel`（距离 chips + 历史搜索 + 经常去的地方 + 完成）；历史存 `localStorage: mn-history`（8 条，可清空）；常去按 `localStorage: mn-visits` 详情打开次数排前 6；输入关键词、点完成或点面板外即收起；选中条目时若有关键词会自动记入历史。
- **关键结论**：高德的「热门地标」是全网统计，本站没有该数据源，改为**自己的**「经常去的地方」（按打开详情次数），更贴合个人使用；距离档位与历史/常去都只存本机浏览器，不跨设备同步。
- **验证**：`node --check` 通过；HTML 新增 id 全部存在、JS 函数齐全；已 rsync `web/` 上线，`index=200`、页面与脚本均含新结构。
- **产出物**：`web/index.html`、`web/assets/js/app.js`、`web/assets/css/style.css`、`README.md`（v0.13.1）、`plan/RPD_需求文档.md`（v0.10.2）。
- **待办**：真机各点一遍（聚焦搜索、500m/5km、历史清空、常去直达）；白名单 30 个 uid 仍待填。
---
## 2026-11-06 会话条目：距离筛选二合一（Web v0.10.3，已上线）

- **目标**：抽屉头「全部 / N km 内」按钮与搜索面板里的「直线距离」快捷档重复，合并为**一个入口**。
- **已做**：删除 `#searchPanel` 内的「直线距离 / #nearLabel / #distanceChips」，搜索框聚焦后只给历史搜索、经常去的地方、提示与「完成」；`#radiusBtn` 改为下拉开关，点开 `#radiusMenu`（两列 6 个档位：全部 / 500 m / 1 km / 3 km / 5 km / 10 km，当前档高亮），选中即改 `state.radius` + `radiusOnly` 并收起；未定位选非「全部」档提示先定位；点按钮外、点搜索框、点「完成」各自只关闭自己的浮层。
- **关键结论**：距离是「对列表全局过滤」，天然属于抽屉头；搜索面板只放「找东西」的辅助（历史 / 常去），两处不再重复；下拉用两列小卡片，收起态 32dvh 也放得下，不遮地图。
- **产出物**：`web/index.html`、`web/assets/js/app.js`、`web/assets/css/style.css`、`README.md`（v0.13.2）、`plan/RPD_需求文档.md`（v0.10.3）；已 rsync 到线上。
- **验证**：`node --check` 通过；`distanceChips` / `nearLabel` 残留引用为 0；线上 `index=200`，首页含 `radiusMenu`、脚本含 `renderRadiusMenu`（2 处）且无 `distanceChips`。
- **待办**：你在手机上点一遍「全部」按钮展开 / 选 500 m 或 5 km / 点外面收起；未定位时先看是否提示。
- **风险/注意事项**：`#radiusMenu` 用绝对定位挂在 `.mn-sheet` 内，top 固定 58px；若以后改 `.mn-sheet-head` 高度，需要同步这个值。
---

## 2026-11-04 会话条目：手机列表框支持上/下拉手势 v0.10.1（已完成）

- **目标**：你在手机上想把列表往上拉，但之前只有「点横条切换」，拖拽完全没反应。
- **已做**：抽屉顶部横条加指针手势——上拉 ≥24px 展开到 72dvh，下拉 ≥24px 收回到 32dvh；轻点仍切换；拖完 400ms 内吞掉 click，避免连开两次；`touch-action: none` 防止 iOS 拖动时页面跟着滚。列表区滚动不受影响，「3 km 内」「来源设置」按钮单独排除，不会误触发。
- **关键结论/决定**：手势只在顶部横条（含小手柄）生效，不在列表内容区生效——避免和列表滚动抢手势。
- **产出物**：`web/assets/js/app.js`、`web/assets/css/style.css`、`README.md`（v0.10.1）、`plan/RPD_需求文档.md`（v0.10.1）；已 rsync 到线上，`last-modified` 08:22:20 GMT。
- **验证**：真实 Chrome + CDP，390×844 实测：上拉 270→608px、下拉 608→270px、点横条展开、点「3 km 内」抽屉状态不变。本机测试用 ps-auth.js 桩绕开账户中心跳转（服务端 8951 未开访问保护）。
- **待办**：真机再用手指拖一次确认手感（阈值 24px 是否合适）。
- **风险/注意事项**：多个会话同时在改 `web/` 与文档，版本已到 v0.10.x；部署前确认本地文件包含各会话改动。
---
## 2026-11-05 会话条目：扩展上架准备（Edge / 360 经验移植）v0.12.0（已完成）

- **目标**：把「微信读书插件」已验证的浏览器扩展与商店上架经验搬进本项目，重点补齐 Edge / 360 上架所需的技术件、素材与流程文档。
- **已做**：① 扩展加 16/48/128 图标、`icons` 与 `action.default_icon`、`homepage_url`，版本 0.1.0 → **0.2.0**；② 新增 `extension/pack.py`（按 manifest 自动收集、缺失即中止），跑通出包 `release/map-notes-v0.2.0.zip`（7 个运行文件，24.4 KB）；③ 新增 `tools/make_store_assets.py`（Pillow 重绘品牌图标 + Edge 300/440×280/1400×560 + 360 192/472×296/1120×700/560×350，有真实截图时自动入槽）；④ 新增 `site/privacy.html`（扩展 + 网站口径，覆盖权限、数据边界、Cookie、删除方式），官网页脚挂链接；⑤ 新增 `plan/plan_store_上架总览.md` / `plan/plan_edge_store.md` / `plan/plan_360_store.md`（含共享文案、隐私页逐框答案、审核备注、crx 打包命令、归档表、资料来源）；⑥ `.gitignore` 补 `*.crx`、`release/`。
- **关键结论/决定**：① 只搬本项目用得上的经验，不引入 i18n / 埋点 / popup；② 商店文案统一「收藏只在本机读取、不上传」，与代码一致；③ 360 以创作者中心 `creative.360.com` 为准（crx 直传、图标 192、封面 472×296、推荐图 1120×700），旧开放平台只作参考；④ 隐私政策同时覆盖扩展与网站，扩展侧明确「当前备注仅存本机」。
- **产出物**：`extension/manifest.json`、`extension/icons/*`、`extension/pack.py`、`tools/make_store_assets.py`、`site/privacy.html`、`site/index.html`、`plan/plan_store_上架总览.md`、`plan/plan_edge_store.md`、`plan/plan_360_store.md`、`plan/RPD_浏览器扩展.md`、`README.md`（v0.12.0）、`.gitignore`；生成物 `release/微软商店-上传/`、`release/360-素材/`、`release/map-notes-v0.2.0.zip`。
- **待办**：① **拍 4–6 张真实截图** 放 `screenshots/store/store-*.png`（1280×800），重跑素材脚本自动入槽；② 隐私页同步上线：`rsync -az --delete site/ ubuntu@43.136.92.125:/srv/chesterlee/map/site/`，无痕确认 URL 200；③ 提交前把 `plan/RPD_浏览器扩展.md` 里搜索 / 距离 / 双源三项验收跑完；④ 登录 Partner Center 新建扩展提交；⑤ 360 先实测 MV3，再打 crx（`.pem` 存仓库外）提交。
- **风险/注意事项**：审核员没有你的地图账号，只能看到入口与空态——审核备注已写明「无需账号验证 UI，登录自己账号可看自己的收藏」，不要提供他人账号；360 的 `.crx` 必须复用 `.pem`，否则应用 ID 变化等于重新上架；`release/` 已整体不入库，素材由脚本可重建。
---
## 2026-11-06 会话条目：我的 · 收藏画像（Web v0.11.0）

- **目标**：回答「数据存哪 / 是否每次实时抓 / 要不要服务器」，并把收藏数据做成一个独立分析栏目：入口复用首页右上头像，进去先显示统一账户，其余统计都在这一页。
- **已做**：① 新增 `web/stats.html` + `assets/css/stats.css` + `assets/js/stats.js`（约 900 行），纯前端读 `/api/favorites` + `/api/notes` + `/api/status` 单次遍历聚合；② 首页 `account.js` 头像点击由「账户中心」改为 `location.href='stats.html'`，并导出 `accountWeb` 供页面内按钮复用；③ 页面模块：账户卡（头像 / 昵称 / 邮箱掩码 / 新鲜度）、KPI 四格、年度 + 近 12 个月时间线、城市足迹、收藏类型、来源环形图、常用标签、收藏范围（跨度 / P50·P80 / 最远两点 / 区县 Top8）、备注画像、趣味事实、免责声明；④ 城市 / 区县解析只认地址开头的「X市 / X自治州 / X地区 / X盟」，加黑名单排除「超市 / 市场 / 夜市 / 股市」等误判；⑤ 401/403 显示登录墙，无数据显示空状态；⑥ README 升 v0.14.0、RPD 升 v0.11.0 并补 `### M8` 详细需求。
- **关键结论/决定**：统计**不上服务器、不新增接口**——数据本来就在 `web/data/map-notes.db`，浏览器读三个已有接口即可，符合项目「不做导出 / 不上传」边界；明确「收藏 ≠ 到访」，不做行程或到访报告；手机窄屏单列、宽屏两列。
- **验证**：`node --check` 通过；本机 `serve.py --port 8950` 实测 `/api/favorites` 200、513 条、`syncedAt=2026-11-04T13:40:44+08:00`；真实 Chrome 截图核对：账户卡显示「本地账户 / 未连接统一账户 · 2 天前更新」，KPI 513 / 0% / 31 / 4 年，年度条形 2022:1、2023:23、2024:99、2025:135、2026:255，月度柱状正常。
- **产出物**：`web/stats.html`、`web/assets/css/stats.css`、`web/assets/js/stats.js`、`web/assets/js/account.js`、`README.md`（v0.14.0）、`plan/RPD_需求文档.md`（v0.11.0）。
- **待办**：① 上线 `web/` 三件套（`rsync`），线上确认头像进 `stats.html` 正常；② 备注还是 0 条，写几条后再看「备注画像」效果；③ 手机上过一遍窄屏排版。
- **风险/注意事项**：本地预览会被 `ps-auth.js` 静默 SSO 跳到账户中心 `sso.html`，调试时先用 `localStorage.ps_sso_off=1` 关掉；城市解析依赖地址文本，个别只有「XX路」没有城市字段的条目会落在「未知」。
---

