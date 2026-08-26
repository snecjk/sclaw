# SClaw JSBridge 调用文档

`@sto/claw-bridge-sdk` 官方调用文档 · 协议 `stoclaw-bridge/v1` · SDK 包版本 `1.1.0`

---

## 1. 概述

JSBridge 供 **嵌入 SClaw 客户端 webview 的 H5 页面** 调用宿主能力，例如：读取 SSO 用户信息、弹出统一 UI、跳转应用/路由、与 SClaw AI 联动等。

**典型场景**：应用广场（App Plaza）内打开的 `*.sto.cn` 业务页面。

### 能力域一览

| 域 | method | 状态 |
|----|--------|------|
| Bridge 元信息 | `bridge.ping` · `bridge.getCapabilities` · `app.getInfo` | ✅ |
| 用户与鉴权 | `user.getInfo` · `auth.getUser` · `auth.getAuthMode` · `auth.getToken` · `auth.requestLogin` | ✅（`requestLogin` 固定拒绝） |
| 导航 | `nav.jump` · `nav.openTab` · `nav.openApp` · `nav.openExternal` · `nav.goBack` · `nav.reload` · `nav.closeSelf` | ✅ |
| UI | `ui.toast` · `ui.alert` · `ui.confirm` · `ui.openDrawer` | ✅ |
| 会话联动 | `chat.togglePanel` · `chat.fillComposer` · `chat.openSession` · `chat.sendMessage` | ✅ |
| AI 引擎直连 | `chat.complete` · `chat.cancel` | ✅ |
| Storage | `storage.get` · `storage.set` · `storage.remove` · `storage.clear` | ✅ |
| 网络代理 | `host.fetch` | ⏳ 预留，未实现 |
| AI 流式 | `chat.invokeAgent` + `chat:stream` 事件 | ⏳ 预留，未实现 |

```
H5 页面 (Guest)
    ↓ window.stoClaw.call(method, params)
Guest Preload
    ↓ ipcRenderer.sendToHost
Host Renderer（SClaw UI）
    ↓ IPC bridge:invoke
Main Process（鉴权 / 分发）
    ↓ 部分能力需 Host 二次执行（弹窗、会话回填等）
返回 Promise 结果
```

### 通信载荷：不只 Text，还有 JSON 与文件

Guest ↔ Host ↔ Main 之间走 **JSON 结构化信封**（`BridgeRequest` / `BridgeResponse` / `BridgeEvent`）。`params` 与 `data` 必须是 **可 JSON 序列化** 的值；原生 `File` / `Blob` / `ArrayBuffer` **不能**直接作为参数传递。

| 载荷类型 | 典型字段 | 适用 API | 说明 |
|----------|----------|----------|------|
| **Text** | `text`、`prompt`、`message` | `chat.fillComposer` · `chat.sendMessage` · `chat.complete` | 纯字符串；UI 联动路径仅支持 text |
| **JSON 对象** | `params` / `context` / `value` | `storage.set/get` · `chat.complete` | 结构化业务数据、配置、列表、表单快照 |
| **JSON 响应** | `parsed` | `chat.complete`（`responseFormat: 'json'`） | 宿主尝试解析模型输出为 JSON |
| **文件（间接）** | `attachments` · `encoding: 'base64'` · `url` | `chat.complete` 的 `context` · `storage.set` | 见下文「文件传递模式」 |

**文件传递模式（当前版本）**

JSBridge **尚无**独立的 `bridge.file.upload` / `bridge.file.download` API。文件类数据请用以下方式：

1. **结构化引用（推荐）**：在 `context` 或 `storage` 中传 `{ name, url, mimeType, size }`，指向业务系统已有的 `*.sto.cn` 下载地址或附件 ID，由 Agent 或后续 `host.fetch`（预留）处理。
2. **小文件 Base64**：将文件读为 Base64 字符串放入 `context`（须控制总大小，见下表）。
3. **持久化元数据**：用 `storage.set` 保存附件列表、草稿、解析中间结果等 JSON，跨页面刷新仍可读取。

