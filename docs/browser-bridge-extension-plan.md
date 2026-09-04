# StoClaw Browser Bridge 扩展技术方案

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-04 |
| 状态 | 待扩展仓开工 |
| 配套 | 本仓 `docs/browser-automation-parity-plan.md` A4 / B12 / C4 / E3 已冻结 |
| 范围 | **仅仓外 Chrome 扩展**。Embed webview / ba_* 不在本文件。 |

本仓没有 `browser-extension/` 源码，只解析并分发 zip（`electron/utils/browser-bridge-extension.ts`：在 `app.getAppPath()/browser-extension` 或 `process.resourcesPath/browser-extension` 读 `manifest.json` 的 `version`，下载 `dist/stoclaw-browser-bridge-<version>.zip`）。

扩展仓按本文实现后，把 **MV3 `manifest.json` + zip** 交回本仓上述目录即可，不必改 Host API。

---

## 1. 目标与非目标

**目标**：用户在真实 Chrome 里打开已登录页面，StoClaw 通过 `bridge_*` 操作该 tab。扩展是协议客户端：配对、心跳、拉命令、回结果。

**非目标**：

- 不要复刻 ba_* / managed BrowserWindow。
- 不要关用户已有 tab（一律 `borrowed`）。
- 不要执行白名单外的 CDP（尤其 `Page.navigate`、`Network.setCookie`、`Input.*`）。
- 不要依赖 Electron；扩展只打 `http://127.0.0.1:<hostApiPort>`（默认 3210）。

---

## 2. 与本仓的契约（已冻结，扩展必须遵守）

Host：`http://127.0.0.1:3210`。CORS 已允许 `chrome-extension://`。扩展请求带 `X-Session-Token`。

### 2.1 生命周期

```
启动
  → GET /api/browser-bridge/extension-info（读 bundled version）
  → POST /api/browser-bridge/auto-connect  { extensionVersion }   // 仅 loopback
       失败 403 BRIDGE_VERSION_MISMATCH → 提示用户升级 zip，禁止带旧协议硬连
       失败 403 Auto-connect disabled → 走配对码
  → 否则 POST /api/browser-bridge/pair { pairingCode }
  → 保存 token（chrome.storage.local）

每个被驱动 tab
  → POST /connect  { sessionId, tabId, url, title, extensionVersion, ownership:'borrowed', groupId?, taskLabel? }
  → 每 ~15s POST /heartbeat { sessionId, url, title }   // 服务端 60s 无心跳丢会话
  → GET  /poll?sessionId=...   // 建议 200–500ms；命令 TTL 30s，慢了会丢
  → 执行 action
  → POST /result { sessionId, commandId, action, result }

token 被吊销（设置页关自动化 / rotate-tokens）
  → 旧 token 宽限 60s
  → 重新 auto-connect 或 pair，刷新 storage 里的 token，对仍打开的 tab 再 connect
```

`sessionId` 建议 `ext-<tabId>-<uuid>`，同一 tab 重连复用或先让旧会话过期均可；不要复用 embed- 前缀。

### 2.2 版本配对

与 bundled `manifest.json` 的 semver 比：

| 情况 | 服务端 | 扩展行为 |
|---|---|---|
| 未上报 version | 兼容 + `updateAvailable` | 必须上报，否则用户看不到升级提示 |
| major 不同 | 403 `BRIDGE_VERSION_MISMATCH` | 停轮询，UI 引导下载新 zip |
| minor/patch 不同 | 放行 + `updateAvailable` | 设置页/扩展 popup 提示升级，功能继续 |

扩展 `manifest.json` 的 `version` 必须与打进本仓的 zip 名、本仓 bundled 版本同一 major。

### 2.3 命令表

`payload` 均为 JSON object。`result` 建议 `{ success, error?, ... }`。

