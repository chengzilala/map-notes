# RPD · 地图收藏备注浏览器扩展

> 版本 **v0.1**（P1 / P2 范围）｜ 2026-11-05
> 形态：Chrome / Edge MV3 扩展，公开上架；零构建、零依赖。

## 1. 定位

在用户已经登录的高德 / 百度地图网页上，把「我的收藏」读进浏览器本地，补一层自由文本备注，并按「离我多远」排序、筛附近。

- 不做地图本身的功能（导航、路线、搜索补全）。
- 不写回高德 / 百度，不修改地图里的任何数据。
- 不做导出、互导、备份按钮。

## 2. 用户目标

| 维度 | 内容 |
|---|---|
| 用户目标 | 打开常驻的地图网页，就能看到自己收藏的点和备注，快速找附近 |
| 输入 | 用户自己在地图网页的登录态；本地备注 |
| 输出 | 页面内浮动侧栏：收藏列表 + 备注 + 距离排序 + 附近筛选 |
| 成功标准 | 装完打开高德收藏页，30 秒内看到全部收藏并可写备注；刷新不丢 |

## 3. V1 功能（P1 / P2）

1. **读取收藏**：在高德页读 `/service/fav/getFav`、`/ssr/api/cloudSync`；在百度页读 `qt=fav&type=favdata`。
2. **本地缓存**：按来源存 `chrome.storage.local`；同时缓存高德与百度，侧栏展示合并去重后的结果。
3. **侧栏**：常驻悬浮按钮，点开右侧面板。
4. **搜索**：按名称 / 地址 / 标签 / 备注即时过滤。
5. **距离排序**：点「定位」后按距我多远升序；未定位按名称排序。
6. **附近筛选**：全部 / 1km / 3km / 10km。
7. **备注**：点条目展开编辑，输入后 500ms 自动保存到本机。
8. **状态提示**：显示各来源点数、更新时间、取数失败原因。

### 非目标（V1 明确不做）

- 导出 / 互导 / 备份
- 写回地图、批量编辑收藏
- 抓取搜索结果、商户联系方式
- 导航、路线规划
- 云同步（V1 不做；v0.3 已作为可选项上线，见第 8 节）

## 4. 数据与权限

- 权限：`storage`；`host_permissions` 为 `https://www.amap.com/*`、`https://map.baidu.com/*`、`https://map.chesterlee.cn/*`（仅登录态转交与备注同步）。
- 收藏只在本地读取与缓存，不上传；备注默认本地，登录统一账户后仅同步备注文本。
- 备注键与 Web 站一致（高德 `amap:<原始 id>`，百度 `baidu:<fid>`），保证跨端同步不串键。
- 不读 `history` / `bookmarks` / `tabs` 内容；不写日志。

## 5. 页面与交互

- 注入点：右下角按钮「留个点」，`position: fixed`，Shadow DOM 隔离样式，类名统一 `mn-`。
- 面板：右侧 360px，最高 76vh；窄屏（<720px）改为底部抽屉。
- 展开条目才显示备注输入框，避免 500 条同时渲染输入框。

## 6. 验收清单

- [ ] 高德已登录时，侧栏能列出全部收藏，数量与收藏页一致
- [ ] 百度已登录时，能列出百度收藏，坐标落点正确（BD09MC → GCJ-02）
- [ ] 两个来源都缓存后，同一地点（≤50m 且名称相似）只出现一次
- [x] 备注输入后关闭浏览器再打开仍在（2026-11-05 已验证：写入 `chrome.storage.local`，重载后回显）
- [x] 面板能注入并渲染列表（2026-11-05 用合成收藏数据验证：列表、双源徽标、备注回显、编辑保存）
- [ ] 搜索、距离排序、附近筛选可用
- [x] 未登录 / 接口失败时给出可操作的提示，不清空旧缓存（2026-11-05 验证：未登录显示「接口里没有地点…重试」）
- [ ] 面板不遮挡地图主要操作，关闭后无残留

## 7. 本地验收方式（重要）

Chrome 137+ 已停用命令行 `--load-extension`（加了 `--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效），
所以**不能**用 `playwright.launch(args=["--load-extension=..."])` 验证扩展，会一直读到 `root: null`。

可靠做法（真实 Chrome + 可见窗口 + CDP）：

1. 用固定参数启动本机 Chrome：
   `--user-data-dir=/tmp/xxx --remote-debugging-port=9338 --enable-unsafe-extension-debugging`
2. `playwright.chromium.connect_over_cdp("http://127.0.0.1:9338")`
3. `browser.new_browser_cdp_session().send("Extensions.loadUnpacked", {"path": "extension/"})` → 返回扩展 id
4. 打开地图页，检查 `document.getElementById('mn-root').shadowRoot`
5. 想灌测试数据：对页面 CDP `Runtime.enable`，抓 `executionContextCreated` 里 name 为「留个点 · 地图收藏备注」
   的 isolated world，用该 `contextId` 执行 `chrome.storage.local.set(...)`，重载页面即可看到列表

真实收藏数量仍需用户本人登录后人工核对。

## 8. 备注多设备同步（P3，已完成）

- [x] 服务端开关 `MN_EXT_ALLOW_ALL`：只对 Bearer 账户 Token 放开 `/api/notes`，Web 站白名单不变；收藏 / 状态接口仍 401
- [x] 登录态转交：`site-auth.js` 在 `map.chesterlee.cn` 读 `ps_token` → 交给扩展后台存 `chrome.storage.local['mn:auth']`
- [x] 双向合并：按备注 `updatedAt` 取新的，本地新的推云端、云端新的拉回本地；只上传备注文本，收藏快照仍留本机
- [x] 限流与配额：读 120/min、写 60/min（按 uid），非白名单用户备注上限 `MN_EXT_NOTE_LIMIT`（默认 2000），请求体上限 200KB
- [x] 状态可见：footer 显示「登录后多设备同步 / 已同步 HH:MM / 同步失败，点此重试」，点击即登录或重试
- [x] 线上部署（2026-11-05）：`tools/{serve,store}.py` 已同步到服务器，`/api/health` 返回 `"ext": true`；无 Token / 假 Token 访问 `/api/notes` 均为 401
- [x] 真实账户验证（2026-11-05）：真实 Chrome 加载扩展并登录统一账户后，fresh profile 从云端拉回 1 条备注、footer 显示「已同步 13:14」；写临时备注后服务端 notes 计数 1→2，清除后回 1，无残留
- [ ] 换一台设备登录同账户，确认备注回显（服务端已按 uid 存好，另一设备登录后拉取的即同一份）

## 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1 | 2026-11-05 | 扩展骨架、双源取数、侧栏、搜索、距离、附近、本地备注 |
| v0.2 | 2026-11-05 | 上架准备：16/48/128 图标、`homepage_url`、一键打包脚本、Edge / 360 素材与上架文档、隐私政策页；功能未变 |
| v0.3 | 2026-11-05 | 备注多设备同步：账户 Token 转交、`/api/notes` Bearer 读写、按 `updatedAt` 双向合并、限流与配额 |