| 场景 | 建议上限 | 超限行为 |
|------|----------|----------|
| `chat.complete` 的 `context` 序列化大小 | **128 KiB** | `AI_CONTEXT_TOO_LARGE`，不静默截断 |
| `storage` 单值 | 受 electron-store / 磁盘约束，建议 **< 1 MiB** | 写入失败或性能下降 |
| UI 联动 `sendMessage` / `fillComposer` | 仅 **text 字符串** | 大段数据请改走 `chat.complete` 的 `context` |

```typescript
// ① JSON 业务数据 → AI
await stoClaw.complete({
  prompt: '根据以下订单 JSON 给出改价建议',
  context: {
    orderId: 'SO-2026-001',
    lines: [{ sku: 'A1', qty: 10, price: 99.5 }],
    currency: 'CNY',
  },
  responseFormat: 'json',
});

// ② 文件：URL 引用（推荐）
await stoClaw.complete({
  prompt: '解析附件中的异常明细',
  context: {
    attachments: [{
      name: 'exceptions.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      url: 'https://ops.sto.cn/files/exceptions.xlsx',
      size: 48291,
    }],
  },
});

// ③ 文件：小体积 Base64（注意 128 KiB 总 context 上限）
const base64 = await fileToBase64(smallFile);
await stoClaw.complete({
  prompt: '提取图片中的表格字段',
  context: {
    file: { name: smallFile.name, mimeType: smallFile.type, encoding: 'base64', data: base64 },
  },
});

// ④ JSON 持久化（Storage）
await stoClaw.call('storage.set', {
  key: 'quote-draft',
  value: { rows: selectedRows, updatedAt: Date.now() },
});
const { value } = await stoClaw.call('storage.get', { key: 'quote-draft' });

// ⑤ 结构化 AI 输出
const { parsed, text, parseError } = await stoClaw.complete({
  prompt: '返回 JSON：{ "suggestions": string[], "riskLevel": "low"|"medium"|"high" }',
  responseFormat: 'json',
});
if (parseError) console.warn('JSON 解析失败，fallback text:', text);
else console.log(parsed);
```

> **预留**：`host.fetch` 实现后可用于宿主代发 HTTP / 拉取 `*.sto.cn` 资源；`chat.invokeAgent` 流式事件的 `delta` 仍为 text，结构化结果在 `done` 或 `responseFormat: 'json'` 终态中交付。

---

## 2. 环境要求

| 条件 | 说明 |
|------|------|
| 运行环境 | 必须在 **SClaw 桌面客户端** 的 webview 内 |
| 页面域名 | 必须是 **`*.sto.cn`**（含 `sto.cn` 根域） |
| Bridge 注入 | 客户端自动注入 `window.stoClaw` |
| 用户登录 | 读取用户信息、Token 等需 SClaw 已 SSO 登录 |

非 `*.sto.cn` 页面可正常浏览，但 **不会建立 Bridge 会话**，调用会失败。

---

## 3. 安装与引入

### 推荐：使用 SDK

```bash
snpm install @sto/claw-bridge-sdk
# 或
npm install @sto/claw-bridge-sdk --registry=http://snpm-registry.sto.cn
```

```typescript
import { stoClaw, isStoClawBridgeAvailable } from '@sto/claw-bridge-sdk';

if (!isStoClawBridgeAvailable()) {
  // 不在 SClaw 内，降级处理
  return;
}

await stoClaw.ping();
```

### 原生调用（不装 SDK）

```typescript
// 检测
if (window.stoClaw?.call) {
  const result = await window.stoClaw.call('user.getInfo');
}

// 带参数
await window.stoClaw.call('chat.fillComposer', {
  text: '请分析当前页面',
  target: 'embed',
});

// 可选：超时与用户手势标记
await window.stoClaw.call('ui.confirm', { message: '确认提交？' }, {
  timeoutMs: 30_000,
  userGesture: true,
});
```

SDK 方法名与底层 `method` 一一对应，见下文 API 详表。

---

