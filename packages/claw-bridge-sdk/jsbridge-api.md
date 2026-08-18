# SClaw JSBridge 调用文档

`@sto/claw-bridge-sdk` 官方调用文档 · 协议 `stoclaw-bridge/v1` · 版本 `1.0.0`

---

## 1. 概述

JSBridge 供 **嵌入 SClaw 客户端 webview 的 H5 页面** 调用宿主能力，例如：读取 SSO 用户信息、弹出统一 UI、跳转应用/路由、回填 AI 会话等。

**典型场景**：应用广场（App Plaza）内打开的 `*.sto.cn` 业务页面。

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

---

## 5. 能力分级与权限

Bridge 按应用信任等级（`trustTier`）授予不同能力，可通过 `app.getInfo` 或 `bridge.getCapabilities` 查询当前页面可用能力。

| trustTier | 场景 | 典型能力 |
|-----------|------|----------|
| `catalog` | 应用广场已绑定 catalog 应用 | 用户、UI、导航、会话、Storage 等（默认最全） |
| `external` | 有 appId 但未绑定 | 仅 ping、app 信息、auth.getUser、toast |
| `internal` | 内部应用（`__xxx__` 形式 appId） | 全部能力 |
| `untrusted` | 无 appId | 仅 ping、getCapabilities、app.getInfo |

### 需用户授权的能力

以下能力首次调用时可能弹出授权确认（`USER_CONSENT_REQUIRED`）：

- `auth.getToken`
- `nav.openExternal`
- `chat.sendMessage`

> `host.fetch` 已在能力清单中预留，**当前版本尚未实现**。

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

### 6.5 会话 / Chat

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

### 6.6 Storage（Bridge 隔离存储）

按 `appId + sessionId` 隔离的键值存储，不会污染页面 `localStorage`。

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
| `call(method, params)` | 任意 | 底层调用 |
| `on(event, handler)` | — | 订阅 Bridge 事件 |
| `isStoClawBridgeAvailable()` | — | 环境检测（静态） |

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
storage.get
storage.set
storage.remove
storage.clear
```
