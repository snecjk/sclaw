# Browser Automation Platform 对齐 Kimi WebBridge 实施文档

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-03 |
| 状态 | 待评审 |
| 目标 | 与 Kimi 浏览器自动化（kimi-webbridge 2.x + InAppBrowser）能力对齐 |
| 项目 | sto-claw（Electron 40 + React 19 + TS + Vite + better-sqlite3，OpenClaw gateway 子进程 + Claude SDK 双引擎） |
| 依据 | 本文全部"现状"断言均来自对仓内文件的只读精读，行号证据随文标注 |

---

## 一、目标与结论

### 1.1 结论

**可以做到对齐，且大部分工作可在本仓内闭环。** 现有 BAP（Browser Automation Platform）骨架方向正确：会话管理、CDP 注入、observe→act→wait→validate 循环、步级 checkpoint、workflow 节点集成均已存在（证据见 §二）。差距集中在三处：

1. **感知层代差**：现为 DOM 注入脚本（`shared/browser-automation/observe-script.ts` L77-128 `walkInteractive`），Kimi 参照实现为 CDP `Accessibility.getFullAXTree` + 预算降级。这是一次"换引擎"而非"打补丁"，但接口面（`BrowserAutomationElementRef`，`shared/browser-automation/types.ts` L33-47）可以保持不变，替换对上层透明。
2. **可靠性/安全件缺失**：代际校验、JS dialog 熔断、HTTP 鉴权、可见性守卫、产物写盘加固、同会话串行化——这六项（P0）全部是**本仓内的确定性工程**，无外部依赖，风险低。
3. **真实 Chrome 桥的能力上限在仓外**：`electron/services/browser-bridge-service.ts`（295 行）服务端协议已可用（配对码 L48-63、token L65-68、命令队列+TTL L178-204、结果回传 L206-244、持久化 L246-277），但 **Chrome 扩展源码不在本仓**（`browser-extension/` 目录不存在；`electron/utils/browser-bridge-extension.ts` L32-47 只做 zip 分发解析）。任务标签组、被驱动 tab 视觉标记、扩展侧 AX 注入、owned/borrowed tab 语义的扩展端落地，均依赖仓外扩展仓的配套开发。**这是本计划最大的外部依赖。**

### 1.2 最大外部依赖声明

| 依赖 | 影响范围 | 缓解 |
|---|---|---|
| 仓外 Chrome 扩展源码（StoClaw Browser Bridge 扩展） | P2 的标签组 / 视觉标记 / 版本配对强制 / 扩展端 cdp 白名单执行 | 服务端先行定义协议字段（本计划 §四 A4/C4/E3），扩展端按协议迭代；扩展未升级前相关字段优雅降级 |
| Electron 40 debugger 对 `Accessibility` 域的转发（待验证） | P1 感知层主路径 | 波次 2 第 1 步做 PoC；不支持则回退"DOM 遍历 + ARIA 合成"伪 AX，接口不变（§六 R1） |

---

## 二、现状盘点

### 2.1 已有能力总表

| 能力 | 实现位置 | 证据 |
|---|---|---|
| 会话创建（embed / managed 双源） | `electron/services/browser-automation/service.ts` `createSession` | L38-96 |
| 会话过期与 prune | `session-manager.ts` `isSessionExpired` / service `pruneExpiredSessions` | L83-86 / L291-297 |
| embed 会话 ID 约定 `embed-<runtimeId>` | `session-manager.ts` `buildEmbedSessionId` / `parseEmbedRuntimeId` | L74-81 |
| managed 窗口（离屏 BrowserWindow，共享 embed 分区） | `session-manager.ts` `createManagedSession` | L27-54（partition L39） |
| CDP attach/send 封装 | `cdp-session.ts` | 全文 52 行（attach L19-28，send L42-46） |
| DOM 注入式观察（@e ref + stableKey + bbox + states） | `shared/browser-automation/observe-script.ts` | L77-145 |
| 页内动作（click/fill/select/scroll/press/navigate） | `observe-script.ts` `act` + `actor.ts` | L166-207 / 全文 49 行 |
| CDP 真实输入 fill（点击聚焦 + insertText + 填后校验 + native setter 兜底） | `input.ts` `actFillOrType`；`observe-script.ts` `fillWithNativeSetter` | L205-257 / L216-239 |
| CDP 按键（KEY_DEFS + dispatchKey） | `input.ts` | L35-53, L121-141 |
| 等待引擎（url/navigation/networkIdle/selector/timeout） | `wait-engine.ts` `waitForCondition` | L17-76 |
| 动作后等待策略 | `wait-engine.ts` `waitAfterAction` | L78-87 |
| 校验器（url/title/elementExists/elementCount/elementText） | `observe-script.ts` `BROWSER_AUTOMATION_VALIDATE_SCRIPT` | L301-342 |
| 步级 checkpoint（ba_session / ba_run / ba_step_run 三表） | `electron/db/repositories/browser-automation-repository.ts` | L19-43 / L55-76 / L78-129 |
| 截图（`webContents.capturePage`，base64 回传，**当前无调用方**） | `routes/browser-automation.ts` L141-150；`cdp-session.ts` L48-51 | 路由定义存在但全仓无调用（已 grep 确认） |
| loopback HTTP API（3210，无鉴权） | `electron/api/server.ts` L120-143 + `routes/browser-automation.ts` | listen 127.0.0.1（server L138）；`isLoopback` L12-15 |
| OpenClaw 插件 ba_*（6 工具） | `sto-plugin/openclaw/sto-browser-automation/index.ts` | L51-246 |
| OpenClaw 插件 bridge_*（6 工具） | `sto-plugin/openclaw/sto-browser-bridge/index.ts` | L42-133 |
| Claude MCP bridge_*（6 工具，in-process SDK server） | `sto-plugin/claude/sto-browser-tool/tools.ts` | L52-154 |
| bridge 服务端（配对/心跳/命令队列/结果轮询/持久化） | `browser-bridge-service.ts` | 全文 295 行，**可用实现非占位** |
| embed webview 桥驱动（50ms 轮询 + flush 直通） | `electron/main/services/sclaw-embed-bridge-driver.ts` | L15, L74-148, L230-236 |
| embed 页内桥脚本（snapshot/click/fill/scroll/evaluate） | `shared/sclaw-embed-bridge-inject.ts` | 全文 220 行 |
| workflow 浏览器节点（browser_task/validate/human_gate） | `electron/services/workflow-runtime/browser-nodes/` | index L15-40 |
| 插件安装/启用链路 | `plugin-install.ts` L1580-1595 + `openclaw-auth.ts` L1532-1569 + `main/index.ts` L943-958 | 见 §四 H |

### 2.2 关键文件清单（按改动组）

| 组 | 文件 | 行数 | 改动性质 |
|---|---|---|---|
| A shared | `shared/browser-automation/types.ts` | 121 | 扩展 |
| A | `shared/browser-automation/observe-script.ts` | 342 | 加固 + 探针 |
| A | `shared/browser-automation/feature-flag.ts` | 8 | 分级化 |
| A | `shared/browser-bridge/types.ts` | 52 | 扩展 |
| A | `shared/browser-automation/cdp-allowlist.ts` | — | **新增** |
| B 主进程 | `electron/services/browser-automation/cdp-session.ts` | 52 | 大改 |
| B | `…/service.ts` | 354 | 大改 |
| B | `…/observer.ts` | 48 | 改 |
| B | `…/input.ts` | 297 | 扩展 |
| B | `…/wait-engine.ts` | 87 | 扩展 |
| B | `…/session-manager.ts` | 96 | 小改 |
| B | `…/dialog-guard.ts` | — | **新增** |
| B | `…/artifact-writer.ts` | — | **新增** |
| B | `…/ax-observer.ts` | — | **新增**（P1 主体） |
| B | `…/network-recorder.ts` | — | **新增** |
| B | `electron/services/browser-bridge-service.ts` | 295 | 补（不重写） |
| B | `electron/db/repositories/browser-automation-repository.ts` | 170 | 加 artifact 表方法 |
| C HTTP | `electron/api/routes/browser-automation.ts` | 153 | 鉴权 + 新路由 |
| C | `electron/api/route-utils.ts` | 39 | parseJsonBody 加上限（默认不变） |
| C | `electron/api/routes/browser-bridge.ts` | 314 | 版本配对 + 新 action |
| C | `electron/utils/openclaw-auth.ts` | — | token 分发（L1532-1569 处改） |
| D 渲染层 | `src/lib/sclaw-browser-host-api.ts` | 135 | 加可见性上报 IPC |
| D | `src/components/sclaw-browser/SclawBrowserFrame.tsx` | ~500+ | 可见性钩子 + 自动化标记 prop |
| E OpenClaw | `sto-plugin/openclaw/sto-browser-automation/index.ts` | 248 | 新工具 + 提示词 |
| E | `…/automation-client.ts` | 112 | 鉴权头 |
| E | `sto-plugin/openclaw/sto-browser-bridge/index.ts` + `bridge-client.ts` | 135/— | 新 action + 提示词 |
| F Claude | `sto-plugin/claude/sto-browser-automation/`（新目录） | — | **新增**（ba_* MCP） |
| F | `sto-plugin/claude/sto-browser-tool/tools.ts` | 158 | bridge_* 同步 |
| F | `sto-plugin/sto-toolkit/` | — | 提升共享 HTTP 客户端 |
| F | `electron/engines/claude-runtime-extensions.ts` | — | 注册新 MCP server（L91-97 处） |
| G workflow | `shared/browser-automation/workflow-output.ts` | 41 | 工具白名单扩员 |
| G | `electron/services/workflow-runtime/prompt-builder.ts` | — | 提示词段落（L127-160） |
| G | `browser-nodes/browser-task.ts` | 112 | 观察体积处理 |
| H 开关 | `sto-plugin/sto-builtin-tools.manifest.json` | 24 | 真源化（当前孤儿） |
| H | `electron/utils/store.ts` | — | AppSettings 加总开关（L24, L107） |
| H | `electron/utils/plugin-install.ts` | — | 安装列表消费 manifest |

---

## 三、差距清单

> "Kimi 参照"列为需求侧已确认的 kimi-webbridge 2.x / InAppBrowser 目标行为，直接作为验收语义，不再重新论证。

### P0（可靠性/安全基线）

| # | 缺口 | 现状证据 | Kimi 参照 | 落点 |
|---|---|---|---|---|
| P0-1 | @e 引用无代际校验 | ref 每次 `buildObservation()` 重建（observe-script L131-132），`resolveTarget` L147-164 直接按 ref 查当期表，错代际静默命中错误元素 | documentGeneration：observe 颁发代际号，act 携带校验，不一致即 `STALE_REF` | A1/A2/B4 |
| P0-2 | JS dialog 无熔断无处理 | 仓内无任何 `javascriptDialogOpening` / `will-prevent-unload` 处理 | CDP `Page.javascriptDialogOpening` 监听 + 策略化应答 + 风暴熔断 | B2/B9 |
| P0-3 | 3210 HTTP 通道无鉴权 | 仅 `isLoopback`（routes/browser-automation L12-15, L40-43）；无 token、无 Host 头校验（DNS rebinding 风险） | Bearer token + Host 头白名单 | C1/C3/E1 |
| P0-4 | 真实输入无可见性守卫 | `dispatchMouseClick`（input L93-119）直接投递坐标，不检查页面可见性 | 页面不可见/元素出视口时 fail-fast `PAGE_NOT_VISIBLE` | B4/B7/D1 |
| P0-5 | 产物写盘无加固 | 现无落盘路径（截图 base64 回传）；仓内无 `O_EXCL` 用法（已 grep 确认） | 临时目录 + sha256 + `O_EXCL` 原子写 | B3 |
| P0-6 | 同会话动作无串行化 | `service.act`（L132-195）裸跑，并发 act 会交错 observe/输入投递 | per-session promise 链 | B4 |

