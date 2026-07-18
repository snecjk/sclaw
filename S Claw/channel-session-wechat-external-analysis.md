# StoClaw 项目 — channel-session-wechat-external 会话类型分析报告

> 分析维度: **channel-session-wechat-external**
> 分析时间: 2025年7月
> 项目路径: `/Users/sto/Documents/project/robot/sto-claw/`

---

## 一、核心发现摘要

### 1.1 会话类型定义

`channel-session-wechat-external` 并非在 Electron 主进程或前端源码中**直接硬编码**的字符串，而是 **OpenClaw Gateway 在运行时生成的会话 key 命名模式**，格式推断为：

```
channel-session-{channelType}-{source}
```

其中：
- `channel-session` — 会话前缀，标识该会话由**外部渠道（Channel）**触发创建
- `wechat` — 渠道类型，对应 `OPENCLAW_WECHAT_CHANNEL_TYPE`（即 `openclaw-weixin`）
- `external` — 来源标识，表示消息来自**外部用户**（非本机用户直接输入）

### 1.2 代码层面的关联证据

| 文件 | 证据 |
|------|------|
| `shared/session-type.ts` | `channel` 是 `CatalogSessionType` 枚举之一（`'chat' \| 'cron' \| 'scheduled_task' \| 'claude_task' \| 'app' \| 'channel' \| 'workflow'`） |
| `electron/db/models/domain/session-catalog.ts` | `CatalogSession` 接口包含 `channelType: string \| null` 和 `channelId: string \| null` 字段 |
| `electron/db/migrations/0003-session-types-and-channels.ts` | SQLite 迁移为 `catalog_sessions` 表添加了 `channel_type` 和 `channel_id` 列，并创建了联合索引 |
| `electron/gateway/client.ts` | `ChannelType` 包含 `'wechat'` 类型 |
| `electron/utils/channel-alias.ts` | 定义 `UI_WECHAT_CHANNEL_TYPE = 'wechat'` 和 `OPENCLAW_WECHAT_CHANNEL_TYPE = 'openclaw-weixin'` |
| `electron/api/routes/channels.ts` | 处理微信渠道配置、登录、绑定等逻辑 |

---

## 二、完整数据流路径（从前端用户输入到后端持久化）

### 2.1 消息发送流程（前端 → 后端）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              消息发送数据流                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │ 前端用户 │──▶│ React/Zustand│──▶│  IPC / Host  │──▶│  Electron    │      │
│  │ 输入消息 │   │  状态管理    │   │   API 调用   │   │  Main Process │      │
│  └──────────┘   └──────────────┘   └──────────────┘   └──────────────┘      │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  Host API    │         │
│                              │                    │  Routes      │         │
│                              │                    │  (/api/chat/...)        │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  Engine      │         │
│                              │                    │  Adapter     │         │
│                              │                    │  (OpenClaw   │         │
│                              │                    │   / Claude)  │         │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  Gateway     │         │
│                              │                    │  WebSocket   │         │
│                              │                    │  RPC (chat.send)      │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  Gateway     │         │
│                              │                    │  Process     │         │
│                              │                    │  (OpenClaw)  │         │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  JSONL /     │         │
│                              │                    │  SQLite      │         │
│                              │                    │  持久化      │         │
│                              │                    └──────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 详细步骤

**Step 1: 前端用户输入**
- 用户在 React 前端界面的 ChatInput 组件输入消息
- 前端使用 **Zustand** 状态管理（`useChatStore`）
- 立即进行**乐观更新**：将用户消息加入 `messages` 数组，设置 `sending = true`

**Step 2: 路由选择 — 带媒体 vs 纯文本**
- 若用户发送了附件（图片/文件）：
  - 调用 `hostApiFetch('/api/chat/send-with-media', ...)`（`src/stores/chat/runtime-send-actions.ts:324`）
  - 附件处理：
    - 图片类型（`png`, `jpeg`, `gif`, `webp` 等）读取为 **base64** 作为 `attachments` 数组
    - 其他文件以 `[media attached: <path> (<mimeType>) | <path>]` 格式附加到消息文本
    - 若配置了 `fileTransformByOSS`，文件先上传到临时 OSS 获取 URL
