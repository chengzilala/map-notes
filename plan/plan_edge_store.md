# 微软 Edge 加载项商店 上架 / 归档

> 版本：扩展 **v0.3.0**｜创建：2026-11-05
> 共享文案、素材清单、版本策略见 [plan_store_上架总览.md](plan_store_上架总览.md)
> 平台：Microsoft Edge 加载项（Partner Center）
> 经验来源：`微信读书插件` 的 Edge 上架流程（已多次更新至 Live）

---

## 一、背景与目标

扩展 v0.3.0 已具备：双源收藏读取、侧栏、搜索、距离排序、附近筛选、本地备注，以及可选的备注多设备同步。目标是上架 Edge 加载项商店，让用户一键安装，不必手动「加载已解压的扩展程序」。

| 项 | 现状 |
|---|---|
| 扩展包 | `release/map-notes-v0.3.0.zip`（`python3 extension/pack.py`） |
| 图标 | `extension/icons/icon-16/48/128.png` ✅ |
| 隐私政策 | `site/privacy.html` → `https://map.chesterlee.cn/site/privacy.html`（待上线） |
| 商店素材 | `release/微软商店-上传/` ✅ 品牌图；⬜ 真实截图 |
| 账户 | Partner Center 账户已注册（微信悦读在用），需为「留个点」新建扩展 |

---

## 二、前置准备

| 项目 | 说明 |
|---|---|
| 账户 | https://partner.microsoft.com/dashboard/microsoftedge |
| 费用 | 个人开发者免费；公司账户 $19 一次性 |
| 上传物 | `.zip`（不是 crx） |
| 审核时长 | 通常 1–7 个工作日 |

---

## 三、提交步骤

1. Partner Center → 「创建新的扩展」→ 上传 `release/map-notes-v0.3.0.zip`。
2. **一览（Store listing）**：粘贴 [总览 §3](plan_store_上架总览.md) 的名称、简短描述、详细描述（中文；英文可选）。
   - 商店后台不渲染 Markdown：不要出现 `**`、`-` 列表符。
3. **属性**：分类选「生产力 / 效率」；网站填 `https://map.chesterlee.cn/site/`；支持邮箱 `2195542745@qq.com`。
4. **隐私**：按下方 §五 逐框粘贴。
5. **素材**：按下方 §四 上传（徽标 / 小磁贴 / 大磁贴 / 截图）。
6. **认证说明**：选「不需要，测试人员无需附加信息即可访问和测试所有功能」。
7. 各步骤无红点后点「发布」，等待审核。

---

## 四、素材槽位（已按目录分好）

| 槽位 | 文件 | 规格 |
|---|---|---|
| 扩展徽标 | `release/微软商店-上传/1-扩展徽标-300x300/扩展徽标-300x300.png` | 300×300，1:1 |
| 小促销磁贴 | `release/微软商店-上传/2-小促销磁贴-440x280/小促销磁贴-440x280.png` | 440×280 |
| 大促销磁贴（精选位） | `release/微软商店-上传/3-大促销磁贴-1400x560/大促销磁贴-1400x560.png` | 1400×560 |
| 屏幕截图（1–6 张，必填） | `release/微软商店-上传/4-屏幕截图-1280x800-最多6张/` | 1280×800 或 640×400 |

> 磁贴由 `python3 tools/make_store_assets.py` 生成；截图槽位在有真实截图后自动填充。

---

## 五、真实截图（已完成 2026-11-05）

已拍 4 张，1280×800，存 `screenshots/store/`：

| 文件 | 内容 |
|---|---|
| `store-01-列表.png` | 侧栏整体 + 8 条收藏（高德 5 / 百度 3，双源徽标） |
| `store-02-写备注.png` | 展开条目的备注编辑框（含已有备注） |
| `store-03-搜索.png` | 搜索「咖啡」过滤出 2 条 |
| `store-04-底部状态.png` | 列表顶部 + 底部同步状态 / 备注计数 |

拍法：真实 Chrome 1280×800，用**合成收藏数据**（8 条虚构地点），避免暴露真实地址；截图前清除扩展登录态，不向真实账户写入任何内容。

重跑 `python3 tools/make_store_assets.py` 即自动生成 Edge 截图槽位（`release/微软商店-上传/4-屏幕截图-1280x800-最多6张/`）与 360 封面 / 推荐图。