### P1（感知与动作能力）

| # | 缺口 | 现状证据 | Kimi 参照 | 落点 |
|---|---|---|---|---|
| P1-1 | 感知层为 DOM 注入 | observe-script L77-128 选择器硬编码、`MAX_ELEMENTS=120`（types L121） | CDP `Accessibility.getFullAXTree`，60k 节点预算、三轮降级、collapsed 子树下钻、interactive-only | B5/B6/A1 |
| P1-2 | 无 ba_find 检索 | 只有 name 模糊匹配（observe-script L155-162） | ba_find 返回 `interactiveAncestorRef`（静态文本命中上溯可交互祖先） | B4/B6/E2 |
| P1-3 | 无动作后自动快照语义 | act 固定 observe 两次（service L141/L173），不可关、无 300ms 延迟 | `snapshot:true` 时动作后 300ms 自动快照 | A1/B4 |
| P1-4 | 无 read_page | 无滚动收集能力 | 滚动收集：去重 + 冻结检测 + 分页，长文走 artifact | B4/E2 |
| P1-5 | fill 主路径是裸赋值 | `act('fill')`（observe-script L182-187）直接 `el.value=`；双路径只在 CDP fill 链（input L236 兜底 + L216-239） | 原型 setter / contenteditable 双路径为**主路径** | A2 |
| P1-6 | click 无降级链 | JS `el.click()`（observe-script L178-181）无遮挡检测、无投递验证 | click→mouse_click 降级链：遮挡检测（elementFromPoint）+ 投递探针 | A2/B7 |
| P1-7 | 导航无 readyState 兜底 | navigate 后只 `waitAfterAction`（service L144-147）；`waitForCondition` 无 readyState 类型 | readyState≥interactive 兜底 | B4/B8 |
| P1-8 | 截图为 capturePage | `cdp-session.ts` L48-51；不支持元素 clip | CDP `Page.captureScreenshot` + 元素 clip | B1 |
| P1-9 | 无 printToPDF | 仓内零 `printToPDF` 调用（已 grep 确认） | 新增 printToPDF 产物 | B1/B4 |
| P1-10 | 无有界抓包 | 只有 embed 分区的 webRequest 日志（sclaw-embed-browser-runtime L79-90），managed 会话 `pendingRequests` 恒 0（service L325-327） | CDP Network 有界抓包（条数/字节上限） | B10 |

### P2（多 tab 与治理）

| # | 缺口 | 现状证据 | Kimi 参照 | 落点 |
|---|---|---|---|---|
| P2-1 | 无 owned/borrowed tab 语义 | `LiveSession` 仅 `source: 'embed'\|'managed'`（service L30-32） | owned（自动化创建可销毁）/ borrowed（用户 tab 只借不毁）显式语义 | A4/B9/C4 |
| P2-2 | 无任务标签组 | bridge 命令无 group 语义 | 真实 Chrome 侧按任务打标签组（chrome.tabGroups，扩展端） | A4/C4/E3 + **仓外扩展** |
| P2-3 | 无被驱动 tab 视觉标记 | 无任何标记 | 被驱动 tab 高亮/徽标（embed 侧可本仓做；Chrome 侧依赖扩展） | D1 + 仓外扩展 |
| P2-4 | 无用户总开关 | 仅 env flag（feature-flag L3-8），AppSettings 无对应键（store.ts L24/L107） | 设置页总开关，关闭即全链路禁用 | H |
| P2-5 | 扩展↔服务无版本配对 | `installedExtensionVersion` 字段已存在（browser-bridge-service L21/L87-89），settings 路由已有 `updateAvailable` 雏形（routes/browser-bridge L88-92），但 connect 不校验 | 配对时版本比对，不兼容拒绝/告警 | C4 |
| P2-6 | 无 cdp 裸调通道 | 无 | 白名单 method + 每方法超时 | A5/F3/B4/C1 |

---

## 四、文件级改动详单（主体）

### 全局约定：错误码枚举（新增，放 `shared/browser-automation/types.ts`）

```ts
export type BrowserAutomationErrorCode =
  // 引用与目标
  | 'STALE_REF'              // 代际不匹配，必须重新 observe
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_NOT_VISIBLE'
  | 'PAGE_NOT_VISIBLE'       // 可见性守卫
  // 输入投递
  | 'CLICK_OCCLUDED'         // 被遮挡且降级失败
  | 'CLICK_NOT_DELIVERED'    // 投递探针未命中
  | 'FILL_NOT_STUCK'         // 填后校验失败（现有文案升级成码）
  // 对话框
  | 'DIALOG_STORM'           // dialog 熔断
  // CDP
  | 'CDP_TIMEOUT'
  | 'CDP_DOMAIN_UNSUPPORTED' // 触发 DOM 观察回退
  | 'CDP_METHOD_NOT_ALLOWED' // P2 白名单拒绝
  // HTTP 层
  | 'UNAUTHORIZED'           // 401 token 缺失/错误
  | 'HOST_MISMATCH'          // 403 Host 头非白名单
  | 'FEATURE_DISABLED'       // 503 总开关/flag 关闭
  | 'PAYLOAD_TOO_LARGE'      // 413
  // 会话与产物
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'ARTIFACT_WRITE_FAILED'
  // Bridge
  | 'BRIDGE_SESSION_NOT_FOUND'
  | 'BRIDGE_VERSION_MISMATCH';
```

HTTP 映射约定：`UNAUTHORIZED→401`、`HOST_MISMATCH/FEATURE_DISABLED→403/503`、`PAYLOAD_TOO_LARGE→413`；其余为领域错误，HTTP 200 + `{ success:false, error:{ code, message } }`（沿用现有信封，route-utils `sendJson` L21-26 不变）。

---

### A. shared 层（一切改动的锚点）

#### A1. `shared/browser-automation/types.ts`（现 121 行）

**现有结构**：`BrowserAutomationAction` union（L5-11）；`BrowserAutomationElementRef`（L33-47）；`BrowserAutomationPageObservation`（L49-58）；`BrowserAutomationSession`（L60-69）；`BrowserAutomationActPayload`（L71-80）；`BrowserAutomationWaitCondition`（L82-88）；常量 4 个（L118-121）。

**改动**：

1. `BrowserAutomationAction` 扩员（向后兼容，旧 payload 不受影响）：

```ts
// 前：'click' | 'fill' | 'select' | 'navigate' | 'scroll' | 'press'（L5-11）
// 后：
export type BrowserAutomationAction =
  | 'click' | 'fill' | 'select' | 'navigate' | 'scroll' | 'press'
  | 'mouse_click' | 'read_page' | 'screenshot' | 'print_pdf' | 'network_capture';
```

2. `BrowserAutomationPageObservation` 加字段（L49-58 基础上）：

```ts
export interface BrowserAutomationPageObservation {
  sessionId: string; url: string; title: string; timestamp: number;   // 既有
  elements: BrowserAutomationElementRef[]; fingerprint: string;        // 既有
  networkState: 'idle' | 'loading'; pendingRequests: number;           // 既有
  documentGeneration: number;                       // 新增：@e 代际号（主进程颁发）
  observationMode: 'dom' | 'ax';                    // 新增
  truncated?: boolean;                              // 新增：AX 预算截断/降级标记
  dialogs?: BrowserAutomationDialogRecord[];        // 新增：自上次 observe 以来的 dialog
}
```

3. `BrowserAutomationActPayload` 加字段（L71-80 基础上）：

```ts
export interface BrowserAutomationActPayload {
  // 既有字段不变（ref/stableKey/name/action/value/url/key/scrollY）
  generation?: number;   // 新增：携带 observe 拿到的 documentGeneration
  snapshot?: boolean;    // 新增：默认 true；false 跳过动作后自动快照
}
```

4. 新增类型：

```ts
export interface BrowserAutomationDialogRecord {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultValue?: string;
  handled: 'accepted' | 'dismissed' | 'auto';
  at: number;
}

export interface BrowserAutomationArtifactRef {
  artifactId: string;     // sha256 前 16 位 + 时间基，禁止含路径分隔符
  path: string;           // 绝对路径（仅本机展示/读取）
  sha256: string;
  bytes: number;
  mimeType: string;
  createdAt: string;      // ISO
}

export interface BrowserAutomationFindQuery {
  text?: string; role?: string; name?: string;
  interactiveOnly?: boolean;   // 默认 true
  maxResults?: number;         // 默认 20
}
export interface BrowserAutomationFindMatch {
  ref: string; stableKey: string; role: string; name: string;
  interactiveAncestorRef?: string;   // 静态文本命中时上溯的可交互祖先
  boundingBox?: BrowserAutomationBoundingBox;
}
export interface BrowserAutomationFindResult {
  matches: BrowserAutomationFindMatch[];
  documentGeneration: number;
  truncated: boolean;
}

export interface BrowserAutomationReadPageOptions {
  maxPages?: number;      // 默认 BROWSER_AUTOMATION_READ_PAGE_MAX_PAGES
  pixelPerPage?: number;  // 默认 viewport 高
  includeArtifact?: boolean;
}
export interface BrowserAutomationReadPageResult {
  text: string; pages: number;
  frozen: boolean;        // 滚动冻结检测命中（页面不再产生新内容）
  truncated: boolean;
  artifact?: BrowserAutomationArtifactRef;
}

export interface BrowserAutomationNetworkCaptureOptions {
  urlFilter?: string;        // 正则
  maxEntries?: number;       // 默认 500
  maxTotalBodyBytes?: number;// 默认 2 * 1024 * 1024
  includeBodies?: boolean;   // 默认 false
}
```

5. 新增常量（既有 4 个 L118-121 保留）：

```ts
export const BROWSER_AUTOMATION_AX_NODE_BUDGET = 60_000;
export const BROWSER_AUTOMATION_POST_ACTION_SNAPSHOT_MS = 300;
export const BROWSER_AUTOMATION_CDP_TIMEOUT_MS = 30_000;
export const BROWSER_AUTOMATION_DIALOG_STORM_LIMIT = 10;
export const BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS = 5_000;
export const BROWSER_AUTOMATION_READ_PAGE_MAX_PAGES = 20;
export const BROWSER_AUTOMATION_READ_PAGE_MAX_CHARS = 24_000;
export const BROWSER_AUTOMATION_NETWORK_RING_MAX_ENTRIES = 500;
export const BROWSER_AUTOMATION_NETWORK_MAX_BODY_BYTES = 2 * 1024 * 1024;
```

**依赖**：无。**被依赖**：全部后续文件。

#### A2. `shared/browser-automation/observe-script.ts`（现 342 行）

**现有结构**：单字符串注入脚本。`window.__stoBrowserAutomation`（L285-292）暴露 6 个函数；`act`（L166-207）覆盖 6 种动作；`fillWithNativeSetter`（L216-239）已实现原型 setter + contenteditable 双路径，但仅被 CDP fill 链的兜底（input L236）使用。

**改动点**（注入脚本内为 ES5 风格 JS，以下为页内函数面的前后对比，TS 签名描述其契约）：

1. `buildObservation` 增加 `navEpoch` 上报：

```ts
// 前：buildObservation(): { url, title, timestamp, elements, fingerprint }（L130-145）
// 后：buildObservation(): 同上 & { navEpoch: string }
// navEpoch = simpleHash(location.href + '|' + performance.timeOrigin)
// 注意：代际号本体由主进程颁发（B4），页面侧只提供换代检测信号——
// 注入脚本每次执行重建 refMap（L131-132），页面内维护的计数不可信。
```

2. `act('fill')` 主路径改走 `fillWithNativeSetter`（现 L182-187 裸赋值 → 调 L216-239 既有函数；同时修复 contenteditable 分支的 InputEvent 派发，L219-221 现状是 `textContent` 直赋，保留但补 `insertText` inputType）。

3. `act('click')` 加遮挡检测（L178-181 基础上）：