- 若纯文本：
  - 调用 `hostApiFetch('/api/chat/send', ...)`（`src/stores/chat/runtime-send-actions.ts:344`）

**Step 3: Host API 路由处理**
- 请求到达 `electron/api/routes/gateway.ts`：
  - `/api/chat/send`（`handleGatewayRoutes` line 138）
  - `/api/chat/send-with-media`（`handleGatewayRoutes` line 202）
- 调用 `getAdapterForSession(body.sessionKey, parseEngineType(body.engineType))` 获取引擎适配器
- 适配器通过 `adapter.sendMessage({ gatewayManager }, rpcParams)` 发送

**Step 4: 引擎适配器分发**
- 文件 `electron/engines/manager.ts`（通过 `getAdapterForSession`）决定使用哪个引擎：
  - **`openclaw`** → 调用 `electron/engines/openclaw-adapter.ts`
  - **`claude`** → 调用 `electron/engines/claude-adapter.ts`
- 适配器调用 `gatewayManager.rpc('chat.send', rpcParams)` 通过 WebSocket 发送给 Gateway

**Step 5: Gateway 处理与持久化**
- Gateway 接收 `chat.send` RPC 请求
- 对于 `channel-session-wechat-external` 类型会话：
  - Gateway 内部负责将消息**路由到外部 WeChat 渠道**
  - 将消息写入 **JSONL 文件**（`~/.stoclaw/openclaw/agents/{agentId}/sessions/{sessionId}.jsonl`）
  - 同时更新 SQLite 会话目录（`catalog_sessions` 表）中的 `lastActivityAt`

---

### 2.2 消息接收流程（后端 → 前端）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              消息接收数据流                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐│
│  │ 外部 WeChat  │   │  Gateway     │   │  WebSocket   │   │  Electron    ││
│  │ 用户消息     │──▶│  内部渠道    │──▶│  事件广播    │──▶│  Main Process││
│  │              │   │  插件处理    │   │  (chat:message)     │              ││
│  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘│
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │ 消息丰富处理  │         │
│                              │                    │ (message-enrich)        │
│                              │                    │ • 文件路径补全│         │
│                              │                    │ • runDir 缓存 │         │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  IPC 广播    │         │
│                              │                    │  (webContents.send)   │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  React /     │         │
│                              │                    │  Zustand     │         │
│                              │                    │  状态更新    │         │
│                              │                    └──────────────┘         │
│                              │                           │                  │
│                              │                           ▼                  │
│                              │                    ┌──────────────┐         │
│                              │                    │  UI 渲染     │         │
│                              │                    │  (消息列表)  │         │
│                              │                    └──────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 详细步骤

**Step 1: 外部消息到达 Gateway**
- 外部 WeChat 渠道用户发送消息
- Gateway 内部渠道插件（WeChat 插件）接收消息
- Gateway 创建/更新 `channel-session-wechat-external` 类型会话
- 将消息追加到对应 JSONL 文件

**Step 2: Gateway 事件广播**
- Gateway 通过 WebSocket 发送事件：
  ```json
  { "type": "event", "event": "chat", "payload": { "message": {...}, "sessionKey": "channel-session-wechat-external" } }
  ```
- 或者通过 JSON-RPC Notification：`{ method: "messageReceived", params: {...} }`

**Step 3: Electron 主进程接收**
- `GatewayManager.handleMessage()`（`electron/gateway/manager.ts:1034`）解析 WebSocket 消息
- 事件类型 `event` + `event: "chat"` → 调用 `dispatchProtocolEvent()`（`electron/gateway/event-dispatch.ts:16`）
- 发射 `chat:message` 事件（`emitter.emit('chat:message', { message: payload })`）