| action | payload | 扩展必须 | 失败约定 |
|---|---|---|---|
| `snapshot` | `{ mode?: 'dom'\|'ax' }` | 必做。返回可交互树（含 `@e` ref）。`ax` 做不到 → `{ success:true, mode:'dom', unsupported:'CDP_DOMAIN_UNSUPPORTED', tree }` | 不要让整个命令 5xx |
| `click` | `{ ref?, name? }` | 必做 | `{ success:false, error }` |
| `fill` | `{ ref?, name?, value }` | 必做 | 同上 |
| `navigate` | `{ url }` | 必做（`chrome.tabs.update`） | |
| `screenshot` | `{}` | 必做（`captureVisibleTab` 或文档截图） | |
| `scroll` | 现状 payload | 若旧扩展已有则保留 | |
| `evaluate` | 现状 payload | 高风险；仅允许与现网一致的受限表达式，禁止任意 `eval` 新放大 | |
| `read_page` | `{}` | **新**。滚动收集正文；可简化为可见文本 + `truncated` | |
| `print_pdf` | `{}` | **新**。Chrome 无稳定 `tabs.saveAsPDF`；可 `window.print` 用户确认，或返回 `{ success:false, error:'PRINT_PDF_UNSUPPORTED' }` 并在 popup 说明 | |
| `cdp` | `{ method, params? }` | **新**。只执行下表；表外 `{ success:false, error:'CDP_METHOD_NOT_ALLOWED' }`（服务端入队前也会拦） | |
| `group_tabs` | `{ groupId?, title?, color?, tabIds?: number[] }` | **新**。`chrome.tabGroups`；缺 `tabIds` 时用当前任务相关 tab | 无权限 → 明确 error，不要静默 |
| `mark_tabs` | `{ marked: boolean, label? }` | **新**。tab 标题前缀或 badge；`marked:false` 必须能清掉 | |

CDP 白名单（与 `shared/browser-automation/cdp-allowlist.ts` 同步，扩表要两边一起改）：

- `Runtime.evaluate` 10s
- `Runtime.getProperties` 5s
- `DOM.describeNode` / `DOM.getContentQuads` / `DOM.getBoxModel` 5s
- `Page.getFrameTree` 5s
- `Emulation.setDeviceMetricsOverride` 5s

实现建议：`chrome.debugger.attach` 到目标 tab，用完 `detach`。用户会看到「调试程序」栏，popup 里写一句说明。

### 2.4 会话语义

- `ownership` 固定报 `'borrowed'`。
- **禁止** `chrome.tabs.remove` 作为命令副作用。
- `groupId` / `taskLabel`：agent 调 `bridge_group_tabs` 后写入；后续 heartbeat/connect 带上便于 `listSessionsByGroup`。

---

## 3. 推荐目录（MV3）

独立仓库，不要进 sto-claw。建议：

```
browser-extension/
  manifest.json          # MV3, version 与 zip 一致
  background.js          # service worker：配对、队列、tabGroups、debugger
  content.js             # 注入：snapshot/click/fill/read_page/mark overlay
  popup.html / popup.js  # 配对码、连接状态、升级提示
  icons/
  dist/stoclaw-browser-bridge-<version>.zip
```

`manifest.json` 最小权限：

```json
{
  "manifest_version": 3,
  "name": "StoClaw Browser Bridge",
  "version": "1.0.0",
  "permissions": [
    "storage",
    "tabs",
    "tabGroups",
    "debugger",
    "scripting",
    "activeTab"
  ],
  "host_permissions": ["http://127.0.0.1/*", "http://localhost/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}
```

`host_permissions` **不要** `<all_urls>`，除非 content script 必须通配；更稳是 `scripting.executeScript` 按 tabId 注入。

`tabGroups` 在部分企业策略下会被关：功能降级，命令返回明确 error。

---

## 4. 运行时设计

### 4.1 background