## 4. 快速示例

### 获取用户信息

```typescript
const user = await stoClaw.getUserInfo();
// user.userId, user.realName, user.empCode, user.companyName ...
```

### 回填右侧 AI 会话（应用广场 embed 面板）

```typescript
await stoClaw.fillComposer({
  text: '请帮我分析这张报表的关键指标',
  target: 'embed',   // 应用广场 webview 右侧 AI 面板
  openPanel: true,   // 先打开右侧面板（默认 true）
});
```

### 回填主会话（首页左侧对话框）

```typescript
await stoClaw.fillComposer({
  text: '汇总今日异常件量',
  target: 'main',
});
```

### 新建会话并预填

```typescript
await stoClaw.openSession({
  target: 'embed',
  text: '开始新的分析任务',
  title: '报表分析',
  send: false,
});
```

### 统一确认框

```typescript
const { confirmed } = await stoClaw.confirm({
  title: '确认操作',
  message: '是否继续提交？',
  confirmLabel: '提交',
  cancelLabel: '取消',
});
```

### 跳转到其他应用

```typescript
await stoClaw.jump({
  type: 'app',
  appId: 'your-app-id',
  title: '目标应用',
});
```

### Headless AI（不打开右栏，直接拿结果）

适用于页面内嵌逻辑、选中行分析、表单建议等「像调 API 一样要 AI 输出」的场景。

**前置**：应用已配置 AI Profile（`bridgePolicy.ai.enabled = true`）；首次调用需用户 Consent。调用前用 `bridge.getCapabilities` 确认列表含 `chat.complete`。

```typescript
const result = await stoClaw.complete({
  prompt: '分析以下报价数据并给出改价建议',
  context: { rows: selectedRows },
  conversationId: 'quote-1',
  responseFormat: 'json',
});

console.log(result.text);
if (result.parsed) console.log(result.parsed);

await stoClaw.cancel({ requestId: result.requestId });
```

> 会话在宿主侧使用独立 `bridge-ai` sessionKey，**不会出现在左侧主会话列表**。`complete()` 默认 `timeoutMs = 120_000`，并自动把 Bridge IPC 超时设为 `timeoutMs + 5s`。

---

## 5. 能力分级与权限

Bridge 按应用信任等级（`trustTier`）授予不同能力，可通过 `app.getInfo` 或 `bridge.getCapabilities` 查询当前页面可用能力。

| trustTier | 场景 | 典型能力 |
|-----------|------|----------|
| `catalog` | 应用广场已绑定 catalog 应用 | 用户、UI、导航、会话、Storage 等（默认最全） |
| `external` | 有 appId 但未绑定 | 仅 ping、app 信息、auth.getUser、toast |
| `internal` | 内部应用（`__xxx__` 形式 appId） | 全部能力 |
| `untrusted` | 无 appId | 仅 ping、getCapabilities、app.getInfo |

### AI Profile 门禁（`chat.complete` / `chat.cancel`）

AI 直连能力与 trustTier **独立**：即使 `internal` 等级默认可授予 capability，仍须在应用配置中设置 `bridgePolicy.ai.enabled = true`。未开启时调用返回 `AI_NOT_ENABLED`（与 `CAPABILITY_DENIED` 区分）。

`bridge.getCapabilities` 在 Profile 未开启时 **不会** 列出 `chat.complete` / `chat.cancel` / `chat.invokeAgent`。

### 需用户授权的能力

以下能力首次调用时可能弹出授权确认（`USER_CONSENT_REQUIRED`）：

- `auth.getToken`
- `nav.openExternal`
- `host.fetch`（预留）
- `chat.sendMessage`
- `chat.complete`
- `chat.invokeAgent`（预留）

`chat.cancel` **不需要** Consent（仅取消调用方自己发起的运行）。

### 预留能力

| method | 状态 |
|--------|------|
| `host.fetch` | 清单已登记，Handler **未实现**；规划用于宿主代发 HTTP / 拉取受控资源 |
| `chat.invokeAgent` | 清单已登记，Handler **未实现**；规划为流式 AI + `chat:stream` 事件 |