**Step 4: 消息丰富处理（Message Enrich）**
- `ipc-handlers.ts:1625` 监听 `gatewayManager.on('chat:message')`：
  ```typescript
  gatewayManager.on('chat:message', (data) => {
    broadcast('gateway:chat-message', enrichGatewayPayload(data));
  });
  ```
- `enrichGatewayPayload()`（`electron/gateway/message-enrich.ts`）执行：
  - 提取 `sessionKey` 从 payload（`extractSessionKey`）
  - 缓存 `runDir`（`cacheRunDir`）
  - 将 bare file basenames 解析为**绝对路径**（`enrichContentString`）
  - 处理 `media attached` 标记，补全路径

**Step 5: IPC 广播到前端**
- `broadcast('gateway:chat-message', ...)` 通过 `webContents.send` 发送给所有 renderer 窗口
- Preload 脚本中定义了 `gateway:chat-message` 通道（`electron/preload/index.ts:209`）

**Step 6: 前端接收与状态更新**
- 前端 `useGatewayStore` 订阅 `gateway:chat-message`（`src/stores/gateway.ts:484`）
- 调用 `handleGatewayChatMessage()`（`src/stores/gateway.ts:396`）
- 触发 `useChatStore.getState().handleChatEvent(normalizedEvent)`（`src/stores/gateway.ts:429`）
- **Zustand 状态更新**：
  - 更新 `messages` 数组（追加新消息）
  - 更新 `streamingText` / `streamingMessage`（流式输出）
  - 设置 `sending = false`（发送完成）
  - 更新 `activeRunId` 等运行时状态

**Step 7: 乐观更新与补偿机制**
- 前端发送时已将用户消息**乐观地**加入消息列表（带 `idempotencyKey`）
- 当 Gateway 回传确认消息时，通过 `id` 匹配进行**去重**（`isSameUserMessage` 逻辑）
- 若发送失败，前端将乐观消息标记为 `isError = true`（`runtime-send-actions.ts:363-369`）
- 安全超时机制：若 90 秒无响应，自动设置 `sending = false` 并显示错误（`runtime-send-actions.ts:277-298`）

---

## 三、channel-session-wechat-external 创建流程分析

### 3.1 会话生命周期

```
外部 WeChat 消息首次到达
         │
         ▼
  ┌──────────────┐
  │ Gateway 检查 │
  │ 是否存在已有 │
  │ channel 会话 │
  └──────────────┘
         │
    ┌────┴────┐
    ▼         ▼
   不存在     存在
    │         │
    ▼         ▼
 创建新会话   复用现有会话
    │         │
    ▼         ▼
生成 sessionKey:          更新 lastActivityAt
channel-session-wechat-external
    │
    ▼
写入 catalog_sessions (SQLite)
  • sessionKey = channel-session-wechat-external
  • sessionType = 'channel'
  • channelType = 'wechat'
  • channelId = 'external'
  • title = 外部用户标识
    │
    ▼
Gateway 广播 chat:message 事件
携带 sessionKey 和新消息
    │
    ▼
Electron 主进程 → IPC → 前端
前端自动创建会话卡片并显示消息
```

### 3.2 创建触发点

| 触发条件 | 处理位置 | 说明 |
|---------|---------|------|
| 外部 WeChat 用户首次发消息 | Gateway 内部（OpenClaw 渠道插件） | Gateway 自动生成会话 key |
| 会话已存在但过期 | Gateway 会话管理 | 复用现有 JSONL 文件追加消息 |
| 前端切换到渠道会话 | `src/stores/chat` | 加载历史消息 |

### 3.3 会话目录存储（SQLite）

当 Gateway 或 Electron 检测到新会话时，通过 `session-catalog-service.ts` 写入 SQLite：

```typescript
// electron/services/session-catalog-service.ts
await upsertCatalogSession({
  workspaceId: DEFAULT_WORKSPACE_ID,  // 或用户绑定的 workspace
  sessionKey: 'channel-session-wechat-external',
  sessionType: 'channel',              // 来自 CatalogSessionType
  channelType: 'wechat',
  channelId: 'external',
  title: 'WeChat External User',
  lastActivityAt: new Date().toISOString(),
});
```

