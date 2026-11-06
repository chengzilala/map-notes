# 商店上架总览（留个点 · 地图收藏备注）

> 版本：扩展 **v0.3.0**｜创建：2026-11-05
> 适用：Edge 加载项商店、360 浏览器扩展中心（Chrome / QQ 暂不作目标）
> 分店文档：[plan_edge_store.md](plan_edge_store.md)｜[plan_360_store.md](plan_360_store.md)
> 经验来源：`微信读书插件`（已跑通 Edge / 360 上架），只搬本项目用得上、且与代码一致的部分。

---

## 一、从微信读书插件搬过来的经验（本项目已落地）

| 经验 | 本项目怎么落地 |
|---|---|
| 扩展必须有 16 / 48 / 128 三档图标 | `extension/icons/` 已生成，`manifest.json` 的 `icons` 与 `action.default_icon` 都已引用 |
| 填 `homepage_url`，商店资料与扩展互相指路 | `https://map.chesterlee.cn/site/` |
| 打包不手写清单，按 manifest 自动收集 | `python3 extension/pack.py`：引用缺失会中止并列文件，产物 `release/map-notes-v<版本>.zip` |
| 版本号三处一致且每次递增 | `extension/manifest.json` = git tag = 商店提交版本；本次 **0.3.0** |
| 文案以代码为准，不凭记忆 | 权限、域名、功能一律先看 `extension/manifest.json` 与 `extension/content.js` 再写 |
| 商店必须有可公开访问的隐私政策 | 新增 `site/privacy.html` → `https://map.chesterlee.cn/site/privacy.html` |
| 素材按槽位分文件夹，避免传错尺寸 | `tools/make_store_assets.py` 直接产出 `release/微软商店-上传/` 与 `release/360-素材/` |
| 审核备注模板（权限理由 + how-to-test） | 见两份分店文档，可直接复制 |
| `.pem` 私钥 / crx / zip 不入库 | `.gitignore` 已排除 `*.pem`、`*.crx`、`*.zip`、`release/` |
| 360 真实后台是创作者中心，不是老开放平台 | 见 [plan_360_store.md](plan_360_store.md) §一 |

**明确不搬的**：多语言 `_locales`（当前只有中文，非必需）、统计埋点/遥测（本项目不做分析）、popup 面板（工具栏点击直接开关侧栏，更省权限与维护）。

---

## 二、上架前必须补齐的三件事

1. **真实截图 1–6 张（1280×800）**
   商店必填，品牌图不能替代。拍好后放到 `screenshots/store/store-01-1280x800.png` …，再跑一次
   `python3 tools/make_store_assets.py`，会自动进 Edge 截图槽位，并生成 360 封面 / 推荐图。
   拍摄清单见 [plan_edge_store.md](plan_edge_store.md) §五。
2. **隐私政策上线**
   本地已有 `site/privacy.html`，还需同步到线上（见 §四）。提交前用无痕窗口打开隐私 URL 确认 200。
3. **版本号与包**
   本次扩展版本 `0.3.0`；提交前重跑打包，确认 zip 内 `manifest.json` 版本与商店填写一致。

---

## 三、共享商店文案（中英文，直接复制）

> 商店后台不渲染 Markdown，`**`、`-` 会原样显示。下面中文正文已改成纯文本 + emoji + 空行分段。

### 3.1 基本信息

| 字段 | 内容 |
|---|---|
| 名称 | 留个点 · 地图收藏备注 |
| 简短描述（≤80 字） | 把高德 / 百度地图的收藏收进一个侧栏，就地写备注、按距离找附近。收藏只在本机读取，备注可选多设备同步。 |
| 分类 | 生产力 / 效率（以平台可选项为准） |
| 官网 | https://map.chesterlee.cn/site/ |
| 隐私政策 | https://map.chesterlee.cn/site/privacy.html |
| 支持邮箱 | 2195542745@qq.com |
| 支持语言 | 中文（简体） |