```ts
// 后：act(payload & { generation?: number }): {
//   success: boolean; staleRef?: boolean;
//   occluded?: boolean; occluder?: string;   // elementFromPoint 命中非目标/非祖先时的描述
//   ...
// }
```

4. `resolveTarget` 代际校验：`payload.generation` 与最近一次 `buildObservation` 记录的页内代际不一致 → 返回 `{ staleRef: true }`（兜底双保险；主校验在 B4 主进程侧）。

5. 新增页内函数（挂到 `window.__stoBrowserAutomation` L285-292 的导出对象）：

```ts
installDialogHooks(policy: 'auto-accept' | 'auto-dismiss' | 'record-only'): boolean;
// wrap alert/confirm/prompt：记录 + 按策略返回；CDP dialog-guard 不可用时的 fallback。
// 风险：改写页面原生函数，record-only 模式下不接管，仅打补丁记录。

drainDialogs(): Array<{ type: string; message: string; at: number }>;

installClickProbe(): boolean;
// 在 window 捕获阶段挂一次性 pointerdown/click listener，记录事件目标链。

readClickProbe(): { delivered: boolean; targetMatched: boolean } | null;
// targetMatched = 事件目标链包含期望元素或其 interactiveAncestor。
```

**依赖**：A1。**被依赖**：B4/B7；E2 提示词需同步描述新行为。

#### A3. `shared/browser-automation/feature-flag.ts`（现 8 行）

**现有**：`isBrowserAutomationEnabled()`（L3-8）：env `STOCLAW_BROWSER_AUTOMATION` / `VITE_STOCLAW_BROWSER_AUTOMATION`，非 production 默认 true。

**改动**（前后签名）：

```ts
// 前
export function isBrowserAutomationEnabled(): boolean;

// 后（保留旧函数作兼容包装，designer-*.tsx / browser-nodes/index.ts L21 等现有调用点零改动）
export type BrowserAutomationLevel = 'off' | 'dom' | 'ax';
export function getBrowserAutomationLevel(): BrowserAutomationLevel;
//   env 优先：'0/off/false' → off；'ax' → ax；'1/true/dom' → dom；
//   未设置时：main 进程读 AppSettings.browserAutomationLevel（H2），renderer 由注入值决定；
//   production 默认 'dom'（现状是默认 true，即 dom 级），非 production 默认 'ax'（灰度策略见 §八）。
export function isBrowserAutomationEnabled(): boolean;   // = getBrowserAutomationLevel() !== 'off'
export function isBrowserAutomationAxEnabled(): boolean; // = getBrowserAutomationLevel() === 'ax'
```

**坑**：本文件同时被 renderer import（`designer-node-library.tsx` L3、`designer-edge.tsx` L19），**不能同步读 better-sqlite3**；renderer 侧 level 必须由构建期 env 或 settings IPC 预取后注入 `window.__stoBaLevel`。

**依赖**：H2（AppSettings 加键）。**被依赖**：B5（dom/ax 分流）、C1（503 门）、G。

#### A4. `shared/browser-bridge/types.ts`（现 52 行）

**现有**：`BrowserBridgeAction`（L1-8）、`BrowserBridgeSession`（L12-22）、`BrowserBridgeCommand`（L24-30）、常量（L47-52：EMBED_TAB_ID=-1、TTL 30s、STALE 60s、端口 3210）。

**改动**：

```ts
// action 扩员
export type BrowserBridgeAction =
  | 'snapshot' | 'click' | 'fill' | 'navigate' | 'screenshot' | 'evaluate' | 'scroll'  // 既有
  | 'read_page' | 'print_pdf' | 'cdp' | 'group_tabs' | 'mark_tabs';                     // 新增

// 会话语义
export interface BrowserBridgeSession {
  // 既有字段不变（sessionId/tabId/url/title/connectedAt/lastHeartbeat/token/source/embedRuntimeId）
  ownership: 'owned' | 'borrowed';       // 新增：owned=自动化驱动创建；borrowed=用户已有 tab
  extensionVersion?: string;             // 新增：connect 时上报
  groupId?: string;                      // 新增：任务标签组（扩展端执行）
  taskLabel?: string;                    // 新增：人类可读任务名（标签组命名）
}

// 命令 payload 约定（不改动 interface，payload 本就是 Record<string, unknown> L27）：
// group_tabs: { groupId, title, color, tabIds: number[] }
// mark_tabs:  { marked: boolean, label? }            → 扩展端给 tab 加视觉标记
// cdp:        { method, params }                     → 走 A5 白名单
```

**依赖**：A1。**被依赖**：browser-bridge-service、routes/browser-bridge、E3、F2。

#### A5. `shared/browser-automation/cdp-allowlist.ts`（新增）

```ts
/** P2：cdp 裸调白名单 + 每方法超时。ba 的 /cdp 路由与 bridge 的 'cdp' action 共用本表。 */
export const CDP_RAW_CALL_ALLOWLIST = {
  'Runtime.evaluate':        { timeoutMs: 10_000 },
  'Runtime.getProperties':   { timeoutMs: 5_000 },
  'DOM.describeNode':        { timeoutMs: 5_000 },
  'DOM.getContentQuads':     { timeoutMs: 5_000 },
  'DOM.getBoxModel':         { timeoutMs: 5_000 },
  'Page.getFrameTree':       { timeoutMs: 5_000 },
  'Emulation.setDeviceMetricsOverride': { timeoutMs: 5_000 },
} as const satisfies Record<string, { timeoutMs: number }>;

export type CdpAllowlistedMethod = keyof typeof CDP_RAW_CALL_ALLOWLIST;
export function isCdpMethodAllowed(method: string): method is CdpAllowlistedMethod;
export function cdpMethodTimeoutMs(method: string): number; // 不在表内 → 抛 CDP_METHOD_NOT_ALLOWED
```

设计要点：只读/低危方法优先；`Page.navigate`、`Network.setCookie`、`Input.*` 一律不进表（已有专用动作通道）；表即文档，扩表需评审。

---

### B. Electron 主进程 · automation 服务

#### B1. `electron/services/browser-automation/cdp-session.ts`（现 52 行，大改）

**现有结构**：`attach()`（L19-28，CDP 1.3 L4）、`detach()`（L30-40）、`send()`（L42-46，**无超时**）、`captureScreenshot()`（L48-51，走 `webContents.capturePage`）。

**改动（前后签名对比）**：

```ts
// —— send：加超时 + 失效重建 ——
// 前
send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
// 后
send<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  opts?: { timeoutMs?: number },   // 默认 BROWSER_AUTOMATION_CDP_TIMEOUT_MS
): Promise<T>;
// 行为：超时 reject { code: 'CDP_TIMEOUT' }；
// 捕获 "Debugger is not attached"/target closed 类错误 → resetIfStale() 后重试一次；
// 第二次失败抛出。串行化（B4）落地后，无超时的 send 会堵死整个会话队列，此项是硬依赖。

// —— captureScreenshot：CDP 主路径 + clip ——
// 前
captureScreenshot(): Promise<Buffer>;
// 后
captureScreenshot(opts?: {
  format?: 'png' | 'jpeg';
  quality?: number;                        // 仅 jpeg
  clip?: BrowserAutomationBoundingBox;     // page CSS px；调用方负责先 scrollIntoView
}): Promise<Buffer>;
// 行为：Page.captureScreenshot 优先；CDP_DOMAIN_UNSUPPORTED → 回退 webContents.capturePage()。
// clip 坐标换算：CSS px × devicePixelRatio × webContents.getZoomFactor()（§六 R3）。

// —— 新增 ——
onCdpEvent(method: string, handler: (params: unknown) => void): void;
offCdpEvent(method: string, handler: (params: unknown) => void): void;
// 包装 webContents.debugger.on('message', (_e, method, params))；
// detach() 时必须摘除全部已注册 handler（多 session 并存时防串扰/泄漏，§六 R2）。

enableDomains(...domains: Array<'Page' | 'Network' | 'DOM' | 'Runtime' | 'Emulation'>): Promise<void>;
// 幂等；内部记录已 enable 集合；单域失败抛 CDP_DOMAIN_UNSUPPORTED 供上层降级。

printToPdf(opts?: {
  printBackground?: boolean;   // 默认 true
  landscape?: boolean;
  pageRanges?: string;
  scale?: number;
}): Promise<Buffer>;
// 走 webContents.printToPDF()，不走 CDP Page.printToPDF（headful Chromium 下不可靠，§六 R4）。

resetIfStale(error: unknown): boolean;
// 识别 debugger 会话失效（site isolation 换进程后 webContents.id 不变但会话已死）；
// 返回 true 表示已重置 attached 标志，可安全重试 attach。
```

**依赖**：A1（常量/错误码）。**被依赖**：B2/B5/B6/B7/B10、sclaw-embed-bridge-driver（已 import 本类，L11-12）。

#### B2. `electron/services/browser-automation/dialog-guard.ts`（新增）

```ts
import type { BrowserAutomationCdpSession } from './cdp-session';
import type { BrowserAutomationDialogRecord } from '../../../shared/browser-automation/types';

export type DialogPolicy = 'auto-accept' | 'auto-dismiss' | 'record-only';

export interface DialogGuardHandle {
  drain(): BrowserAutomationDialogRecord[];   // 取走并清空（observe/act 返回时附带）
  isStorming(): boolean;
  detach(): void;
}

export function attachDialogGuard(
  cdp: BrowserAutomationCdpSession,
  opts?: {
    policy?: DialogPolicy;        // 默认 'auto-dismiss'（自动化场景保守不解 confirm 的"确定"）
    stormLimit?: number;          // 默认 BROWSER_AUTOMATION_DIALOG_STORM_LIMIT
    stormWindowMs?: number;       // 默认 BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS
  },
): DialogGuardHandle;
```

实现要点：
- `cdp.enableDomains('Page')` → `onCdpEvent('Page.javascriptDialogOpening', …)` → 按 policy 调 `Page.handleJavaScriptDialog { accept, promptText? }`，同时入 ring buffer（容量 50）。
- 风暴熔断：滑动窗口内计数超阈 → 全部 dismiss、`storming=true`；service 层在 `act` 前置检查 `isStorming()` → 直接失败 `DIALOG_STORM`，不再向页面投递任何输入。
- `beforeunload` **不会**触发 `javascriptDialogOpening`：managed 窗口在 B9 挂 `webContents.on('will-prevent-unload', e => e.preventDefault())`；embed webview 同理（绑定处在 sclaw-embed-browser-runtime，改 D1 时顺带挂）。
- 降级路径：`enableDomains('Page')` 抛 `CDP_DOMAIN_UNSUPPORTED` → 注入脚本 `installDialogHooks`（A2）接管，`drain()` 合并两路记录。

**依赖**：B1（事件订阅）、A1（记录类型/常量）。**被依赖**：B4。

#### B3. `electron/services/browser-automation/artifact-writer.ts`（新增）

```ts
import type { BrowserAutomationArtifactRef } from '../../../shared/browser-automation/types';

export interface WriteBaArtifactInput {
  bytes: Buffer;
  kind: 'screenshot' | 'pdf' | 'read_page' | 'network_har';
  ext: '.png' | '.jpg' | '.pdf' | '.md' | '.json';
  sessionId: string;
  runId?: string;
}

export async function writeBaArtifact(input: WriteBaArtifactInput): Promise<BrowserAutomationArtifactRef>;
// 目录：<userData>/browser-artifacts/<yyyymmdd>/<kind>-<ts>-<rand8>.<ext>
// 流程：mkdir -p → 写 `.<name>.tmp-<pid>` → createHash('sha256') 计算摘要
//       → open(finalPath, 'wx')  // O_EXCL，EEXIST 换 rand 重试 ≤3 次
//       → rename(tmp, final)     // 同分区原子落盘
//       → browserAutomationRepository.insertArtifact(...)
// 错误：ARTIFACT_WRITE_FAILED（含 EEXIST 耗尽、ENOSPC 等）

export async function readBaArtifact(artifactId: string): Promise<{
  ref: BrowserAutomationArtifactRef;
  bytes: Buffer;
}>;
// artifactId 白名单校验 /^[A-Za-z0-9-]+$/ + 路径前缀必须落在 browser-artifacts 根内（防穿越）。
```