---

## 6. API 参考

### 6.1 Bridge 元信息

#### `bridge.ping`

检测 Bridge 连通性。

```typescript
// SDK
await stoClaw.ping();
// 原生
await window.stoClaw.call('bridge.ping');
```

**返回**

```typescript
{ pong: true; timestamp: number }
```

---

#### `bridge.getCapabilities`

获取当前会话已授权的能力列表。

```typescript
const { capabilities } = await window.stoClaw.call('bridge.getCapabilities');
// capabilities: string[]
```

---

#### `app.getInfo`

获取当前 webview 绑定的应用上下文。

**返回**

```typescript
{
  appId: string | null;      // 应用 ID，未绑定时为 null
  trustTier: string;         // catalog | external | internal | untrusted
  origin: string | null;     // 当前页面 origin
  runtimeId: string | null;  // embed runtime 标识
}
```

---

### 6.2 用户与鉴权

#### `user.getInfo` / `auth.getUser`

获取当前 SSO 用户信息（**不含 Token**）。两者等价，推荐 `user.getInfo`。

**前置**：用户已登录，否则 `AUTH_REQUIRED`。

**返回**

```typescript
{
  userId: string;
  userName: string;
  realName: string;
  empCode: string;
  companyCode: string;
  companyName: string;
  departmentCode: string;
  departmentName: string;
  categoryCode: string;
  isAdministrator: boolean;
}
```

```typescript
const user = await stoClaw.getUserInfo();
```

---

#### `auth.getAuthMode`

获取登录态与认证模式。

**返回**

```typescript
{
  loggedIn: boolean;
  authMode: 'native-hq' | 'native-site' | 'hq-demo-as-site' | null;
  ssoEnvironment: string;
}
```

---

#### `auth.getToken`

获取 SSO Token（**高风险**，需用户授权）。

**返回**

```typescript
{ token: string }
```

---

#### `auth.requestLogin`

当前 **不支持** 从 H5 触发登录，固定返回 `PERMISSION_DENIED`。请引导用户在 SClaw 客户端完成登录。

---

### 6.3 统一 UI

#### `ui.toast`

宿主 Toast 提示。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | `string` | 是 | 提示文案 |
| `level` | `'info' \| 'success' \| 'warning' \| 'error'` | 否 | 默认 `info` |

**返回** `{ ok: true }`

```typescript
await stoClaw.toast({ message: '保存成功', level: 'success' });
```

---

#### `ui.alert`

宿主模态提示框（需用户点击确认）。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | `string` | 是 | 正文 |
| `title` | `string` | 否 | 标题，默认「提示」 |
| `confirmLabel` | `string` | 否 | 确认按钮文案 |

**返回** `{ ok: true }`

```typescript
await stoClaw.alert({ title: '提示', message: '操作已完成' });
```

---

#### `ui.confirm`

宿主确认框。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | `string` | 是 | 正文 |
| `title` | `string` | 否 | 标题，默认「确认」 |
| `confirmLabel` | `string` | 否 | 确认按钮 |
| `cancelLabel` | `string` | 否 | 取消按钮 |
| `destructive` | `boolean` | 否 | 危险操作样式 |

**返回**

```typescript
{ confirmed: boolean }
```

```typescript
const { confirmed } = await stoClaw.confirm({
  message: '确定删除这条记录吗？',
  destructive: true,
});
```

---

#### `ui.openDrawer`

打开宿主抽屉面板。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | `'chat'` | 否 | 当前仅支持 `chat`（应用广场右侧 AI 面板） |

```typescript
await stoClaw.openDrawer({ kind: 'chat' });
```

---

### 6.4 导航

#### `nav.jump`（推荐）

统一跳转入口。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `'webview' \| 'app' \| 'route' \| 'external'` | 是 | 跳转类型 |
| `url` | `string` | 视 type | webview / external 时必填 |
| `appId` | `string` | 视 type | `type=app` 时必填 |
| `route` | `string` | 视 type | `type=route` 时必填，Claw 内路由 path |
| `title` | `string` | 否 |  tab / 应用标题 |