### 3.2 详细描述（中文）

```
🌐 官方网站：https://map.chesterlee.cn/site/

留个点是给地图收藏夹补一层「备注 + 按距离找附近」的小工具。它不改变地图，只把你自己收藏过的地点放进页面右侧一个侧栏。

✨ 核心功能

📍 一个侧栏看两处收藏：在高德或百度地图页打开后，自动读取该站点你自己的收藏；两个站点各打开一次，侧栏会合并去重展示，并标出来源。

✍️ 点开就写，停手就存：给任意地点写一句自由备注，输入后自动保存在本机；刷新页面、重启浏览器都还在。登录统一账户后可多设备同步（可选，只同步备注文本）。

🔍 找得到：按名称 / 地址 / 标签 / 备注即时搜索。

📏 附近，从近到远：点「定位」后按离你多远排序，可筛 1 / 3 / 10 公里。

🧭 双源坐标统一：百度收藏会自动换算到与高德一致的坐标，落点不跑偏。

🔒 数据边界

收藏只在你自己的浏览器里读取与缓存，不上传、不共享；备注默认存本机，登录统一账户后仅同步备注文本，可按需不用。

不写回高德 / 百度，不修改地图里的任何数据；不做导航、路线规划、轨迹记录。

无远程代码、无统计分析、无广告；只申请本地存储与地图 / 本站三个域名。

💡 怎么用

1. 先在浏览器里登录高德或百度地图（收藏要能正常打开）。

2. 打开任意高德 / 百度地图页，右下角出现「留个点」，点开右侧栏。

3. 点条目写备注；点「定位」按距离排序、筛附近。

👤 个人说明：独立开发者，原生 HTML/CSS/JS 零依赖实现。
```

### 3.3 详细描述（English）

```
Official site: https://map.chesterlee.cn/site/

A DOT, A WORD adds the two things map favorites lack: a free-text note for each saved place, and a "nearest first" view.

FEATURES

- One sidebar for two maps: open it on amap.com or map.baidu.com and it reads YOUR OWN favorites from that site. Visit both once and the sidebar merges and de-duplicates them, with source labels.
- Write and forget: type a note on any place; it saves automatically in your browser. Reload or restart and it is still there. Sign in to your account (optional) to sync notes across devices — note text only.
- Search: filter instantly by name, address, tag or note.
- Nearby first: click Locate to sort by distance, and filter within 1 / 3 / 10 km. Baidu coordinates are converted to the same system as Amap so pins land correctly.

DATA BOUNDARY

Favorites are read and cached only inside your own browser and are never uploaded. Note text is stored locally by default; if you sign in, only note text syncs to your own account on map.chesterlee.cn (isolated per account, deletable). The extension never writes back to Amap or Baidu and never changes map data. No navigation, routing or tracking features.

No remote code, no analytics, no ads. Only the storage permission plus the two map domains and our own site (for optional note sync).

HOW TO USE

1. Log in to Amap or Baidu Maps in your browser (favorites should be visible).
2. Open any map page; a "A DOT, A WORD" button appears at the bottom-right. Open the sidebar.
3. Click an item to write a note; click Locate to sort by distance.

Runs on www.amap.com and map.baidu.com, plus map.chesterlee.cn only for optional note sync.
```

---

## 四、素材生成与上线命令

```bash
# 1) 图标 + Edge / 360 素材（可反复跑，覆盖生成）
python3 tools/make_store_assets.py

# 2) 打扩展上架包（读 manifest，校验缺失）
python3 extension/pack.py

# 3) 隐私政策 / 官网同步上线（需你确认后再执行）
rsync -az --delete site/ ubuntu@43.136.92.125:/srv/chesterlee/map/site/

# 4) 提交前确认隐私页可公开访问
curl -s -o /dev/null -w '%{http_code}\n' https://map.chesterlee.cn/site/privacy.html
```