仓内已有 sha256 实践可参照（如 `electron/utils/plugin-install.ts`、`code-source-archive.ts` 的 `createHash('sha256')` 用法），无需引入新依赖。

**依赖**：A1；repository 新方法（B11）。**被依赖**：B4、C1。

#### B4. `electron/services/browser-automation/service.ts`（现 354 行，编排核心）

**现有结构**：`createSession`（L38-96）、`observe`（L122-130）、`act`（L132-195）、`wait`（L197-203）、`validate`（L205-232）、`captureScreenshot`（L238-241）、`requireDeps`（L311-344，组 cdp/executeJavaScript/waitDeps；`pendingRequests` 仅 embed 源 L325-327）、`nextStepIndex`（L346-351）。

**改动**：

1. 新增私有设施：

```ts
private readonly sessionChains = new Map<string, Promise<unknown>>();
private readonly generations = new Map<string, number>();
private readonly dialogGuards = new Map<string, DialogGuardHandle>();
private readonly refTables = new Map<string, RefTable>();        // AX 模式 ref ↔ backendNodeId
private readonly networkRecorders = new Map<string, NetworkCaptureHandle>();

private enqueue<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
// per-session promise 链尾接；fn 抛错不断链（catch 后重新 throw，链上记 resolved）。
// observe/act/wait/validate/captureScreenshot/printToPdf/find/readPage/networkCapture/invokeCdp 全部入队。

private bumpGeneration(sessionId: string): number;
private assertGeneration(sessionId: string, generation?: number): void;
// generation === undefined → 放行但记 warn（灰度期行为，见 §八）；
// 不匹配 → throw { code: 'STALE_REF', message: '页面已变更，请重新 ba_observe' }。

private async assertPageActionable(session: LiveSession): Promise<void>;
// embed：读 runtime meta 的 visible 标志（D1 上报，落地于 sclaw-embed-browser-runtime meta）；
// managed：win.isVisible() && !win.isMinimized()；
// 不通过 → throw { code: 'PAGE_NOT_VISIBLE' }。
// showManaged:false 的离屏窗口属"预期不可见"，创建时打 headless 标记豁免本守卫。
```

2. `requireDeps`（L311-344）内：首次建 cdp 时 `attachDialogGuard(cdp)`（B2）并把 handle 存 `dialogGuards`；`pendingRequests` 数据源改为 B10 的 inflight 计数（embed/managed 一致），webRequest 日志（L325-327）保留为 fallback。

3. `observe` 变更：

```ts
// 前
async observe(sessionId: string): Promise<BrowserAutomationPageObservation>;
// 后
async observe(
  sessionId: string,
  opts?: { mode?: 'dom' | 'ax'; interactiveOnly?: boolean },  // mode 默认取 A3 的 level
): Promise<BrowserAutomationPageObservation>;
// 行为：入队；成功后 bumpGeneration 并写入 observation.documentGeneration；
// 附带 dialogGuards.get(sessionId)?.drain()；
// ax 模式异常（CDP_DOMAIN_UNSUPPORTED 等）→ warn + 回退 dom 模式返回（observationMode 如实标注）。
```

4. `act` 变更（L132-195 基础上）：
- 入队；`assertGeneration(sessionId, payload.generation)` → 前置失败 `STALE_REF`（不计 step）。
- `assertPageActionable` + dialog 风暴前置检查（`DIALOG_STORM`）。
- 分发扩展：`click` 改走 B7 `actClickWithFallback`（JS→CDP 降级链在 B7 内），`mouse_click` 直接走 CDP 坐标点击；`read_page`/`screenshot`/`print_pdf`/`network_capture` 走对应新方法（允许以 act 形式调用，便于 workflow 既有单动作模型复用）。
- navigate 分支（L144-147）：`waitAfterAction` 后追加 `waitForReadyState(deps, ['interactive','complete'], 10_000)`（B8）。
- 动作后快照（L173 现状固定 observe）：改为 `payload.snapshot === false ? observationBefore : await delay(300).then(observe)`，常量取 `BROWSER_AUTOMATION_POST_ACTION_SNAPSHOT_MS`。
- step 落库（L176-191）：`observationJson` **不再全量存 before+after**，改存摘要 `{ url, title, fingerprint, elementCount, documentGeneration, truncated }` + `observationArtifactId?`（AX 模式下全量树走 B3 落盘）。**防 ba_step_run 表体积爆炸**（§六 R8）。

5. `captureScreenshot` 变更（注意：现无调用方，可直接改语义）：

```ts
// 前
async captureScreenshot(sessionId: string): Promise<Buffer>;
// 后
async captureScreenshot(
  sessionId: string,
  opts?: { ref?: string; format?: 'png' | 'jpeg'; quality?: number },
): Promise<BrowserAutomationArtifactRef>;
// ref → 由 RefTable/页面脚本拿 boundingBox → scrollIntoView → cdp.captureScreenshot({ clip })
```

6. 新增公开方法（HTTP/工具层的直接支撑）：

```ts
async find(sessionId: string, query: BrowserAutomationFindQuery): Promise<BrowserAutomationFindResult>;
// 实现：ax 模式在内存中的最近一棵 AX 树上检索（无树则先 observe）；
// 静态文本节点命中时沿父链上溯最近可交互节点，填 interactiveAncestorRef（B6 提供父链索引）。

async readPage(sessionId: string, opts?: BrowserAutomationReadPageOptions): Promise<BrowserAutomationReadPageResult>;
// 循环：收集 viewport innerText → scrollBy(pixelPerPage) → 等 250ms → 再收集；
// 去重：相邻页文本前缀重叠裁剪；冻结检测：连续 2 页 scrollY 不变且新增文本为 0 → frozen=true 提前终止；
// 分页上限 READ_PAGE_MAX_PAGES，字符上限 READ_PAGE_MAX_CHARS 超出 → truncated + 全量走 artifact（B3, kind:'read_page', ext:'.md'）。

async printToPdf(sessionId: string, opts?: Parameters<BrowserAutomationCdpSession['printToPdf']>[0]): Promise<BrowserAutomationArtifactRef>;

async startNetworkCapture(sessionId: string, opts?: BrowserAutomationNetworkCaptureOptions): Promise<{ captureId: string }>;
async stopNetworkCapture(sessionId: string, captureId: string): Promise<{
  entries: NetworkEntrySummary[]; truncated: boolean; artifact?: BrowserAutomationArtifactRef;
}>;

async invokeCdp(sessionId: string, method: string, params?: Record<string, unknown>): Promise<unknown>;
// P2：先 isCdpMethodAllowed(method)（A5），再 cdp.send(method, params, { timeoutMs: cdpMethodTimeoutMs(method) })。
```

7. `disposeSession`（L243-255）补充清理：dialogGuards/refTables/networkRecorders/sessionChains/generations 同步删除。

**依赖**：A1/A2/A3、B1/B2/B3/B5/B6/B7/B8/B10、B11。**被依赖**：C1、G4。

#### B5. `electron/services/browser-automation/observer.ts`（现 48 行）

**现有**：`observePage(sessionId, cdp, executeJavaScript, networkState)`（L16-21），执行 `buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS)`（L22-24），截断 L26-28。

**改动**：

```ts
// 前
export async function observePage(
  sessionId: string,
  cdp: BrowserAutomationCdpSession,
  executeJavaScript: (script: string) => Promise<unknown>,
  networkState: { networkState: 'idle' | 'loading'; pendingRequests: number },
): Promise<BrowserAutomationPageObservation>;

// 后
export async function observePage(
  sessionId: string,
  cdp: BrowserAutomationCdpSession,
  executeJavaScript: (script: string) => Promise<unknown>,
  networkState: { networkState: 'idle' | 'loading'; pendingRequests: number },
  opts?: { mode?: 'dom' | 'ax'; interactiveOnly?: boolean; refTable?: RefTable },
): Promise<BrowserAutomationPageObservation>;
// mode==='ax' → 委托 B6 captureAxTree；'dom' 维持现状（navEpoch 透传，A2）。
// documentGeneration 由 service 层在返回前填入（observer 不管代际）。
```

**依赖**：A1、B6。**被依赖**：B4。

#### B6. `electron/services/browser-automation/ax-observer.ts`（新增，P1 感知层主体）

```ts
import type { BrowserAutomationCdpSession } from './cdp-session';
import type { BrowserAutomationElementRef } from '../../../shared/browser-automation/types';

/** per (session, generation) 的 ref ↔ backendNodeId 映射；AX 模式下 ref 由主进程分配，不再依赖页内 refMap。 */
export class RefTable {
  constructor(readonly generation: number);
  assign(backendNodeId: number, meta: { role: string; name: string }): string; // 返回 '@eN'
  resolve(ref: string): number | undefined;
  resolveStableKey(ref: string): string | undefined;
  size(): number;
}

export interface AxCaptureOptions {
  budget?: number;          // 默认 BROWSER_AUTOMATION_AX_NODE_BUDGET（60_000）
  interactiveOnly?: boolean;
  expandRefs?: string[];    // collapsed 子树下钻：对这些 ref 取子树补充
}

export interface AxCaptureResult {
  elements: BrowserAutomationElementRef[];  // 结构复用 A1，额外塞 backendNodeId（见下）
  refTable: RefTable;
  truncated: boolean;
  degradationRound: 0 | 1 | 2;   // 0=完整；1=裁深度/去静态文本；2=interactive-only
  rawNodeCount: number;
}

export async function captureAxTree(
  cdp: BrowserAutomationCdpSession,
  generation: number,
  opts?: AxCaptureOptions,
): Promise<AxCaptureResult>;
```

实现要点：
- 前置 `enableDomains('DOM')`；`Accessibility.getFullAXTree`（不需要 `Accessibility.enable`，**但 Electron 转发该域的行为待 PoC 验证，§六 R1**）。
- `BrowserAutomationElementRef` 扩展字段（A1 补）：`backendNodeId?: number; parentRef?: string; hasCollapsedSubtree?: boolean`。
- 三轮降级：raw > budget → round 1（去 `StaticText`/`InlineTextBox`、裁 depth>N 的非交互子树）→ round 2（只留交互 role 白名单：link/button/textbox/combobox/listbox/menuitem/tab/checkbox/radio/switch/option/searchbox/slider/spinbutton/treeitem）。
- collapsed 子树：AXNode `expanded=false` 或有未取回子节点 → `hasCollapsedSubtree: true`；`expandRefs` 下钻用 `Accessibility.getChildAXNodes` 或对 backendNodeId 局部 `DOM.describeNode`+页面遍历回填。
- bbox：批量 `DOM.getContentQuads { backendNodeId }`（按批 100 个/次）；失败节点跳过 bbox（字段 optional 化，A1 同步）。
- 异常：任何一步抛错 → 包装 `CDP_DOMAIN_UNSUPPORTED` 上抛，由 B5/B4 回退 DOM 观察。

**依赖**：A1、B1。**被依赖**：B4/B5。**这是 P1 最大单块工作量，也是 PoC 先行项。**

#### B7. `electron/services/browser-automation/input.ts`（现 297 行）

**现有**：`actFillOrType`（L205-257，CDP 点击聚焦→insertText→填后校验→native setter 兜底）；`dispatchMouseClick`（L93-119）；`KEY_DEFS`（L35-53）；`actPressKey`（L259-283）。

**改动**：

1. 顺手修 bug：`End` 键 keyCode 误为 36（L46），Windows VK_END 应为 35（Home=36 正确，L45）。
2. 新增：