> 需要补拍时：改合成数据后重跑 `screenshots/store/` 生成流程即可；不要用含他人隐私的真实收藏。

---

## 六、隐私页填写（可直接复制）

> 事实依据（以代码为准）：`manifest.json` 权限仅 `storage`；主机权限为 `https://www.amap.com/*`、`https://map.baidu.com/*`、`https://map.chesterlee.cn/*`；全部 JS 随包分发，无远程代码；收藏快照不上传，只有备注文本在用户登录统一账户后同步到其本人账户（可选，可在网站上删除）。
> 实测：Edge 后台把 `permissions` + `content_scripts` 的匹配模式**合并成一个「主机权限理由」输入框**，限 1000 字符。

### 6.1 单一用途描述（Single purpose）

```
留个点只有一个用途：在你已登录的高德 / 百度地图网页里，读取你自己的收藏地点，提供自由备注、搜索、按距离排序与附近筛选。
它只在这两个地图域名下运行（另在本站 map.chesterlee.cn 仅做登录态转交与备注同步），把收藏缓存、备注和显示偏好在浏览器本地保存；收藏快照不上传，只有备注文本可在你登录统一账户后同步到你自己账户（可按需不用）。
不写回地图、不做导航与路线规划、不含远程代码、无统计与广告。
```

English（备选）：

```
A DOT, A WORD has a single purpose: on the Amap and Baidu Maps websites where you are already logged in, read YOUR OWN saved places and provide free-text notes, search, distance sorting and a nearby filter. It runs on those two map domains (plus map.chesterlee.cn only to hand over the user's own login state and sync notes) and stores favorites, notes and display preferences locally in the browser. Favorite snapshots are never uploaded; only note text can optionally sync to the user's own account on map.chesterlee.cn after they sign in. It never writes back to the maps, has no navigation/routing features, no remote code, no analytics and no ads.
```

### 6.2 权限理由 —— storage

```
"storage" is used solely to save the user's own favorites cache, notes and display preferences in chrome.storage.local on the user's device, plus the user's own site login token when they choose to sync notes. It is never used to collect or share data with third parties. Uninstalling the extension removes this local data.
```

中文（备选）：

```
"storage" 仅用于在用户设备本地（chrome.storage.local）保存收藏缓存、用户自己写的备注与显示偏好；用户选择备注同步时，另存其本人的本站登录 Token。不用于收集或向第三方共享数据，卸载扩展即清除。
```

### 6.3 权限理由 —— 主机权限（合并框）

```
主机权限仅服务于扩展的单一用途，且只在用户打开对应页面时使用：
1) https://www.amap.com/*：在用户已登录的高德地图页面内，以用户自己的登录态读取其本人的收藏，并在页面注入「留个点」侧栏。
2) https://map.baidu.com/*：同上，读取用户本人的百度地图收藏。
3) https://map.chesterlee.cn/*：仅在用户选择备注同步时使用——读取其本人的本站登录态，并读写其本人的备注（服务端按账户隔离）。
读取到的收藏与用户备注只保存在浏览器本地缓存，收藏快照不上传、不共享、不向开发者回传；备注文本仅在用户登录统一账户后同步到其本人账户，可随时删除；不读取浏览历史、书签或其他网站内容；不写回地图。
无远程代码、无统计分析、无广告。
```

English（备选）：

```
Host permissions serve only the extension's single purpose, and only when the user opens the relevant page:
1) https://www.amap.com/*: inside the user's own logged-in Amap page, read the user's OWN favorites with the user's own session and inject the "A DOT, A WORD" sidebar.
2) https://map.baidu.com/*: same for the user's own Baidu Maps favorites.
3) https://map.chesterlee.cn/*: used ONLY for optional note sync — read the user's own site login token and read/write the user's own notes, isolated per account on the server.
Favorite snapshots stay in local browser storage and are never uploaded. Note text is sent only to the user's own account after they sign in, and can be deleted anytime. The extension does not read browsing history, bookmarks or other sites, and never writes back to the maps. No remote code, analytics or ads.
```

### 6.4 其他勾选项

| 问题 | 选择 |
|---|---|
| 是否使用远程代码（Remote code） | **否**（全部 JS 随包分发） |
| 是否收集或传输用户数据 | **是，仅备注文本**（可选：登录统一账户后同步到本人账户，用于多设备共用；收藏快照不上传） |
| 是否包含分析 / 广告 / 跟踪 | **否** |