**type 说明**

| type | 行为 |
|------|------|
| `webview` | 在应用广场打开新 tab，**仅允许 `*.sto.cn` URL** |
| `app` | 按 `appId` 打开 catalog / 我的应用 |
| `route` | 跳转 SClaw 内部路由（如 `/settings`） |
| `external` | 系统默认浏览器打开 URL |

```typescript
// 打开 sto.cn 页面
await stoClaw.jump({ type: 'webview', url: 'https://example.sto.cn/page', title: '报表' });

// 打开 Claw 应用
await stoClaw.jump({ type: 'app', appId: 'my-app-id' });

// 打开 Claw 设置页
await stoClaw.jump({ type: 'route', route: '/settings' });

// 外部浏览器
await stoClaw.jump({ type: 'external', url: 'https://docs.example.com' });
```

---

#### `nav.openTab`

在应用广场打开新 tab（等价于 `nav.jump({ type: 'webview' })`）。

**参数** `{ url: string; title?: string }` — URL 必须是 `*.sto.cn`。

```typescript
await stoClaw.openWebview({ url: 'https://ops.sto.cn/dashboard', title: '运营看板' });
```

---

#### `nav.openApp`

按 appId 打开应用（等价于 `nav.jump({ type: 'app' })`）。

```typescript
await stoClaw.openApp({ appId: 'my-app-id', title: '我的应用' });
```

---

#### `nav.openExternal`

系统浏览器打开 URL（需用户授权）。

**参数** `{ url: string }`

---

#### `nav.goBack` / `nav.reload` / `nav.closeSelf`

| 方法 | 说明 |
|------|------|
| `nav.goBack` | 当前 webview 后退，返回 `{ ok: true, canGoBack: boolean }` |
| `nav.reload` | 刷新当前 webview |
| `nav.closeSelf` | 关闭当前 embed tab |

---

### 6.5 会话联动（UI · 以 Text 为主）

以下能力通过 Host Renderer 打开/操作 **可见的 Chat 面板**。参数中的 **`text` 为纯字符串**；结构化数据或文件请改用 §6.6 `chat.complete` 的 `context`，或在 text 中嵌入简短摘要 + 引导用户查看右栏。

#### `chat.fillComposer`

向 AI 会话输入框回填文本。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | `string` | 是 | 回填内容 |
| `target` | `'embed' \| 'main' \| 'auto'` | 否 | 默认 `auto` |
| `send` | `boolean` | 否 | `true` 时回填后立即发送 |
| `openPanel` | `boolean` | 否 | embed 目标时是否先打开右侧面板，默认 `true` |

**target 说明**

| 值 | 目标 |
|----|------|
| `embed` | 应用广场 webview **右侧** AI 会话面板 |
| `main` | 首页 / 主界面 **左侧** 主会话对话框 |
| `auto` | 来自 embed webview 时填右侧，否则填主会话 |

```typescript
await stoClaw.fillComposer({
  text: '分析当前页面的异常数据',
  target: 'embed',
  openPanel: true,
});
```

---

#### `chat.openSession`

新建会话并可选预填 / 发送。

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `target` | `'embed' \| 'main'` | 否 | 默认 `embed` |
| `text` | `string` | 否 | 预填内容 |
| `send` | `boolean` | 否 | 是否立即发送 |
| `title` | `string` | 否 | 会话标题 |

```typescript
await stoClaw.openSession({
  target: 'main',
  text: '帮我写一份周报提纲',
  title: '周报助手',
});
```

---

#### `chat.sendMessage`

回填并立即发送（等价于 `chat.fillComposer` + `send: true`）。**需用户授权**。

```typescript
await stoClaw.sendMessage({
  text: '开始执行',
  target: 'embed',
});
```

---

#### `chat.togglePanel`

切换应用广场右侧 AI 面板显隐。

**返回** `{ ok: true }`

```typescript
await stoClaw.toggleChatPanel();
```