```ts
export interface ClickFallbackResult extends BrowserAutomationActResult {
  via: 'js' | 'cdp';
  occluded?: boolean;
  probeDelivered?: boolean;
}

export async function actClickWithFallback(input: {
  cdp: BrowserAutomationCdpSession;
  executeJavaScript: (script: string) => Promise<unknown>;
  payload: BrowserAutomationActPayload;
}): Promise<ClickFallbackResult>;
// ① 页内 installClickProbe（A2）→ JS el.click()（带遮挡检测返回值）
// ② occluded 或 50ms 后 readClickProbe().delivered === false
//    → 取元素中心点，dispatchMouseClick（复用 L93-119）
// ③ 再读探针：事件目标链不含目标且不含 interactiveAncestor
//    → { success:false, error.code:'CLICK_NOT_DELIVERED', occluder }
// JS 路径成功：{ via:'js' }；CDP 路径成功：{ via:'cdp', probeDelivered:true }

export function assertElementActionable(resolved: ResolvedInputTarget): void;
// disabled / rect 出视口 / 尺寸为 0 → 抛 ELEMENT_NOT_VISIBLE；
// fill 前 readonly → 抛确定性错误。
```

3. `actFillOrType`（L205-257）前置插入 `assertElementActionable(resolved)`；`valuesMatch`（L86-91）的 `includes` 语义对短期望值有假阳性，保持行为但在注释中标注（workflow 校验场景已依赖现状，不改语义避免回归）。

**依赖**：A1/A2、B1。**被依赖**：B4、sclaw-embed-bridge-driver（fill 已复用本模块 L100-119）。

#### B8. `electron/services/browser-automation/wait-engine.ts`（现 87 行）

**现有**：`waitForCondition`（L17-76：url L34-39 / navigation L41-45 / networkIdle L47-54 / selector L56-70）；`waitAfterAction`（L78-87）。

**改动**：

```ts
// 新增
export async function waitForReadyState(
  deps: WaitEngineDeps,
  states: Array<'interactive' | 'complete'>,
  timeoutMs = 10_000,
): Promise<{ success: boolean; message: string }>;
// 轮询 executeJavaScript('document.readyState')，命中 states 即返回。

// waitAfterAction 签名不变，行为扩展：
// action==='navigate' → navigation 等待 + waitForReadyState 兜底；
// 其余维持 networkIdle 15s（L86），但 networkIdle 的计数源改 B10 inflight（经 deps.getPendingRequestCount，接口不变）。
```

**依赖**：B10（间接，经 deps）。**被依赖**：B4。

#### B9. `electron/services/browser-automation/session-manager.ts`（现 96 行）

**现有**：`createManagedSession`（L27-54，BrowserWindow L34-44）、`resolveSessionWebContents`（L56-65）、`closeManagedSession`（L67-72）。

**改动**：
- 返回结构加 `ownership`：managed → `'owned'`；embed 路径在 service 注册时标 `'borrowed'`（A4 的语义在 BAP 侧同样落字段：`LiveSession` 加 `ownership`，`publicSession` 透出）。`closeManagedSession` 维持只对 managed 生效（现状即正确，显式化为 `ownership==='owned'` 判断）。
- `createManagedSession` 内挂 `win.webContents.on('will-prevent-unload', e => e.preventDefault())`（B2 的 beforeunload 补丁）。
- P2 视觉标记（managed 侧）：窗口 title 前缀 `[自动操作]`；页面顶部条注入延后到 D1 一起做，避免两处样式源。
- 注意点（文档化）：managed 与 embed 共享 `persist:sclaw-embedded-browser` 分区（L39；`shared/sclaw-embed-browser.ts` L2），账号态互通是**特性**，owned/borrowed 语义不得破坏这一点。

**依赖**：A1/A4。**被依赖**：B4。

#### B10. `electron/services/browser-automation/network-recorder.ts`（新增）

```ts
import type { BrowserAutomationCdpSession } from './cdp-session';
import type { BrowserAutomationNetworkCaptureOptions } from '../../../shared/browser-automation/types';

export interface NetworkEntrySummary {
  requestId: string; url: string; method: string;
  status?: number; mimeType?: string;
  startTs: number; endTs?: number; durationMs?: number;
  bodyBytes?: number;            // 仅 includeBodies 时采集
  bodyArtifactId?: string;       // 大 body 走 B3 落盘
}

export interface NetworkCaptureHandle {
  readonly captureId: string;
  inflightCount(): number;       // 供 wait-engine networkIdle（embed/managed 统一数据源）
  stop(): { entries: NetworkEntrySummary[]; truncated: boolean };
}

export function startNetworkRecorder(
  cdp: BrowserAutomationCdpSession,
  opts?: BrowserAutomationNetworkCaptureOptions,
): NetworkCaptureHandle;
// Network.enable → requestWillBeSent/responseReceived/loadingFinished/loadingFailed 计数与记录；
// 有界：entries 超 maxEntries 或合计 body 超 maxTotalBodyBytes → 停止收集新 body，truncated=true；
// 单条 body > 256KB 直接走 artifact（B3, kind:'network_har'）。
```

**依赖**：A1、B1、B3。**被依赖**：B4、B8。

#### B11. `electron/db/repositories/browser-automation-repository.ts`（现 170 行）

**现有**：ba_session（L19-43）、ba_run（L55-76）、ba_step_run（L78-129，`observation_json` L108）。

**改动**（纯增量，既有表结构不动）：

```ts
async insertArtifact(row: {
  artifactId: string; sessionId: string; runId?: string | null;
  kind: string; path: string; sha256: string; bytes: number; mimeType: string;
}): Promise<void>;

async getArtifact(artifactId: string): Promise<Record<string, unknown> | undefined>;

async listArtifacts(filter: { sessionId?: string; runId?: string }): Promise<Array<Record<string, unknown>>>;
```

新表 `ba_artifact` 迁移：跟随仓内既有迁移机制（connection 初始化处登记；**具体迁移文件登记位置待施工时确认**，本仓 db 目录下有 migrations 体系，此处不臆造路径）。

**依赖**：无。**被依赖**：B3。

#### B12. `electron/services/browser-bridge-service.ts`（现 295 行，**补，不重写**）

**评估结论（任务点 4）**：配对/通信协议已**可用**——配对码签发与核销（L48-63）、token 集合与校验（L33/L65-68）、会话注册与 embed 直通（L101-144）、心跳（L151-158）、embed 优先的会话挑选（L160-176）、命令队列+TTL（L178-204）、结果存取+200ms 轮询等待（L206-244）、状态持久化到 openclaw 配置目录（L246-277）、过期清理（L279-292）。**真实 Chrome 桥要补的是字段、约束与仓外扩展端，不是重写服务端。**

**改动**：
1. `BrowserBridgeSession` 落 A4 新字段（ownership/extensionVersion/groupId/taskLabel）：`connectSession`（L101-126）入参扩展，extension 源默认 `ownership:'borrowed'`，embed 源 `'owned'`（embed webview 是应用创建的）。
2. token 治理：`tokens: Set<string>` → `Map<string, { createdAt: number; extensionVersion?: string }>`；`validateToken` 不变；新增轮换：

```ts
rotateTokens(opts?: { keepGraceMs?: number }): void;
// 全量作废旧 token（grace 期内旧 token 仍可用，默认 60s，给扩展重连窗口）。
```

3. 版本配对：

```ts
checkExtensionCompatibility(extensionVersion: string): {
  compatible: boolean; updateAvailable: boolean; reason?: string;
};
// 与 getBundledBrowserBridgeExtensionVersion()（electron/utils/browser-bridge-extension.ts L24-30）比 major/minor；
// major 不同 → compatible:false（connect 拒绝，BRIDGE_VERSION_MISMATCH）；minor 不同 → updateAvailable:true 放行。
```

4. `commandResults` 加容量上限（现状只有 5min 时间清理 L287-291）：超 1000 条按 completedAt 淘汰最旧。
5. `getPrimarySession`（L173-176）保持 embed 优先语义不变；新增 `listSessionsByGroup(groupId)`。

**依赖**：A4。**被依赖**：C4、E3。

---

### C. HTTP API 层

#### C1. `electron/api/routes/browser-automation.ts`（现 153 行）

**现有**：flag 门（L31-38）→ loopback 门（L40-43）→ 9 个端点（sessions GET L45 / POST L50、observe L61、act L72、wait L87、validate L101、runs L116、runs/complete L130、screenshot L141）。

**改动 1：鉴权（P0-3）**，在 loopback 检查之后插入：

```ts
function assertBrowserAutomationAuthorized(req: IncomingMessage): void;
// ① Host 头白名单：/^（127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/ → 否则 403 HOST_MISMATCH
//    （防 DNS rebinding：浏览器内恶意页面可 fetch 127.0.0.1:3210，但 Host 头不可伪造为白名单值之外的域名……
//     反之 attacker.com 解析到 127.0.0.1 时 Host=attacker.com，被此规则拦截）
// ② Authorization: Bearer <token>，与 C3 的 token 文件内容 timingSafeEqual 比对
//    → 缺失/错误 → 401 UNAUTHORIZED
// 灰度：env STOCLAW_BA_AUTH_ENFORCE=1 才强制 401；未开启时校验失败仅 warn 日志（§八）。
```

参照 `internal-request-auth.ts`（L11-21）的 timingSafeEqual 写法，但**不复用其进程内 secret**（OpenClaw 插件是外部进程，拿不到 randomBytes 内存值）——token 必须落盘分发（C3）。

**改动 2：新端点**：

| 方法 | 路径 | 说明 | 落库/落盘 |
|---|---|---|---|
| POST | `/api/browser-automation/find` | body `{ sessionId, query }` → B4.find | — |
| POST | `/api/browser-automation/read-page` | body `{ sessionId, opts }` → B4.readPage | 可选 artifact |
| POST | `/api/browser-automation/print-pdf` | body `{ sessionId, opts }` → artifact ref | B3 |
| POST | `/api/browser-automation/network/capture` | body `{ sessionId, captureId?, op:'start'\|'stop', opts? }` | B3（可选） |
| POST | `/api/browser-automation/cdp` | body `{ sessionId, method, params? }` → B4.invokeCdp（P2，A5 白名单） | — |
| GET | `/api/browser-automation/sessions/:id/dialogs` | drain 指定会话 dialog 记录 | — |
| GET | `/api/browser-automation/artifacts/:artifactId` | 读产物字节（Content-Type 按 ref.mimeType） | B3 |

**改动 3**：`screenshot`（L141-150）语义随 B4 改返回 artifact ref；现无调用方（已 grep 确认），无兼容负担。
**改动 4**：observe/act 请求体透传新字段（`mode`/`interactiveOnly`/`generation`/`snapshot`）。

**依赖**：B3/B4、C3。**被依赖**：E1/E2、F1。

#### C2. `electron/api/route-utils.ts`（现 39 行）

**现有**：`parseJsonBody`（L3-13，**无上限无超时**）、`setCorsHeaders`（L15-19，`Access-Control-Allow-Origin: *`）。

**改动**：

```ts
// 前
export async function parseJsonBody<T>(req: IncomingMessage): Promise<T>;
// 后（默认参数保持旧行为，41 个既有路由零影响）
export async function parseJsonBody<T>(
  req: IncomingMessage,
  opts?: { maxBytes?: number; timeoutMs?: number },
): Promise<T>;
// 超限 → 抛 { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' }；超时 → 408。
```

C1 的 read-page/network 端点显式传 `{ maxBytes: 8 * 1024 * 1024 }`。**坑**：本文件被全部路由共享，任何默认行为变更都是全局回归面（§六 R7）。CORS 现状 `*` 在加 token 后风险可控（浏览器跨域 fetch 带不出插件的 Authorization 头），不在本期改。