素材落点：

| 用途 | 目录 |
|---|---|
| Edge 后台（按槽位） | `release/微软商店-上传/1-扩展徽标-300x300/` … `4-屏幕截图-1280x800-最多6张/` |
| 360 创作者中心 | `release/360-素材/图标-192x192.png`、`封面图小图-472x296.png`、`市场推荐图-01~05-1120x700.png` |
| 上传包 | `release/map-notes-v0.3.0.zip` |

---

## 五、版本号与更新策略

| 位置 | 规则 |
|---|---|
| `extension/manifest.json` 的 `version` | 每次改扩展都必须递增；商店要求高于该店上次提交 |
| git tag | 与 manifest 同号（`v0.3.0`）；仓库 <https://github.com/chengzilala/map-notes>（镜像 <https://gitee.com/chengzila/map-notes>） |
| 商店后台 | Edge 从 Live 版本点「更新」建草稿；360 走「更新扩展」只换 `.crx` |

> 本项目 Web 站版本（README 顶部 v0.13.x）与扩展版本各自独立，不要互相套用。

---

## 六、上线前检查清单

- [ ] `python3 extension/pack.py` 通过，zip 内只有 8 个运行文件（manifest / background.js / site-auth.js / content.js / lib/parse.js / 3 个图标）
- [ ] zip 内 `manifest.json` 版本 = 商店填写版本 = 0.3.0
- [ ] 权限只有 `storage` + 三个域名（高德 / 百度 / map.chesterlee.cn）；无新增权限
- [ ] 隐私政策 URL 线上可访问（200），内容与代码一致（含备注同步说明）
- [ ] 至少 1 张真实截图 1280×800（640×400 也可），不超过 6 张
- [ ] 商店描述里的功能全部在 `extension/` 中存在（备注同步已上线，可在描述中写明）
- [ ] 用干净 Chrome 实测：加载扩展 → 打开地图页 → 侧栏出现 → 写备注 → 刷新仍在
- [ ] 未登录地图时，侧栏给出可操作提示且不清空旧缓存

---

## 七、已知风险与应对

| 风险 | 说明 / 应对 |
|---|---|
| 审核员看不到真实数据 | 扩展依赖审核员自己的地图登录态。审核备注里写清：无需账号即可看到入口与空态；登录自己的账号后可看到自己的收藏。**不要提供他人账号**。 |
| 缺少真实截图 | Edge / 360 都可能因素材不完整退回；先按 `plan_edge_store.md` §五 拍图再提交。 |
| 备注同步被误读为「偷偷上传」 | 商店数据披露按实际填：**备注文本可选同步**（登录后、按账户隔离、可删除），收藏快照与显示偏好不传输；描述与隐私页写清「不登录完全不上传」。 |
| 360 内核较旧 | 360 Mac 版基于 Chromium 108，MV3 理论支持；上架前必须在 360 浏览器实测加载。 |
| 版本号低于线上 | 每次提交前核对该商店 Live 版本，manifest 必须更大。 |
| `.pem` 丢失 | 360 更新会变成「全新应用」；`.pem` 只放 `release/`（已 gitignore），另存一份到仓库外。 |

---

## 八、当前状态

| 项 | 状态 |
|---|---|
| 扩展图标 / manifest | ✅ 已完成（v0.3.0） |
| 一键打包脚本 | ✅ 已跑通，产物 `release/map-notes-v0.3.0.zip` |
| Edge / 360 素材 | ✅ 品牌图与 4 张真实截图均已生成（`screenshots/store/`，合成数据，无隐私） |
| 隐私政策页 | ✅ 已同步上线（含备注同步说明）：<https://map.chesterlee.cn/site/privacy.html> |
| Edge 提交 | ⬜ 待你登录 Partner Center 后填表上传（应用需新建） |
| 360 提交 | ⬜ 待登录创作者中心新建应用 |