---

### 6.6 AI 引擎直连（Headless · Text + JSON Context）

不打开右栏 UI，在 Main 进程 headless 调用 Agent。支持 **Text prompt** + **JSON context** 入参，以及 **Text / JSON** 两种响应形态。

**前置**：`bridgePolicy.ai.enabled = true`；`bridge.getCapabilities` 含 `chat.complete`；首次调用需 Consent。

#### `chat.complete`

**参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | `string` | 是 | 用户意图 / 指令（Text） |
| `context` | `unknown`（JSON 可序列化） | 否 | 结构化业务数据、附件元数据、小文件 Base64 等；**整包 ≤ 128 KiB** |
| `agentId` | `string` | 否 | 覆盖 Profile 默认 Agent |
| `skillSlugs` | `string[]` | 否 | 在 Profile 白名单内追加技能 |
| `responseFormat` | `'text' \| 'json'` | 否 | 默认 `text`；`json` 时宿主解析输出到 `parsed` |
| `conversationId` | `string` | 否 | 多轮复用；省略则单次会话 |
| `timeoutMs` | `number` | 建议 | 默认 120_000，最大 180_000；**务必同时增大 `call` 的 options.timeoutMs** |

**返回**

```typescript
{
  requestId: string;
  runId: string | null;
  text: string;              // 模型原始文本输出
  parsed?: unknown;          // responseFormat='json' 且解析成功
  parseError?: string;       // JSON 解析失败原因
  finishReason: 'completed' | 'timeout' | 'aborted' | 'failed';
}
```

```typescript
const result = await stoClaw.complete(
  {
    prompt: '汇总以下 JSON 并给出风险等级',
    context: { metrics: { revenue: 1.2e6, churn: 0.03 } },
    responseFormat: 'json',
  },
  { timeoutMs: 130_000 }, // 可选：覆盖默认 IPC 超时（默认 = params.timeoutMs + 5s）
);
```

#### `chat.cancel`

取消进行中的 `chat.complete`（或未来 `chat.invokeAgent`）调用。

**参数** `{ requestId: string }`（来自 `chat.complete` 返回）  
**返回** `{ ok: boolean }`  
**Consent**：不需要。

---

### 6.7 Storage（Bridge 隔离存储 · JSON KV）

按 `appId`（+ 非 catalog 时 `sessionId`）隔离的键值存储，不会污染页面 `localStorage`。`value` 为 **任意 JSON 可序列化对象**（含嵌套对象、数组、字符串、数字、布尔、null）；**不支持**直接存 `File` / `Blob`，文件请存元数据或 Base64 字符串。

#### `storage.get`

**参数** `{ key: string }`  
**返回** `{ value: unknown }`

#### `storage.set`

**参数** `{ key: string; value: unknown }`  
**返回** `{ ok: true }`

#### `storage.remove`

**参数** `{ key: string }`  
**返回** `{ ok: true }`

#### `storage.clear`

清空当前会话存储。  
**返回** `{ ok: true }`

```typescript
await window.stoClaw.call('storage.set', { key: 'draft', value: { foo: 1 } });
const { value } = await window.stoClaw.call('storage.get', { key: 'draft' });
```

---

## 7. SDK 方法速查