**依赖**：无。**被依赖**：C1 及其他全部路由（行为不变）。

#### C3. `electron/utils/openclaw-auth.ts`（改动点 L1532-1569）

**现有**：`ensureStoBrowserAutomationPluginConfig`（L1532-1555）写 openclaw.json 的 `plugins.entries['sto-browser-automation']`（enabled + config{hostApiHost, hostApiPort, commandTimeoutMs} L1540-1547）；`ensureStoBrowserAutomationPluginInOpenClaw`（L1557-1569）加锁落盘。

**改动**：

```ts
// 新增：token 的单一来源
export function getOrCreateBrowserAutomationToken(): string;
// 路径：getOpenClawConfigDir()/browser-automation.token；不存在则 randomBytes(32).toString('base64url') 写入，chmod 0600。
// 读取方：C1 鉴权（main 进程直读）、openclaw.json 插件 config（本函数写入）、Claude 侧（同进程直读）。

// ensureStoBrowserAutomationPluginConfig 的 config 块（L1540-1547）增加：
//   authToken: getOrCreateBrowserAutomationToken()
```

**坑**：openclaw.json 写入触发网关文件监听硬重启（本文件 L233-236 注释已记录 WS 1012 事故）；必须沿用 `writeOpenClawJson` 的"内容不变不写"机制，token 已存在时不得重复写（§六 R6）。

**依赖**：无。**被依赖**：C1、E1、F1。

#### C4. `electron/api/routes/browser-bridge.ts`（现 314 行）

**现有**：CORS 白名单含 `chrome-extension://`（L13-25）；token 门 `requireExtensionToken`（L37-44）；auto-connect（L67-80）；settings（L82-113，已有 `updateAvailable` 雏形 L88-92）；connect（L173-195）；poll（L216-226）；command（L228-258，embed flush 直通 L251-254）；result（L260-296）；sessions（L298-311）。

**改动**：
1. `/connect`（L173-195）：body 加 `extensionVersion` → `browserBridgeService.checkExtensionCompatibility`（B12）；`compatible:false` → 403 `BRIDGE_VERSION_MISMATCH`；`updateAvailable:true` → 响应带 `updateAvailable` + `bundledVersion`。
2. `/command`（L228-258）：`action` 接受 A4 新值；`cdp` action 先过 A5 白名单再入队（服务端拦截，不等扩展）；`group_tabs`/`mark_tabs` 仅对 `source==='extension'` 会话开放（embed 直接 400）。
3. 新端点 `POST /api/browser-bridge/rotate-tokens`（loopback-only）→ B12.rotateTokens。
4. embed flush 分支（L251-254）的 `sclaw-embed-bridge-driver` 需同步支持新 action 或显式返回 `{ success:false, error:'unsupported on embed' }`（§六 R5）。

**依赖**：A4/A5、B12。**被依赖**：E3、F2。

---

### D. 渲染层

#### D1. `src/lib/sclaw-browser-host-api.ts`（现 135 行）+ `src/components/sclaw-browser/SclawBrowserFrame.tsx`

**现有**：host-api 为 IPC 薄封装（registerRuntime L11-20、bindWebContents L30-38、executeScript L63-75、ensureBridge L108-115 等）；Frame 维护 webview 生命周期（事件发射 L247-253、`active` prop L57、`executeJS`/`getWebContentsId` L426-437）、`EMBED_WEBVIEW_PREFERENCES`（L29-30）。

**改动**：

```ts
// host-api 新增
export async function reportSclawBrowserVisibility(input: {
  runtimeId: string;
  visible: boolean;
  reason: 'drawer-toggle' | 'tab-switch' | 'window-blur' | 'dom-ready';
}): Promise<{ ok: boolean }>;
// IPC 'sclaw-browser:reportVisibility' → 写入 sclaw-embed-browser-runtime 的 meta.visible
// （B4 assertPageActionable 的数据源）。

// P2 视觉标记（embed 侧）
export function useSclawBrowserAutomationActive(runtimeId: string | null): boolean;
// eventBus 'browser:command'/'browser:result'（routes/browser-bridge L46-48 已有发射）
// → 主进程转发 renderer → overlay store 置位；Frame 消费。
```

Frame 侧改动：
- `active`/drawer 状态变化、tab 切换时调 `reportSclawBrowserVisibility`；`dom-ready` 后补一次（L295 附近已有钩子）。
- 新增 prop `automationActive?: boolean`：为 true 时容器叠加描边 + 角标"自动操作中"，样式落 `sclaw-browser-overlay.css`；同时给 webview 挂 `will-prevent-unload` 阻止（B2 补丁的 embed 侧落点）。
- `SclawBrowserHost.tsx`（现 33 行）无需结构改动，仅消费 store 新字段透传。

**依赖**：A1；主进程 IPC handler 新增（sclaw-browser 路由或 runtime 模块，随既有注册点）。**被依赖**：B4（可见性守卫数据）。

---

### E. OpenClaw 插件侧

#### E1. `sto-plugin/openclaw/sto-browser-automation/automation-client.ts`（现 112 行）

**现有**：`BrowserAutomationPluginConfig`（L1-5）、`fetchJson`（L16-26）、`ensureAutomationSession`（L28-68）、`postAutomation`（L77-87）、`formatObservationElements`（L101-112，截 80 条 L107）。

**改动**：

```ts
// 前
export type BrowserAutomationPluginConfig = { hostApiHost?: string; hostApiPort?: number; commandTimeoutMs?: number };
// 后
export type BrowserAutomationPluginConfig = {
  hostApiHost?: string; hostApiPort?: number; commandTimeoutMs?: number;
  authToken?: string;   // 新增：由 openclaw.json 插件 config 注入（C3 写入）
};

// fetchJson 内部统一注入：
// headers['Authorization'] = `Bearer ${cfg.authToken}`（有值时）
// 鉴权失败 401 时给可操作错误文案："BAP 鉴权失败：请重启 StoClaw 以刷新插件配置"
```

`formatObservationElements` 截断 80 → 参数化（默认维持 80，AX 模式下工具描述引导用 ba_find 而非全量列表）。

**依赖**：C1/C3。**被依赖**：E2。

#### E2. `sto-plugin/openclaw/sto-browser-automation/index.ts`（现 248 行）

**现有**：`BA_SYSTEM_PROMPT`（L30-37）；6 个工具：ba_create_session（L51-70）、ba_observe（L72-96）、ba_act（L98-144）、ba_wait（L146-181）、ba_validate（L183-225）、ba_start_run（L227-246）。

**改动**：
1. `ba_act` 参数扩展：`action` union 加 `mouse_click`/`read_page`/`screenshot`/`print_pdf`；新增 `generation: Type.Optional(Type.Number(...))`、`snapshot: Type.Optional(Type.Boolean(...))`；description 写明代际语义。
2. 新工具（schema 与 C1 端点一一对应）：

| 工具 id | 端点 | 关键参数 | 返回要点 |
|---|---|---|---|
| `ba_find` | `/find` | text/role/name/interactiveOnly/maxResults | matches[]（含 interactiveAncestorRef）+ documentGeneration |
| `ba_read_page` | `/read-page` | maxPages/includeArtifact | text 摘要 + pages/frozen/truncated + artifact |
| `ba_screenshot` | `/screenshot` | ref?/format? | artifact{ path, sha256, bytes }（**不回 base64**） |
| `ba_print_pdf` | `/print-pdf` | printBackground/pageRanges | artifact |
| `ba_network_capture` | `/network/capture` | op:'start'\|'stop'、captureId、urlFilter | entries 摘要 + truncated + artifact? |
| `ba_cdp`（P2） | `/cdp` | method/params | 裸调返回；description 明示白名单约束 |

3. `BA_SYSTEM_PROMPT` 重写（L30-37），要点：ref 带代际、收到 `STALE_REF` 必须重新 ba_observe；ba_find 用于按文本检索、interactiveAncestorRef 才是可点击目标；ba_read_page 与 ba_observe 的分工（读内容 vs 拿操作面）；产物为本地路径+sha256。

**坑（schema → 系统提示同步，§六 R9）**：`registerTool` 的 TypeBox schema 由 OpenClaw 网关自动序列化进 agent 工具面，改本文件即生效；但 `BA_SYSTEM_PROMPT` 是 `before_prompt_build`（L47-49）注入的**静态字符串**，必须与 schema 手工对齐；且插件经 `plugin-install.ts` 拷贝+hash 同步到 openclaw config extensions 目录（L828-847 的 toolkit 安装、L1591 的异步安装），dev 环境改完需触发重装/重同步才生效。

**依赖**：A1、C1、E1。**被依赖**：G1/G3（白名单与提示词联动）。

#### E3. `sto-plugin/openclaw/sto-browser-bridge/index.ts`（135 行）+ `bridge-client.ts`

**现有**：6 工具（bridge_snapshot L42-56、click L58-76、fill L78-96、navigate L98-110、screenshot L112-123、list_sessions L125-133）；`BRIDGE_SYSTEM_PROMPT`（L20-28）。bridge-client `runBridgeCommand`（L76-125，超时 L102、50ms 轮询 L111-123）、`pickBridgeSession` embed 优先（L56-72）。

**改动**：
1. `bridge_snapshot` 加 `mode: 'ax'` 参数（透传 payload，由服务端/扩展端实现；embed 端 ax 模式走 B6，扩展端待仓外实现，未支持时返回 `CDP_DOMAIN_UNSUPPORTED` 并保持 dom 快照可用）。
2. 新工具：`bridge_read_page`、`bridge_print_pdf`（P2）；`bridge_group_tabs`（groupId/title/color，仅扩展会话）；`bridge_cdp`（白名单，P2）。
3. `runBridgeCommand` 的 action union（L78）扩 A4 新值；`commandTimeoutMs` 对 `cdp` action 钳制到 A5 的每方法超时。
4. 提示词更新（L20-28），与 Claude 侧 `BRIDGE_SYSTEM_PROMPT`（F2）**逐字同步**。

**依赖**：A4、C4。**被依赖**：F2（提示词对齐源）。

---

### F. Claude 插件侧（工具面一致）

#### F1. `sto-plugin/claude/sto-browser-automation/`（新增目录，决策项）

**背景缺口**：Claude 会话侧目前只有 bridge_*（tools.ts L134-141 六工具），**ba_* 不存在**；更严重的是 workflow 的 claude 引擎 browser_task 把 `allowedTools: ba_*` 透传给 SDK（agent-runner-claude.ts L195），但同一处明确"no mcpServers"（L203）——**ba_* 在 claude 引擎下是不可解析的空引用**（现有隐性断链）。

**方案**：新建 MCP server 镜像 ba_* 工具面。

```ts
// tools.ts（新）：zod schema 版 ba_*，函数面与 E2 对齐
export const BA_MCP_SERVER_NAME = 'sto-browser-automation';
export function createBrowserAutomationMcpTools(cfg: BrowserAutomationClientConfig): SdkMcpTool[];
export function createBrowserAutomationMcpServer(cfg: BrowserAutomationClientConfig): McpServerConfig;
export const BA_SYSTEM_PROMPT = /* 与 E2 同文，抽常量共享 */;

// sdk/index.ts（新）：与 claude/sto-browser-tool/sdk/index.ts（现 37 行）同构
export function buildStoBrowserAutomationClaudeRuntimeOptions(context: {
  sessionKey: string; hostApiPort: number; hostApiHost?: string;
}): ClaudeRuntimeOptions;
```

HTTP 客户端**不要第三份拷贝**：把 `postAutomation`/`ensureAutomationSession` 提升到 `sto-plugin/sto-toolkit/browser-automation-client.ts`（sto-toolkit 已是共享库，plugin-install L290/L297-310 有嵌套拷贝机制），E1 与 F1 共同依赖。

注册点：`electron/engines/claude-runtime-extensions.ts` 的 `browserToolExtension`（L91-97）同构新增 `browserAutomationExtension`，`mcpServers` 合并逻辑（L83-87）现成；feature off 时返回 `{}`。