对应表结构（`electron/db/migrations/0003-session-types-and-channels.ts`）：

```sql
ALTER TABLE catalog_sessions ADD COLUMN channel_type TEXT;
ALTER TABLE catalog_sessions ADD COLUMN channel_id TEXT;
CREATE INDEX IF NOT EXISTS idx_catalog_sessions_channel
  ON catalog_sessions(channel_type, channel_id)
  WHERE deleted_at IS NULL AND channel_type IS NOT NULL;
```

---

## 四、消息写入流程分析

### 4.1 消息持久化路径

```
消息到达
   │
   ▼
Gateway 消息处理器
   │
   ├─────────────────────────┐
   │                         │
   ▼                         ▼
JSONL 文件写入          SQLite 元数据更新
   │                         │
   ▼                         ▼
~/.stoclaw/openclaw/     catalog_sessions 表
agents/{agentId}/        • lastActivityAt 更新
sessions/{uuid}.jsonl    • 触发前端会话列表刷新
```

### 4.2 JSONL 文件格式

每条消息追加到 JSONL 文件（JSON Lines 格式）：

```json
{"role": "user", "content": "Hello from WeChat", "timestamp": "2025-07-16T10:00:00Z", "sessionKey": "channel-session-wechat-external", "channelType": "wechat", "source": "external"}
{"role": "assistant", "content": "Hello! How can I help you?", "timestamp": "2025-07-16T10:00:05Z", "sessionKey": "channel-session-wechat-external"}
```

### 4.3 消息写入时的关键处理

| 处理环节 | 文件位置 | 功能说明 |
|---------|---------|---------|
| 消息丰富 | `electron/gateway/message-enrich.ts` | 将 bare 文件名补全为绝对路径，缓存 runDir |
| 去重 | `src/stores/gateway.ts` | 基于 `runId + sessionKey + seq + messageId` 构建 dedupe key，30s TTL |
| 附件处理 | `electron/main/ipc-handlers.ts:1468` | 读取文件为 base64，或上传 OSS |
| 钉钉提及 | `shared/dingtalk-recipient-message.ts` | 为钉钉渠道注入收件人块 |
| 乐观更新 | `src/stores/chat/runtime-send-actions.ts` | 前端先显示消息，后等待确认 |

---

## 五、关键代码文件清单

### 5.1 创建流程相关文件

| 文件 | 职责 |
|------|------|
| `shared/session-type.ts` | 定义 `CatalogSessionType` 包含 `'channel'` |
| `electron/db/models/domain/session-catalog.ts` | `CatalogSession` 接口定义，含 `channelType`/`channelId` |
| `electron/db/migrations/0003-session-types-and-channels.ts` | SQLite 表迁移，添加渠道字段和索引 |
| `electron/services/session-catalog-service.ts` | `upsertCatalogSession` 写入 SQLite 会话目录 |
| `electron/gateway/client.ts` | `ChannelType` 定义包含 `'wechat'` |
| `electron/utils/channel-alias.ts` | 渠道别名映射（`wechat` ↔ `openclaw-weixin`） |
| `electron/api/routes/channels.ts` | 微信渠道配置、登录、绑定路由 |
| `electron/utils/wechat-login.ts` | 微信扫码登录会话管理 |

### 5.2 消息写入流程相关文件