- 单一 `token`；内存 + `chrome.storage.local`。
- `Map<tabId, { sessionId, groupId?, marked }>`。
- alarm 或 `setTimeout` 做 heartbeat / poll（SW 会被杀：每次醒来先补 heartbeat 再 poll）。
- `chrome.tabs.onRemoved`：停止 poll，不调用 Host disconnect 也可以（60s stale 会清）。
- `rotate`：poll/`connect` 收到 403 Invalid session token → 走 auto-connect，成功后对所有 tab 重新 connect。

### 4.2 content

- snapshot：与本仓 embed 脚本同语义更好（`@e` ref + 可见文案）。做不到字节级一致时，至少保证 `ref` 在同一次 snapshot 内稳定，click/fill 用同一次树。
- mark：页顶条或右边 badge，文案用 `label` 或「自动操作中」。`marked:false` 拆除 DOM。
- 不要在页面里存 token。

### 4.3 popup

- 未连接：配对码输入 +「打开 StoClaw 获取配对码」。
- 已连接：当前 tab url、bundled vs installed 版本、一键断开（清 token，停 poll）。
- major 拒绝：只显示升级，不提供「仍然连接」。

---

## 5. 安全

- Token 只放 `chrome.storage.local`，不写页面 JS、不打远程日志。
- 只允许访问 loopback Host API。
- `evaluate` / `Runtime.evaluate` 视为高危：沿用现网限制；禁止新开任意代码通道。
- 用户能看见 debugger 栏和 tab 标记；不要做隐身驱动。
- StoClaw 设置页把自动化打到 `off` 会 `revokeAllTokens`：扩展必须停。

---

## 6. 打包与回交本仓

1. 扩展仓 `npm run pack` 产出 `stoclaw-browser-bridge-<version>.zip`。
2. 放入本仓（或资源目录）：
   - `browser-extension/manifest.json`（含 `version`）
   - `browser-extension/dist/stoclaw-browser-bridge-<version>.zip`
3. 设置页已有「扩展下载」：`GET /api/browser-bridge/extension-download`。
4. **不要**把解压后的 asar/扩展 dump 提交进 sto-claw（`.gitignore` 已忽略分析目录）。

版本 bump：patch/minor 可热更；major 必须本仓 bundled 与扩展同发，否则旧扩展会被 403。

---

## 7. 验收

- auto-connect：同 major 成功；故意改成 2.x 被拒。
- 配对码路径在 auto-connect 关闭时可用。
- 对已登录 tab：snapshot → click → fill，页面真的变。
- `group_tabs` 出现 Chrome 标签组；任务结束或 `marked:false` 后组/标记可清。
- `mark_tabs` 开关各一次。
- `cdp` 白名单内成功；`Page.navigate` 失败且 tab 不跳走。
- 关闭 StoClaw「浏览器自动化」后 60s 内扩展停驱动。
- 不关用户 tab（borrowed）。

---

## 8. 工作量切分（扩展仓）

| 切片 | 内容 |
|---|---|
| E0 | MV3 骨架 + auto-connect/pair + connect/heartbeat/poll/result + 旧 snapshot/click/fill/navigate/screenshot |
| E1 | 上报 `extensionVersion`；处理 `BRIDGE_VERSION_MISMATCH` 与 token 宽限重连 |
| E2 | `group_tabs` + `mark_tabs` |
| E3 | `read_page`；`print_pdf`（或明确 unsupported） |
| E4 | 白名单 `cdp` + debugger attach/detach |
| E5 | `snapshot mode=ax`（可后置，失败回退 DOM） |
| E6 | zip 回交本仓 + 设置页走通下载/升级 |

E0 若现有闭源扩展已有，从 E1 接即可。本仓无法评估现网实现度（对齐计划 §十.1）。

---

## 9. 本仓不再为扩展改什么

协议字段已在 `shared/browser-bridge/types.ts`。扩展缺能力时返回 `{ success:false, error }`，**不要**为了迁就旧扩展放宽 major 检查或拆掉 CDP 白名单。