**依赖**：E1（客户端提升）、C1。**被依赖**：G1（claude 引擎 ba_* 可用后白名单才有意义）。

#### F2. `sto-plugin/claude/sto-browser-tool/tools.ts`（现 158 行）

**改动**：
- `BRIDGE_SYSTEM_PROMPT`（L13-21）与 `EMBED_BRIDGE_SYSTEM_PROMPT`（L23-28）跟 E3 逐字同步——**建议把两段提示词抽到 shared 常量文件双端 import**（当前是两份拷贝，已存在漂移风险）。
- bridge_* 工具 schema 同步 E3 新增参数（zod 版）。
- zod 与 TypeBox 双 schema 长期漂移风险：本期保持双写 + 单测断言（§七），中期可评估共享 JSON Schema 常量。

**依赖**：E3。**被依赖**：无。

#### F3. cdp 白名单消费

A5 的表同时被三处 import：B4.invokeCdp、C4（bridge command 拦截）、F1/E2 的 ba_cdp/bridge_cdp 工具 description 生成（把白名单 method 列表拼进工具描述，模型即可知边界）。

---

### G. workflow 层（向后兼容）

#### G1. `shared/browser-automation/workflow-output.ts`（现 41 行）

**现有**：`BROWSER_WORKFLOW_NODE_TYPES`（L18-24）、`BROWSER_AGENT_ALLOWED_TOOLS`（L26-33，6 个 ba_*）。

**改动**：`BROWSER_AGENT_ALLOWED_TOOLS` 追加 `'ba_find'`（波次 2）、`'ba_read_page'`（波次 2 末）；产物类工具（screenshot/print_pdf/network_capture）**不进** workflow 白名单（产物语义由 workflow artifact 体系另管，避免双轨）。

#### G2. `electron/services/workflow-runtime/browser-nodes/compile-browser-spec.ts`（现 79 行）

不动结构；`maxSteps` 默认 20（L25）维持；`permissionPolicy: { mode: 'readonly' }`（L63）维持。F1 落地后，claude 引擎的 browser_task 自动获得真实 ba_*（运行时经 chat 扩展注册），无需改本文件；F1 未落地前的过渡：在 `executeBrowserNode`（browser-nodes/index.ts L15-40）检测 `deps.execEngine==='claude' && !f1Ready` → 明确报"browser 节点暂需 openclaw 引擎"，替换现状的空引用静默失败。

#### G3. `electron/services/workflow-runtime/prompt-builder.ts`（改动点 L121-160）

浏览器任务提示词段落更新：observe→act→wait→validate 循环不变（L134）；新增"ref 带代际：ba_act 必须带最近一次 ba_observe 的 documentGeneration；收到 STALE_REF 重新 observe"；工具约束段（L155-160）默认工具串（L127）同步 G1。

#### G4. `browser-nodes/browser-task.ts`（现 112 行）

L73-81 完成后 observe + completeRun：AX 模式下 observation 体积大，落 `browserPayload.lastObservation`（L90）前裁剪为摘要（同 B4 的 step 落库策略），全量走 artifact。`resolveBaRunForBrowserTask`（resume-context）不受影响。

#### G5. 兼容性总结（任务点 3 之 workflow 部分）

- 协议兼容：types union 扩员、payload 字段全 optional、路由纯新增、DB 纯新表 → **旧 workflow 定义与历史 DB 零迁移**。
- 行为变更唯一风险点：代际校验开启后，复用旧 ref 的存量提示词会收到 `STALE_REF` → 灰度期 `generation` 缺省放行 + warn（B4 assertGeneration 已按此设计），G3 提示词同步上线后转强制（§八）。

---

### H. feature flag 与开关（任务点 5）

#### H1. `sto-plugin/sto-builtin-tools.manifest.json`（现 24 行）——孤儿确证与真源化

**确证**：全仓（含 electron/src/sto-plugin/tests）grep `sto-builtin-tools` / `builtin-tools.manifest` 零引用。**当前启用路径与 manifest 无关**，真实链路为：
1. 安装：`plugin-install.ts` `ensureAllBundledPluginsInstalledAsync` 的 pluginSpecs 列表（L1580-1595；sto-browser-automation 在 L1591、bridge 在 L1590）→ 拷贝到 openclaw config extensions + toolkit 嵌套（L828-847）；
2. 启用：`main/index.ts` L943-958 启动时调 `ensureStoBrowserBridgePluginInOpenClaw` / `ensureStoBrowserAutomationPluginInOpenClaw`（openclaw-auth.ts L1557-1569）写 openclaw.json 的 `plugins.allow/entries`；
3. 功能门：`feature-flag.ts` 挡 route（C1 现状 L31）、workflow 节点（browser-nodes/index.ts L21）、设计器节点库（designer-node-library.tsx L10、designer-edge.tsx L35-40）；
4. 同步安装列表（`ALL_BUNDLED_PLUGINS` L1443-1453）**只有 bridge 没有 automation**——异步路径才有，属现状不一致，一并修。

**改动**：manifest 补录 ba/bridge 并让安装列表消费它：

```jsonc
{
  "version": 2,
  "plugins": [
    { "id": "sto-workflow-tool", "localDir": "sto-workflow-tool", "sharedLibs": ["sto-toolkit"], "enabled": true, "tools": [/* 现状保留 */] },
    { "id": "sto-scheduled-task-tool", "localDir": "sto-scheduled-task-tool", "enabled": false, "tools": [] },
    { "id": "sto-browser-bridge", "localDir": "sto-browser-bridge", "sharedLibs": ["sto-toolkit"], "enabled": true,
      "tools": ["bridge_snapshot","bridge_click","bridge_fill","bridge_navigate","bridge_screenshot","bridge_list_sessions","bridge_read_page","bridge_print_pdf","bridge_group_tabs","bridge_cdp"] },
    { "id": "sto-browser-automation", "localDir": "sto-browser-automation", "sharedLibs": ["sto-toolkit"], "enabled": true,
      "tools": ["ba_create_session","ba_observe","ba_find","ba_act","ba_wait","ba_validate","ba_start_run","ba_read_page","ba_screenshot","ba_print_pdf","ba_network_capture","ba_cdp"] }
  ]
}
```

`plugin-install.ts` 的 pluginSpecs 改为从 manifest 读 `enabled`（读失败回退到现状硬编码列表）；用户总开关关闭时翻转 openclaw.json 对应 `entries.enabled=false`（复用 openclaw-auth.ts L434-439 的既有写法）。**待验证**：manifest 是否被构建/打包脚本消费（本仓 grep 未见，打包配置需在施工时复查，§十）。

#### H2. 用户总开关（P2-4）

- `electron/utils/store.ts`：`AppSettings`（L24）加 `browserAutomationLevel: 'off' | 'dom' | 'ax'`（默认 `'dom'`，默认值表 L107 附近同步）。
- A3 的 `getBrowserAutomationLevel()`：env 覆盖 > AppSettings > 环境默认。
- 设置页 UI：新增开关项（设置路由 `electron/api/routes/settings.ts` 走通用 settings 通道，无需新路由——**施工时确认 settings 路由的键白名单是否需登记**）。
- 关闭效果三联动：route 503（C1 既有 flag 门）+ 设计器隐藏节点（现状 flag 消费点不变）+ openclaw entries.enabled=false（H1）。

---

## 五、实施波次与依赖图

```
波次 0（地基，严格串行；每步依赖前步）
  A1 types ─→ B1 cdp-session ─→ B3 artifact-writer(+B11) ─→ C3 token ─→ C1 鉴权(warn 模式) ─→ E1 插件带 token
  说明：C1 与 E1 必须同版本发布；C3 先于 C1 合入。

波次 1（P0 剩余；互相并行，全部只依赖波次 0）
  ├─ B4 串行化 enqueue + 代际校验（灰度放行）     [依赖 A1/A2]
  ├─ B2 dialog-guard + B9 will-prevent-unload   [依赖 B1]
  ├─ B7 可见性守卫 assertElementActionable + D1 可见性上报   [D1 可先行]
  └─ A2 observe-script 加固（navEpoch/遮挡检测/dialog hooks/click probe）

波次 2（P1；B6 为关键路径，其余并行）
  关键路径：B6 ax-observer(PoC 先行) ─→ B5 observer 接线 ─→ B4 find ─→ E2 ba_find ─→ G1/G3
  并行线：
  ├─ B8 readyState + B10 network-recorder（B8 的 networkIdle 切换依赖 B10）
  ├─ B1 截图 clip + printToPdf ─→ B4 产物方法 ─→ E2 ba_screenshot/ba_print_pdf
  ├─ B4 read_page ─→ E2 ba_read_page
  ├─ B7 actClickWithFallback（依赖波次 1 的 A2 探针）
  └─ F1 claude ba_* MCP（依赖 E1 客户端提升，可与 B6 并行启动）

波次 3（P2；全部并行）
  ├─ B12 bridge 字段/版本配对/token 轮换 ─→ C4 ─→ E3/F2
  ├─ B9 ownership 显式化 + D1 视觉标记（embed 侧）
  ├─ H1 manifest 真源化 + H2 用户总开关
  ├─ A5/F3 cdp 白名单 ─→ C1 /cdp + B4 invokeCdp + E2 ba_cdp
  └─ 仓外扩展端：标签组 / 视觉标记 / 版本上报 / cdp 执行（协议按 A4/C4 冻结后开工）
```

**并行度结论**：ba 服务端线（B 系）、bridge/扩展协议线（C4/E3）、Claude 线（F 系）仅共享 A1/A4/A5 三个 shared 文件，波次 1 结束后三线可完全并行。

---

## 六、风险与坑（每条含规避方案）

| # | 风险 | 证据/机理 | 规避方案 |
|---|---|---|---|
| R1 | **`Accessibility.getFullAXTree` 在 Electron 40 上行为待验证**（尤其 embed webview guest 进程） | cdp-session 的 send 走 `webContents.debugger.sendCommand`（L42-46），依赖 Electron 转发该域 | 波次 2 第 1 步做最小 PoC（attach→getFullAXTree→getContentQuads）；不支持则 B6 回退"DOM 遍历 + ARIA 合成"伪 AX，接口签名不变，上层无感 |
| R2 | debugger 事件监听泄漏/串扰 | `webContents.debugger.on('message')` 是 webContents 级监听；多 cdp-session 并存 | B1 的 onCdpEvent/offCdpEvent 集中登记，detach 时全量摘除；单测覆盖 attach/detach 循环 |
| R3 | 无超时 send 堵死串行队列 | 现状 send 无超时（L42-46）；串行化（B4）后一个挂死的 Runtime.evaluate 堵死整会话 | B1 send 默认 30s 超时；串行化必须先于或与超时同版本上线，**不得单独上串行化** |
| R4 | 截图 clip 坐标系 / printToPDF 通道 | `Page.captureScreenshot` clip 为 page CSS px；`captureBeyondViewport` 在 Electron 不稳；`Page.printToPDF` 在 headful Chromium 不可靠 | clip 前 scrollIntoView + 坐标乘 devicePixelRatio×zoomFactor；printToPDF 走 `webContents.printToPDF()`（B1 已按此设计）；两条路径都留 fallback |
| R5 | webview dom-ready 前 attach 抛错 | Frame 注释明示 getWebContentsId 可早于 dom-ready（SclawBrowserFrame L283-284 注释）；requireDeps（service L311-344）拿到即用 | attach 包指数退避重试（≤3 次）；session-manager.resolveEmbedWebContents 后检查 `isLoadingMainFrame` 状态 |
| R6 | token 分发触发网关硬重启 | openclaw.json 写入被文件监听，历史 WS 1012 事故（openclaw-auth L233-236 注释） | 复用 `writeOpenClawJson` 的"内容不变不写"；token 只在首次创建时写一次；轮换（B12/C4）低频人工触发 |
| R7 | `route-utils.parseJsonBody` 全局共享 | L3-13 被 41 个路由共用 | 新增 maxBytes/timeoutMs 均为可选参数且默认行为不变；C1 新端点显式传上限 |
| R8 | AX 快照体积撑爆 SQLite | 现状 step 落库全量 `observationJson`（service L183）；AX 全树单条可达数百 KB | B4 改存摘要 + artifactId；repository 零结构变更（纯新表） |
| R9 | 提示词四处拷贝漂移 | OpenClaw `BA_SYSTEM_PROMPT`（E2 L30-37）、`BRIDGE_SYSTEM_PROMPT`（E3 L20-28）、Claude `BRIDGE_SYSTEM_PROMPT`（F2 L13-21）、`EMBED_BRIDGE_SYSTEM_PROMPT`（F2 L23-28） | 抽 shared 常量双端 import；单测断言提示词提及的工具名 ⊆ 注册表（§七 T9） |
| R10 | 旧插件撞上强制鉴权 | C1 强制 401 后，未带 token 的旧版插件全灭 | 灰度：先 warn-only（`STOCLAW_BA_AUTH_ENFORCE` 未开时）→ 一个发布周期后默认强制；401 文案含操作指引（E1） |
| R11 | Claude 引擎 browser 节点空引用 | agent-runner-claude L195 透传 ba_* 但 L203 无 mcpServers | F1 落地前在 executeBrowserNode 加明确报错（G2），杜绝静默失败 |
| R12 | embed/bridge 双通道行为分裂 | bridge 命令 embed 走 flush 直通（routes/browser-bridge L251-254 + 驱动 L74-148），扩展走轮询 | 新 action 在 embed 驱动显式实现或显式 unsupported；两端共享 A4 契约 |
| R13 | KEY_DEFS 小 bug | End keyCode=36（input L46）应为 35 | B7 顺手修，补单测 |