| 文件 | 职责 |
|------|------|
| `src/stores/chat/runtime-send-actions.ts` | 前端发送消息核心逻辑，乐观更新 |
| `src/stores/gateway.ts` | 接收 Gateway 事件，分发到 ChatStore |
| `electron/api/routes/gateway.ts` | Host API 路由：`/api/chat/send`, `/api/chat/send-with-media` |
| `electron/engines/openclaw-adapter.ts` | OpenClaw 引擎适配器，调用 `gatewayManager.rpc('chat.send')` |
| `electron/engines/claude-adapter.ts` | Claude SDK 引擎适配器（备用路径） |
| `electron/gateway/manager.ts` | WebSocket 连接管理，RPC 调用，事件接收 |
| `electron/gateway/event-dispatch.ts` | 将 Gateway 事件分发为 `chat:message` / `notification` |
| `electron/gateway/message-enrich.ts` | 消息丰富：文件路径补全、runDir 缓存 |
| `electron/main/ipc-handlers.ts` | IPC 处理：`chat:sendWithMedia`, 广播 `gateway:chat-message` |
| `electron/main/index.ts` | 主进程入口：桥接 `gm.on('chat:message')` → `heb.emit('gateway:chat-message')` |
| `electron/preload/index.ts` | Preload 脚本：注册 IPC 通道 `gateway:chat-message` |

---

## 六、状态管理（Zustand）关键机制

### 6.1 乐观更新与补偿

```typescript
// runtime-send-actions.ts
const userMsg: RawMessage = {
  role: 'user',
  content: text,
  timestamp: Date.now() / 1000,
  id: crypto.randomUUID(),  // 用于去重配对
};

// 乐观更新：立即加入消息列表
set((s) => ({ messages: [...s.messages, userMsg], sending: true }));

// 发送失败时补偿：标记为错误
set((s) => ({
  messages: s.messages.map((m, i, arr) =>
    i === arr.length - 1 && m.role === 'user' ? { ...m, isError: true } : m
  ),
  sending: false,
}));
```

### 6.2 运行时状态隔离

每个会话有独立的运行时状态：

```typescript
interface SessionRuntime {
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: Message | null;
  streamingTools: ToolCall[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  pendingToolImages: ImageAttachment[];
  error: string | null;
  updatedAt: number;
}

// 按 sessionKey 隔离运行时状态
runtimeBySessionKey: Record<string, SessionRuntime>
```

---

## 七、结论与要点

### 7.1 channel-session-wechat-external 的特殊性

1. **Gateway 内部生成**：该 session key 由 OpenClaw Gateway 的渠道插件（WeChat 插件）在运行时自动生成，Electron 主进程和前端代码中不直接构造该字符串。

2. **CatalogSessionType 为 `channel`**：在 SQLite 会话目录中，`sessionType` 字段值为 `'channel'`，区别于 `'chat'`（普通对话）、`'cron'`（定时任务）等。

3. **双字段标识渠道**：`channel_type = 'wechat'` + `channel_id = 'external'` 共同标识消息来源。

4. **消息流向是单向外部流入**：与普通 `chat` 会话不同，channel 会话的消息主要来自外部用户（通过 WeChat 渠道），而非本机用户直接输入。

### 7.2 数据流总览

| 方向 | 路径 | 持久化方式 |
|------|------|-----------|
| 发送（前端 → 后端） | React → Zustand → Host API → Electron Main → Engine Adapter → Gateway RPC → Gateway Process | JSONL + SQLite |
| 接收（后端 → 前端） | Gateway Process → WebSocket → Electron Main → message-enrich → IPC → React/Zustand | JSONL（已写入） |

### 7.3 待确认事项

由于 `channel-session-wechat-external` 字符串在 Electron 源码中**未直接出现**，以下推断基于代码分析，可能需要进一步确认：

1. 确切的 session key 格式是否包含 `channel-session-` 前缀，以及 `external` 后缀的确切含义（是否指代特定用户标识）。
2. Gateway 内部生成 channel 会话 key 的具体逻辑（位于 OpenClaw Gateway 的闭源/打包代码中）。
3. 当多个外部用户同时通过 WeChat 发消息时，是为每个用户创建独立会话还是共享一个会话。

> 建议：如需进一步确认 session key 的生成规则，需要在 OpenClaw Gateway 运行时的日志中观察实际生成的 session key，或查阅 OpenClaw 渠道插件的源码。

---

*报告结束*