| SDK 方法 | 底层 method | 说明 |
|----------|-------------|------|
| `ping()` | `bridge.ping` | 连通性检测 |
| `getCapabilities()` | `bridge.getCapabilities` | 已授权能力 |
| `getAppInfo()` | `app.getInfo` | 应用上下文 |
| `getUserInfo()` | `user.getInfo` | SSO 用户信息 |
| `getAuthMode()` | `auth.getAuthMode` | 登录态 |
| `toast()` | `ui.toast` | Toast |
| `alert()` | `ui.alert` | 提示框 |
| `confirm()` | `ui.confirm` | 确认框 |
| `openDrawer()` | `ui.openDrawer` | 打开 AI 抽屉 |
| `jump()` | `nav.jump` | 统一跳转 |
| `openWebview()` | `nav.openTab` | 打开 sto.cn tab |
| `openApp()` | `nav.openApp` | 打开应用 |
| `fillComposer()` | `chat.fillComposer` | 回填输入框 |
| `openSession()` | `chat.openSession` | 新建会话 |
| `sendMessage()` | `chat.sendMessage` | 回填并发送 |
| `toggleChatPanel()` | `chat.togglePanel` | 切换 AI 面板 |
| `complete()` | `chat.complete` | Headless AI（Text + JSON context → Text/JSON） |
| `cancel()` | `chat.cancel` | 取消 AI 调用 |
| `call('storage.*', …)` | `storage.*` | JSON KV 读写 |
| `call(method, params)` | 任意 | 底层调用 |
| `subscribe(events)` | `bridge.subscribe` | 向宿主注册关心的事件（必须先注册才会推送） |
| `unsubscribe(events?)` | `bridge.unsubscribe` | 取消注册；不传则清空 |
| `on(event, handler)` | — | 本地监听推送（配合 subscribe） |
| `addListener(event, handler)` | `bridge.subscribe` + `on` | 推荐：注册 + 监听 + 一键 cleanup |
| `isStoClawBridgeAvailable()` | — | 环境检测（静态） |

### 宿主 → 页面事件（主动注册）

SClaw **不会**无差别推送给所有 webview。业务页需先 `subscribe` / `addListener`，宿主才会 `emit`。

```typescript
import {
  stoClaw,
  BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH,
  BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE,
} from '@sto/claw-bridge-sdk';

// 推荐：一步注册 + 监听
const off = await stoClaw.addListener(BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH, (payload) => {
  const { ossKey, mode, url } = payload as { ossKey: string; mode?: string; url?: string };
  // 同页刷新 clawQuotation（勿依赖 location.reload）
});

// 卸载
off();
```

或手动两步：

```typescript
await stoClaw.subscribe([
  BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH,
  BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE,
]);

stoClaw.on(BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE, ({ pass, ossKey }) => {
  if (!pass) return;
  // ...
});
```

| 事件名 | 说明 | payload 示例 |
|--------|------|----------------|
| `quote:preview-refresh` | SClaw 打开/刷新报价确认页 | `{ ossKey, phase, mode, url }` |
| `quote:validation-complete` | 校验结果到达 | `{ ossKey, pass, errorCount?, phase }` |
| `bridge:session-destroyed` | Bridge 会话销毁（生命周期，无需 subscribe） | `{ reason? }` |

catalog 应用默认允许订阅 `quote:*`；其它事件需在应用 `bridgePolicy.allowedEventPatterns` 中配置。

---

## 8. 错误码

调用失败时 Promise reject，SDK 会包装为 `StoClawBridgeError`（含 `code` 字段）。

| code | 含义 | 处理建议 |
|------|------|----------|
| `BRIDGE_UNAVAILABLE` | 不在 SClaw 或未注入 bridge | 降级为普通 H5 |
| `ORIGIN_DENIED` | 非 `*.sto.cn` 或 URL 不允许 | 检查域名 / 跳转 URL |
| `AUTH_REQUIRED` | 未登录 | 引导用户在 SClaw 登录 |
| `CAPABILITY_DENIED` | 当前应用无此能力 | 检查 trustTier / 联系应用配置 |
| `USER_CONSENT_REQUIRED` | 需用户授权 | 提示用户确认 |
| `USER_CONSENT_DENIED` | 用户拒绝授权 | 降级或提示 |
| `INVALID_PARAMS` | 参数错误 | 检查必填字段 |
| `METHOD_NOT_FOUND` | 方法不存在 | 检查 method 名称 |
| `RATE_LIMITED` | 调用频率超限 | 降低调用频率 |
| `REQUEST_TIMEOUT` | 超时 | 增大 `timeoutMs` 或重试 |
| `INTERNAL_ERROR` | 宿主内部错误 | 联系 SClaw 维护方 |
| `AI_NOT_ENABLED` | 应用未开启 AI Profile | 联系 SClaw 配置 `bridgePolicy.ai.enabled` |
| `AI_INVALID_PARAMS` | AI 参数不合法 | 检查 `prompt` / `requestId` 等 |
| `AI_CONTEXT_TOO_LARGE` | `context` 超过 128 KiB | 裁剪 JSON、改用 URL 引用大文件 |
| `AI_SKILL_NOT_ALLOWED` | 请求的技能不在白名单 | 检查 Profile `allowedSkillSlugs` |
| `AI_QUOTA_EXCEEDED` | AI 配额超限 | 降低调用频率 |
| `AI_CONCURRENCY_EXCEEDED` | 并发 AI 调用过多 | 排队或取消进行中的调用 |
| `AI_TIMEOUT` | Agent 运行超时 | 增大 `timeoutMs` 或简化任务 |
| `AI_ABORTED` | 调用被取消 | 正常终态 |
| `AI_RUN_FAILED` | Agent 运行失败 | 查看 `finishReason` / 重试 |