---

## 七、验证计划

### 7.1 现有测试基线（必须保持绿）

`tests/unit/`：`browser-automation-step1.test.ts`（flag/observe script/session id）、`browser-automation-input.test.ts`（fill 链）、`browser-bridge-service.test.ts`、`sto-browser-bridge-plugin.test.ts`、`claude-browser-tool.test.ts`、`browser-workflow-nodes.test.ts`、`browser-task-resume.test.ts`、`workflow-designer-browser-nodes.test.ts`。

### 7.2 每波次新增测试文件

| 波次 | 测试文件 | 覆盖点 |
|---|---|---|
| 0 | `browser-automation-cdp-session.test.ts` | send 超时（CDP_TIMEOUT）、stale 重建、事件注册/摘除、enableDomains 幂等 |
| 0 | `browser-automation-artifact-writer.test.ts` | tmp→rename 原子性、sha256 正确性、`wx` O_EXCL 冲突换名、artifactId 路径穿越拒绝 |
| 0 | `browser-automation-auth.test.ts` | **负例：无 token→401 UNAUTHORIZED；错 token→401；Host=evil.com→403 HOST_MISMATCH；非 loopback→403**；warn 灰度模式放行 |
| 1 | `browser-automation-generation.test.ts` | observe 后 generation 递增；act 带错 generation→**负例 STALE_REF**；灰度期缺省放行+warn；navEpoch 变化触发递增 |
| 1 | `browser-automation-dialog-guard.test.ts` | alert/confirm/prompt 三策略应答；beforeunload 补丁；**负例：10 次/5s 触发 DIALOG_STORM 且熔断后 act 被拒**；record-only 不接管 |
| 1 | `browser-automation-serialization.test.ts` | 同会话并发 act×10 顺序执行、互不交错；一棒失败不断链；跨会话不互斥 |
| 1 | `browser-automation-visibility.test.ts` | **负例：embed 不可见→PAGE_NOT_VISIBLE**；managed 最小化→拒；headless 标记豁免 |
| 2 | `browser-automation-ax-observer.test.ts` | mock AX 树：预算截断、三轮降级、collapsed 标记与 expandRefs 下钻、RefTable 分配/解析；**负例：域不支持→CDP_DOMAIN_UNSUPPORTED→DOM 回退** |
| 2 | `browser-automation-find.test.ts` | 文本命中静态节点→interactiveAncestorRef 上溯；interactiveOnly 过滤；maxResults 截断 |
| 2 | `browser-automation-read-page.test.ts` | 滚动收集去重、冻结检测提前终止（frozen=true）、页数/字符上限 truncated、artifact 落盘 |
| 2 | `browser-automation-click-fallback.test.ts` | JS 成功 via:'js'；遮挡→CDP 降级；**负例：探针未命中→CLICK_NOT_DELIVERED 且附 occluder** |
| 2 | `browser-automation-screenshot-pdf.test.ts` | clip 换算、format/quality 透传、artifact ref 完整字段 |
| 2 | `browser-automation-network-recorder.test.ts` | 条数/字节上限、body 截断、inflightCount 与 networkIdle 联动 |
| 2 | `claude-browser-automation-mcp.test.ts` | ba_* MCP 工具面与 OpenClaw 侧 schema 等价性（参数名/必填性快照对比） |
| 3 | `browser-bridge-versioning.test.ts` | **负例：major 不符→BRIDGE_VERSION_MISMATCH**；minor 差→updateAvailable 放行；token 轮换 grace |
| 3 | `browser-automation-cdp-allowlist.test.ts` | 表内方法放行、表外→**CDP_METHOD_NOT_ALLOWED**；每方法超时值 |
| 3 | `browser-automation-master-switch.test.ts` | level off→route 503 + 设计器节点隐藏 + openclaw entries 翻写（mock） |
| 全程 | `sto-browser-prompts-sync.test.ts`（T9） | 四处提示词提及的工具名 ⊆ 各自注册表；两份 BRIDGE_SYSTEM_PROMPT 逐字相等（抽 shared 后改为单源断言） |

### 7.3 手工/集成验证清单

- Electron 实机：embed webview 上跑通 observe(ax)→find→act(click 降级)→read_page→screenshot(clip)→print_pdf 全链；managed 离屏窗口重跑一遍。
- 双引擎：同一任务分别用 openclaw 会话与 claude 会话执行，工具面行为一致。
- workflow：含 browser_task 的存量定义在灰度期（generation 缺省放行）零回归；强制期新模板走通 STALE_REF 自愈提示。

---

## 八、上线与灰度

1. **feature flag 分级**（A3）：`STOCLAW_BROWSER_AUTOMATION = off | dom | ax`。production 默认 `dom`（等价现状），非 production 默认 `ax`。`ax` 异常时单会话自动回退 dom（B4 observe 内）并打 warn，不需要全局降档。
2. **鉴权灰度**（C1/R10）：token 校验代码随波次 0 上线但默认 warn-only；`STOCLAW_BA_AUTH_ENFORCE=1` 或次版本默认强制。发布注记必须写明插件与主程序需同版本。
3. **代际校验灰度**（B4/G5）：`generation` 缺省先放行+warn 一个周期；G3 提示词上线后转强制。
4. **manifest 真源化**（H1）：plugin-install 读 manifest.enabled，读失败回退硬编码列表；同步补齐 ALL_BUNDLED_PLUGINS 缺 automation 的现状不一致（L1443-1453）。
5. **用户总开关**（H2）：设置页新增"浏览器自动化"三级开关（关/DOM 模式/AX 模式）；关闭即 route 503 + 设计器隐藏 + openclaw entries.enabled=false 三联动。
6. **产物留存策略**：`browser-artifacts/` 目录按 7 天滚动清理（随 B3 落一个 janitor，挂在 app 启动既有清理节奏上——施工时确认既有清理任务挂点）。

---

## 九、用户使用方式

### 9.1 内嵌浏览器路径（应用广场 webview，零安装）

1. 用户在应用广场打开任意应用，左侧出现内嵌 webview 预览（现有 SclawBrowser 抽屉）。
2. 用户直接说"帮我登录并下载上月的对账单"。Agent 侧：`ba_observe(embed-<runtimeId>)` 拿到 @e 元素面 → `ba_find({text:"对账"})` 定位 → `ba_act click/fill`（带 documentGeneration，CDP 真实输入）→ 每步后 300ms 自动快照。
3. 过程可视化：被驱动的 webview 出现"自动操作中"描边角标（P2-3）；JS 弹窗被自动接管并记录（用户可在会话详情看到 dialog 记录）。
4. 产物交付：截图/PDF 落在本机 `browser-artifacts/`，对话中返回路径 + sha256，用户点击即可打开。

### 9.2 真实 Chrome 扩展路径（已登录态标签页）

1. 用户安装 StoClaw Browser Bridge 扩展（设置页提供 zip 下载，routes L115-140 现成），输入配对码完成配对（或 auto-connect）。
2. 扩展上报版本号，服务端比对提示升级（C4）；用户说"在我打开的飞书文档里翻到第三章"，bridge_* 选中该 tab（borrowed 语义，不会被关闭）。
3. 任务执行期间，相关 tab 被打上任务标签组 + 视觉标记（P2-2/P2-3，依赖仓外扩展版本）；用户随时可在设置页一键关停全部浏览器自动化（H2 总开关），关停即吊销 token（B12 轮换）。

### 9.3 workflow 节点路径（无人值守）

1. 设计器中拖入 browser_task 节点（flag 开启才可见，现状 L10），配置 goal + 起始 url 或继承上游会话。
2. 运行时引擎按提示词循环 ba_observe→ba_act（带代际）→ba_validate；每步 checkpoint 落 ba_step_run（摘要式 observationJson，不再撑库）；失败可从断点恢复（resume-context 现状保留）。
3. 节点产物（截图/PDF/抓包）以 artifactId 进入 workflow artifact 体系，供下游节点引用；浏览器节点暂不支持产物类工具直出（G1 白名单刻意收紧）。

---

## 十、未验证项与开放问题（诚实声明）

1. **仓外 Chrome 扩展源码缺失**：本仓无 `browser-extension/`（`browser-bridge-extension.ts` 仅做 zip 解析）。服务端协议已冻结。扩展仓施工单见 **`docs/browser-bridge-extension-plan.md`**。
2. **AX 域在 Electron 40 的实测**：`Accessibility.getFullAXTree` / `DOM.getContentQuads` 经 `webContents.debugger.sendCommand` 在 embed webview（guest 进程）与 managed 窗口上的可用性、性能（60k 节点耗时）未经运行验证（本次为只读分析，未启动应用）。R1 已排 PoC 与回退路径。
3. **manifest 构建期消费**：启动安装 `ensureAllBundledPluginsInstalledAsync` 已读 `sto-plugin/sto-builtin-tools.manifest.json`（`enabled:false` 的条目从异步安装列表剔除；未登记插件如 WeCom 仍走硬编码回退）。`scripts/after-pack.cjs` 的 `BUNDLED_PLUGINS` 仍是打包真源，不读该 manifest。
4. **DB 迁移登记点**：ba_artifact 新表的迁移文件登记位置需按本仓 db 迁移体系确认（repository 改动本身已限定为纯增量）。
5. **settings 路由键白名单**：H2 总开关经通用 settings 通道下发，是否需在 `routes/settings.ts` 登记新键，施工时确认。
6. **开放问题（需产品决策）**：
   - dialog 默认策略取 `auto-dismiss`（保守）还是 `auto-accept`（Kimi 行为对齐度更高但风险大）？本计划默认 auto-dismiss。
   - `ba_cdp` 白名单初始集合（A5）是否过窄？扩表流程需要评审约定。
   - AX 模式稳定后，DOM 注入观察是否保留为长期 fallback（建议保留一个大版本后下线）。

---

*本文档基于 2026-09-03 的仓库快照只读精读产出；施工前请 rebase 到最新主干并重核 §二 的行号锚点。*