---

## 七、给审核团队的备注（可直接粘贴）

```
A DOT, A WORD runs on www.amap.com and map.baidu.com (plus map.chesterlee.cn only to relay the user's own login state and sync notes). It reads the user's OWN favorites inside the user's already-logged-in map page, caches them in chrome.storage.local, and injects a sidebar for notes, search, distance sorting and a nearby filter. Favorite snapshots are never uploaded, shared or sent to the developer. Note text is uploaded ONLY if the user signs in to their own account on map.chesterlee.cn, and is stored isolated per account. No remote code, analytics, tracking or ads.

Permissions:
- storage: saves the user's own favorites cache, notes and display preferences locally; removes on uninstall.
- host permissions (www.amap.com, map.baidu.com): used only to read the user's OWN favorites in the page and inject the sidebar.
- host permission (map.chesterlee.cn): used ONLY for optional note sync (read the user's own login token, read/write the user's own notes). No other sites.

How to test (no test account is required to see the UI):
1. Install the extension.
2. Open https://www.amap.com/ (or https://map.baidu.com/). A "A DOT, A WORD" button appears at the bottom-right.
3. Click it to open the sidebar. Without logging in, the sidebar shows an empty state and an actionable hint.
4. Optionally log in with your OWN map account and refresh to see your own favorites. Click an item to write a note; it is saved locally and survives a page reload.
5. Note sync is optional: without signing in to map.chesterlee.cn, no note is ever uploaded.

The extension is open source: https://github.com/chengzilala/map-notes
```

> 不要提供他人地图账号；审核员用自己账号即可验证核心链路。

---

## 八、更新提交流程（上架后每次发版）

1. `extension/manifest.json` 递增版本（必须高于 Live 版本）。
2. `python3 extension/pack.py` 出包，确认 zip 内版本号。
3. Partner Center → 从 Live 版本点「更新」→ 建草稿。
4. 程序包「替换」上传新 zip → 等后台显示「已验证当前程序包」。
5. 如权限 / 数据行为有变，更新隐私页对应说明；描述有变则同步改 Store listing。
6. 保存草稿 → 提交 → 等审核；通过后回填本文 §十。

---

## 九、常见拒绝原因与应对

| 拒绝原因 | 应对 |
|---|---|
| 权限说明不充分 | 主机权限合并框按 §6.3 写全，明确「只在用户打开地图页时读取本人收藏，数据不出本机」 |
| 缺少隐私政策 / 链接打不开 | 提交前用无痕窗口确认隐私 URL 200 |
| 截图缺失或与功能不符 | 按 §五 拍真实界面，描述只写已有功能（不写「跨设备同步」，那是 P3） |
| 描述含 Markdown 符号 | 后台不渲染，改成纯文本 + emoji + 空行 |
| 无法验证功能 | 审核备注说明「无需账号可见入口与空态」，并给出 4 步验证路径 |
| 版本号未递增 | 提交前核对 Live 版本 |

---

## 十、归档 / 审核状态记录（边做边填）

| 项 | 记录 |
|---|---|
| 后台入口 | https://partner.microsoft.com/dashboard/microsoftedge |
| 应用名称 | 留个点 · 地图收藏备注 |
| 应用 / 扩展 ID | （首次提交后填） |
| 首次提交版本 | ⬜ v0.3.0 待提交 |
| 提交日期 | — |
| 提交包 | `release/map-notes-v0.3.0.zip`（8 个运行文件，25.3 KB） |
| 隐私政策 URL | https://map.chesterlee.cn/site/privacy.html |
| 审核状态 | ⬜ 未提交 |
| 商店详情页 | （通过后填） |

### 历史更新

| 版本 | 日期 | 变更 | 状态 |
|---|---|---|---|
| — | — | 首次上架准备 | ⬜ |

---

## 资料来源（2026-11-05 核对）

- 微信读书插件已跑通的 Edge 流程与隐私页文案：`/Users/Admin/Knowledge/Coding/微信读书插件/plan/plan_edge_store.md`
- Microsoft Edge 加载项开发者后台：https://partner.microsoft.com/dashboard/microsoftedge
- 平台素材规格（徽标 300×300、磁贴 440×280 / 1400×560、截图 1280×800）：同上后台「素材」页实测