```typescript
import { stoClaw, StoClawBridgeError } from '@sto/claw-bridge-sdk';

try {
  await stoClaw.getUserInfo();
} catch (err) {
  if (err instanceof StoClawBridgeError && err.code === 'AUTH_REQUIRED') {
    // 未登录
  }
}
```

---

## 9. 最佳实践

1. **先检测再调用**：使用 `isStoClawBridgeAvailable()`，非 SClaw 环境走 H5 降级逻辑。
2. **不要假设 Token 可用**：`auth.getToken` 需授权，一般业务用 `getUserInfo()` 即可。
3. **跳转 URL 限制**：webview 内仅 `*.sto.cn`；外部链接用 `type: 'external'`。
4. **会话 target 选对**：embed 页面操作右侧 AI 用 `target: 'embed'`；影响主界面用 `target: 'main'`。
5. **避免高频调用**：untrusted 等级限流 20 次/分钟，catalog 为 120 次/分钟。
6. **用户手势**：敏感操作（确认框、发送消息）建议在点击事件回调中调用，可传 `{ userGesture: true }`。
7. **结构化数据走 JSON**：表格行、表单、配置用 `chat.complete` 的 `context` 或 `storage.set`，不要拼进超长 `text`。
8. **大文件不要用 Base64 硬塞 context**：优先 URL / 附件 ID；小文件注意 **128 KiB** 上限；独立文件 API 尚未提供。
9. **要结构化 AI 输出**：设 `responseFormat: 'json'`，成功读 `parsed`，失败 fallback `text` + `parseError`。
10. **Headless AI 超时**：优先用 `stoClaw.complete()`——默认 `timeoutMs = 120_000`，Bridge IPC 超时自动设为 `timeoutMs + 5s`；原生 `call` 时需手动设两层超时。

---

## 10. 调试

在 SClaw webview 内打开 DevTools，控制台执行：

```javascript
// 检测
console.log('bridge?', !!window.stoClaw?.call);
console.log('init', window.__STOCLAW_BRIDGE_INIT__);

//  ping
await window.stoClaw.call('bridge.ping');

// 能力列表
await window.stoClaw.call('bridge.getCapabilities');

// 应用信息
await window.stoClaw.call('app.getInfo');
```

---

## 附录：Method 与 SDK 对照（完整列表）

```
bridge.ping
bridge.getCapabilities
app.getInfo
user.getInfo          ← 同 auth.getUser
auth.getAuthMode
auth.getToken
auth.requestLogin     ← 不可用
nav.jump
nav.openTab
nav.openApp
nav.openExternal
nav.goBack
nav.reload
nav.closeSelf
ui.toast
ui.alert
ui.confirm
ui.openDrawer
chat.togglePanel
chat.fillComposer
chat.openSession
chat.sendMessage
chat.complete          ← Headless；Text prompt + JSON context
chat.cancel
chat.invokeAgent       ← 预留，未实现
host.fetch             ← 预留，未实现
storage.get            ← JSON value
storage.set
storage.remove
storage.clear
```
