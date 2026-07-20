# StoClaw 项目 OpenClaw 引擎会话创建与消息写入逻辑分析报告

## 1. 架构概览

StoClaw 采用双引擎架构（OpenClaw + Claude SDK），会话消息数据流贯穿前端 → IPC → Host API → Electron Main → Gateway/OpenClaw，最终持久化到 JSONL 文件。前端使用 Zustand 管理状态，支持乐观更新和补偿机制。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端 (Renderer)                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Chat Store   │  │ Session      │  │ Runtime      │  │ History Actions │  │
│  │ (chat.ts)    │  │ Actions      │  │ Actions      │  │ (history-actions)│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
│         └──────────────────┴──────────────────┘                    │          │
│                            │                                       │          │
│                     hostApiFetch()                                 │          │
│                            │                                       │          │
│              invokeIpc('hostapi:fetch')                             │          │
└────────────────────────────┼───────────────────────────────────────┼──────────┘
                             │                                       │
┌────────────────────────────┼───────────────────────────────────────┼──────────┐
│                      IPC 主进程 (Main Process)                      │          │
│  ┌─────────────────────────┴─────────────────────┐                  │          │
│  │  electron/main/ipc/host-api-proxy.ts          │                  │          │
│  │  ipcMain.handle('hostapi:fetch', ...)         │                  │          │
│  └─────────────────────────┬─────────────────────┘                  │          │
│                            │ proxyAwareFetch()                       │          │
│                            ▼                                         ▼          │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │  Host API Server (3210端口)          │  │  Gateway WebSocket               │ │
│  │  electron/api/server.ts             │  │  ws://127.0.0.1:18789/ws         │ │
│  │  + routes/gateway.ts                │  │                                  │ │
│  │  + routes/sessions.ts               │  │  EventSource (chat events)       │ │
│  └────────────────────┬────────────────┘  └──────────────────┬──────────────┘ │
│                       │                                       │                │
│           getAdapterForSession()                    WebSocket Events          │
│                       │                                       │                │
│  ┌────────────────────┴────────────────┐  ┌───────────────────┴────────────┐ │
│  │  引擎适配器层                         │  │  GatewayManager (event-dispatch)│ │
│  │  ├─ openclaw-adapter.ts (Gateway)   │  │  ├─ chat:message                 │ │
│  │  ├─ claude-adapter.ts (Claude SDK)  │  │  ├─ notification                 │ │
│  │  └─ manager.ts (适配器选择)          │  │  └─ error                        │ │
│  └────────────────────┬────────────────┘  └──────────────────────────────────┘ │
│                       │                                                         │
│            gatewayManager.rpc('chat.send', ...)                                 │
│                       │                                                         │
│  ┌────────────────────┴─────────────────────────────────────────────────────┐  │
│  │  Gateway Process (OpenClaw Python)                                       │  │
│  │  ├─ chat.send RPC handler                                               │  │
│  │  ├─ chat.history RPC handler                                            │  │
│  │  ├─ sessions.list RPC handler                                           │  │
│  │  └─ JSON-RPC 2.0 over WebSocket                                         │  │
│  └────────────────────┬─────────────────────────────────────────────────────┘  │
└───────────────────────┼────────────────────────────────────────────────────────┘
                        │
┌───────────────────────┼────────────────────────────────────────────────────────┐
│                       ▼ 持久化层                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  OpenClaw 持久化 (JSON Lines)                                            │  │
│  │  ~/.stoclaw/openclaw/agents/{agentId}/sessions/{uuid}.jsonl             │  │
│  │  ~/.stoclaw/openclaw/agents/{agentId}/sessions/sessions.json (索引)      │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  会话目录 (SQLite)                                                        │  │
│  │  ~/.stoclaw/stoclaw.db → session_catalog / session_bindings 表           │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Claude 持久化 (JSON Lines)                                               │  │
│  │  ~/.stoclaw/.claude/projects/{project-hash}/{sessionId}.jsonl           │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 会话创建流程

### 2.1 前端会话创建

**文件**: `src/stores/chat/session-actions.ts` (第 499-562 行)

```typescript
// newSession 方法核心逻辑
const prefix = getCanonicalPrefixFromSessions(sessions) ?? DEFAULT_CANONICAL_PREFIX;  // 'agent:main'
const newKey = `${prefix}:session-${Date.now()}`;  // e.g., 'agent:main:session-1712345678901'

// 关键设计：不调用 sessions.reset（避免归档旧会话文件）
// 仅前端状态更新，不创建后端文件
const newSessionEntry: ChatSession = {
  key: newKey,
  label: '新对话',
  engineType: agentEngineType,
  ...(chosenModel ? { model: chosenModel } : {}),
};

set((s) => ({
  currentSessionKey: newKey,
  sessions: [...s.sessions, newSessionEntry],
  messages: [],  // 清空消息
  // ...
}));
```

**关键设计决策**:
1. **前端先行**: 会话仅在前端创建，不立即创建后端文件
2. **延迟持久化**: 首次发送消息时，Gateway 会自动创建会话
3. **避免归档**: 不调用 `sessions.reset` 以免归档旧会话历史
4. **空会话清理**: 离开空临时会话时自动从侧边栏移除

### 2.2 后端会话解析

**文件**: `electron/engines/openclaw-adapter.ts` (第 56-138 行)

```typescript
// 加载 OpenClaw 会话元数据
async function loadOpenClawSessionStoreMetadata(): Promise<Map<string, OpenClawSessionStoreMetadata>> {
  const metadataByKey = new Map<...>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  
  // 读取每个 agent 的 sessions.json
  for (const agentId of agentIds) {
    const storePath = join(sessionsDir, 'sessions.json');
    const store = JSON.parse(await readFile(storePath, 'utf8'));
    
    // 解析两种格式：
    // 1. Array format: store.sessions = [{ key, sessionFile, sessionId }]
    // 2. Map format: store[sessionKey] = { sessionFile, sessionId }
  }
}
```

**文件**: `electron/engines/session-engine.ts`

```typescript
// 会话引擎类型解析
export async function resolveSessionEngineType(sessionKey: string, preferredEngineType?: AgentEngineType): Promise<AgentEngineType> {
  // 1. 优先使用显式指定的 engineType
  if (preferredEngineType) { ... }
  
  // 2. 查注册表 (SQLite session_bindings 表)
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  if (existing?.engineType) { return existing.engineType; }
  
  // 3. Claude 任务键格式判断
  if (parseClaudeTaskIdFromSessionKey(sessionKey)) { return 'claude'; }
  
  // 4. 从 agentId 推断
  return resolveAgentEngineType(await resolveAgentIdForSessionKey(sessionKey));
}
```

### 2.3 会话注册表

**文件**: `electron/engines/session-registry.ts` (第 13-53 行)

```typescript
// 引擎会话注册表操作（基于 SQLite session_bindings 表）
let registryMutationQueue: Promise<void> = Promise.resolve();

export async function getEngineSessionRegistryEntry(sessionKey: string): Promise<EngineSessionRegistryEntry | null> {
  await ensureSessionCatalogBootstrapped();
  return getEngineBinding(sessionKey);  // SQLite 查询
}

export async function upsertEngineSessionRegistryEntry(entry: EngineSessionRegistryEntry): Promise<void> {
  return runRegistryMutation(async () => {
    await upsertEngineBinding(entry);  // SQLite UPSERT
  });
}
```

**文件**: `electron/engines/session-registry-types.ts`

```typescript
export interface EngineSessionRegistryEntry {
  sessionKey: string;
  engineType: AgentEngineType;   // 'openclaw' | 'claude'
  agentId: string;
  sessionId?: string;            // Claude SDK 会话 ID
  cwd?: string;                  // 工作目录
  title?: string;
  model?: string;
  provider?: string;
  accountId?: string;
  archivedClaudeSessionIds?: string[];
  pendingHistoryBridge?: boolean;
}
```

### 2.4 会话目录服务

**文件**: `electron/services/session-catalog-service.ts` (第 63-77 行)

```typescript
// SQLite 会话目录引导
export async function ensureSessionCatalogBootstrapped(): Promise<void> {
  if (!catalogBootstrapPromise) {
    catalogBootstrapPromise = bootstrapSessionCatalog().catch(...);
  }
  await catalogBootstrapPromise;
}

async function bootstrapSessionCatalog(): Promise<void> {
  await getWorkspaceRepository().getDefaultWorkspace();
  await importEngineSessionsJsonIfNeeded();  // 从 JSON 迁移到 SQLite
  logger.info('[session-catalog] bootstrap complete');
}
```

---

## 3. 消息写入流程

### 3.1 前端发送消息

**文件**: `src/stores/chat/runtime-send-actions.ts` (第 101-391 行)

```typescript
sendMessage: async (options: SendMessageOptions) => {
  const { text, attachments, targetAgentId, skillMeta } = options;
  const userDisplayText = text.trim();
  const gatewayText = skillMeta ? resolveSkillGatewayText(...) : userDisplayText;
  
  // Step 1: 乐观更新 - 立即插入用户消息到 UI
  const nowMs = Date.now();
  const userMsg: RawMessage = {
    role: 'user',
    content: userDisplayText || '(file attached)',
    timestamp: nowMs / 1000,
    id: crypto.randomUUID(),  // 作为幂等性键
    _skillMeta: skillMeta,
    _attachedFiles: attachments?.map(a => ({ ... })),
  };
  
  set((s) => ({
    messages: [...s.messages, userMsg],
    sending: true,
    lastUserMessageAt: nowMs,
  }));
  
  // Step 2: 启动历史轮询（作为流式事件的后备）
  const POLL_START_DELAY = 3_000;
  const POLL_INTERVAL = 4_000;
  setHistoryPollTimer(setTimeout(pollHistory, POLL_START_DELAY));
  
  // Step 3: 设置安全超时（90秒）
  const SAFETY_TIMEOUT_MS = 90_000;
  setTimeout(checkStuck, 30_000);
  
  // Step 4: 调用 Host API
  const idempotencyKey = userMsg.id;
  const result = await hostApiFetch('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({
      sessionKey: currentSessionKey,
      message: gatewayText,
      deliver: false,
      idempotencyKey,
      engineType: currentSessionEngineType,
    }),
  });
  
  // Step 5: 处理结果
  if (!result.success) {
    // 标记最后一条消息为错误
    set((s) => ({
      messages: s.messages.map((msg, i, arr) =>
        i === arr.length - 1 && msg.role === 'user' ? { ...msg, isError: true } : msg
      ),
      error: formatChatRuntimeError(result.error),
      sending: false,
    }));
  } else if (result.result?.runId) {
    set({ activeRunId: result.result.runId });
  }
}
```

### 3.2 IPC → Host API 代理

**文件**: `src/lib/host-api.ts` (第 156-220 行)

```typescript
export async function hostApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // 在 Electron 渲染进程中，通过 IPC 代理到主进程
  const response = await invokeIpc<HostApiProxyResponse>('hostapi:fetch', {
    path,
    method: init?.method || 'GET',
    headers: headersToRecord(init?.headers),
    body: init?.body ?? null,
  });
  // ...
}
```

**文件**: `electron/main/ipc/host-api-proxy.ts` (第 36-88 行)

```typescript
export function registerHostApiProxyHandlers(): void {
  ipcMain.handle('hostapi:fetch', async (_, request: HostApiFetchRequest) => {
    const response = await proxyAwareFetch(
      `http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
        method,
        headers,
        body,
        timeoutMs: resolveHostApiTimeoutMs(path),  // 默认 30s, chat.send 120s
      }
    );
    return { ok: true, data: { status, ok, json, text } };
  });
}
```

### 3.3 Host API 路由处理

**文件**: `electron/api/routes/gateway.ts` (第 138-181 行)

```typescript
if (url.pathname === '/api/chat/send' && req.method === 'POST') {
  const body = await parseJsonBody<...>(req);
  const adapter = await getAdapterForSession(body.sessionKey, parseEngineType(body.engineType));
  
  const result = await adapter.sendMessage(
    { gatewayManager: ctx.gatewayManager },
    {
      sessionKey: body.sessionKey,
      message: body.message,
      deliver: body.deliver,
      idempotencyKey: body.idempotencyKey,
    }
  );
  
  if (!result.success) {
    sendJson(res, 500, result);
    return true;
  }
  sendJson(res, 200, result);
}
```

### 3.4 引擎适配器选择

**文件**: `electron/engines/manager.ts` (第 19-25 行)

```typescript
export async function getAdapterForSession(
  sessionKey: string,
  preferredEngineType?: AgentEngineType,
): Promise<EngineAdapter> {
  const engineType = await resolveSessionEngineType(sessionKey, preferredEngineType);
  return getAdapter(engineType);  // openClawAdapter 或 claudeAdapter
}
```

### 3.5 OpenClaw 适配器发送消息

**文件**: `electron/engines/openclaw-adapter.ts` (第 215-233 行)

```typescript
async sendMessage(ctx: EngineAdapterContext, params) {
  const sessionKey = params.sessionKey;
  
  // Step 1: 确保项目 Agent 存在（自动生成 workspace 等）
  const projectAgentResult = await ensureProjectAgentForSessionKey(sessionKey);
  if (projectAgentResult.created || projectAgentResult.workspaceUpdated) {
    await ctx.gatewayManager.debouncedReload();  // Gateway 重新加载配置
  }
  
  // Step 2: 构建 RPC 参数
  const rpcParams: Record<string, unknown> = {
    sessionKey,
    message: params.message,
    deliver: params.deliver,
    idempotencyKey: params.idempotencyKey,  // 幂等性键
  };
  
  // Step 3: 调用 Gateway RPC (120秒超时)
  const result = await ctx.gatewayManager.rpc<{ runId?: string }>('chat.send', rpcParams, 120000);
  return { success: true, result };
}
```

**带媒体文件的发送** (第 235-279 行):
```typescript
async sendMessageWithMedia(ctx: EngineAdapterContext, params: EngineSendWithMediaParams) {
  // 1. 构建文件引用文本: "[media attached: <path> (<mimeType>) | <path>]"
  // 2. 视觉文件转 Base64
  const imageAttachments = [];
  for (const media of params.media ?? []) {
    fileReferences.push(`[media attached: ${media.filePath} (${media.mimeType}) | ${media.filePath}]`);
    if (VISION_MIME_TYPES.has(media.mimeType)) {
      const fileBuffer = await readFile(media.filePath);
      imageAttachments.push({ content: fileBuffer.toString('base64'), mimeType: media.mimeType });
    }
  }
  
  // 3. 合并消息和附件
  message = message ? `${message}\n\n${fileReferences.join('\n')}` : fileReferences.join('\n');
  
  // 4. 调用 chat.send
  rpcParams.attachments = imageAttachments;
  const result = await ctx.gatewayManager.rpc('chat.send', rpcParams, 120000);
}
```

### 3.6 Gateway RPC 调用

**文件**: `electron/gateway/manager.ts` (第 700-850 行区域)

```typescript
// GatewayManager.rpc(method, params, timeoutMs)
// 通过 WebSocket 发送 JSON-RPC 2.0 请求
rpc<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
  const request = createRequest(method, params, id);
  return new Promise((resolve, reject) => {
    // 发送 WS 消息
    this.ws.send(JSON.stringify(request));
    // 等待响应或超时
    this.pendingRequests.set(String(id), { resolve, reject, timer });
  });
}
```

**文件**: `electron/gateway/protocol.ts`

```typescript
// JSON-RPC 2.0 协议
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;      // e.g., 'chat.send', 'chat.history', 'sessions.list'
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;      // e.g., 'chat.message_received', 'agent.completed'
  params?: unknown;
}

export enum GatewayEventType {
  MESSAGE_RECEIVED = 'chat.message_received',
  MESSAGE_SENT = 'chat.message_sent',
  TOOL_CALL_STARTED = 'tool.call_started',
  TOOL_CALL_COMPLETED = 'tool.call_completed',
  ERROR = 'error',
}
```

### 3.7 持久化存储

**OpenClaw 会话文件结构**:
```
~/.stoclaw/openclaw/
└── agents/
    └── {agentId}/
        └── sessions/
            ├── sessions.json              # 会话索引
            └── {uuid}.jsonl               # 会话消息记录 (JSON Lines)
```

**sessions.json 格式**:
```json
{
  "sessions": [
    {
      "key": "agent:main:session-1712345678901",
      "sessionKey": "agent:main:session-1712345678901",
      "sessionId": "uuid-here",
      "sessionFile": "/path/to/uuid.jsonl",
      "label": "会话标签",
      "spawnedBy": "agent:main:main"
    }
  ],
  "agent:main:main": "uuid-here.jsonl"  // 旧版直接映射
}
```

**JSONL 消息格式**:
```jsonl
{"type":"message","id":"msg-id","timestamp":"2024-01-01T00:00:00Z","message":{"role":"user","content":"Hello","timestamp":1704067200}}
{"type":"message","id":"msg-id","timestamp":"2024-01-01T00:00:01Z","message":{"role":"assistant","content":"Hi there!","timestamp":1704067201}}
```

**文件**: `electron/services/workflow-session-writer.ts` (第 103-139 行)

```typescript
export async function appendWorkflowSessionRecord(input: AppendWorkflowSessionRecordInput): Promise<void> {
  const registryEntry = await getEngineSessionRegistryEntry(input.sessionKey);
  if (registryEntry?.engineType === 'claude') {
    await appendClaudeWorkflowSessionRecord(input);
    return;
  }
  
  // OpenClaw: 追加 toolResult 行到 JSONL
  const sessionFile = await resolveSessionFile(agentId, input.sessionKey);
  const envelope = buildWorkflowExecutionSessionRecord(input);
  const toolCallId = `sto_wf_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  
  const line = {
    type: 'message',
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    timestamp: new Date(now).toISOString(),
    message: {
      role: 'toolResult',
      toolCallId,
      toolName: 'sto_workflow_session',
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      details: envelope,
    },
  };
  
  await appendFile(sessionFile, `${JSON.stringify(line)}\n`, 'utf8');
}
```

---

## 4. 消息流回前端流程

### 4.1 Gateway → Main 事件分发

**文件**: `electron/gateway/event-dispatch.ts` (第 8-53 行)

```typescript
export function dispatchProtocolEvent(emitter: GatewayEventEmitter, event: string, payload: unknown): void {
  switch (event) {
    case 'chat':
      emitter.emit('chat:message', { message: payload });
      break;
    case 'agent':
      emitter.emit('notification', { method: event, params: payload });
      break;
    case 'channel.status':
      emitter.emit('channel:status', payload);
      break;
    default:
      emitter.emit('notification', { method: event, params: payload });
  }
}

export function dispatchJsonRpcNotification(emitter, notification: JsonRpcNotification): void {
  switch (notification.method) {
    case GatewayEventType.MESSAGE_RECEIVED:
      emitter.emit('chat:message', { message: notification.params });
      break;
    case GatewayEventType.ERROR:
      emitter.emit('error', new Error(errorData.message));
      break;
  }
}
```

### 4.2 前端事件处理

**文件**: `src/stores/chat/runtime-event-actions.ts` (第 5-56 行)

```typescript
export function createRuntimeEventActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'handleChatEvent'> {
  return {
    handleChatEvent: (event: Record<string, unknown>) => {
      const runId = String(event.runId || '');
      const eventState = String(event.state || '');
      const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
      
      // 过滤：仅处理当前会话和当前 run 的事件
      if (eventSessionKey != null && eventSessionKey !== currentSessionKey) return;
      if (activeRunId && runId && runId !== activeRunId) return;
      
      setLastChatEventAt(Date.now());
      handleRuntimeEventState(set, get, event, resolvedState, runId);
    },
  };
}
```

### 4.3 事件状态处理

**文件**: `src/stores/chat/runtime-event-handlers.ts` (第 60-333 行)

```typescript
export function handleRuntimeEventState(set: ChatSet, get: ChatGet, event, resolvedState, runId) {
  switch (resolvedState) {
    case 'started': {
      // 从其他客户端启动的 run
      set({ sending: true, activeRunId: runId, error: null });
      break;
    }
    
    case 'delta': {
      // 流式增量数据
      set((s) => ({
        streamingMessage: event.message,
        streamingMessages: appendStreamingAssistantSnapshot(s.streamingMessages, event.message),
        streamingTools: upsertToolStatuses(s.streamingTools, updates),
      }));
      break;
    }
    
    case 'final': {
      // 消息完成
      const finalMsg = event.message as RawMessage;
      
      if (isToolResultRole(finalMsg.role)) {
        // 工具结果
        set((s) => ({
          streamingToolResults: appendStreamingToolResultSnapshot(s.streamingToolResults, finalMsg),
          pendingFinal: true,
        }));
      } else {
        // 助手最终消息
        const msgWithImages = pendingImgs.length > 0
          ? { ...finalMsg, _attachedFiles: [...(finalMsg._attachedFiles || []), ...pendingImgs] }
          : finalMsg;
        
        set((s) => ({
          messages: [...s.messages, msgWithImages],
          sending: isTerminalOutput ? false : s.sending,
          activeRunId: isTerminalOutput ? null : s.activeRunId,
          pendingFinal: isTerminalOutput ? false : true,
        }));
        
        if (isTerminalOutput) {
          clearHistoryPoll();
          void get().loadHistory(true);  // 静默加载完整历史
        }
      }
      break;
    }
    
    case 'error': {
      // 错误处理（15秒恢复宽限期）
      set({ error: errorMsg, streamingText: '', streamingMessage: null });
      
      if (wasSending && !shouldFinalizeImmediately) {
        setErrorRecoveryTimer(setTimeout(() => {
          // 宽限期结束仍未恢复，标记为失败
          set({ sending: false, activeRunId: null, lastUserMessageAt: null });
          state.loadHistory(true);
        }, 15_000));
      }
      break;
    }
    
    case 'aborted': {
      set({ sending: false, activeRunId: null, ... });
      break;
    }
  }
}
```

---

## 5. 历史加载流程

### 5.1 前端历史加载

**文件**: `src/stores/chat/history-actions.ts` (第 94-309 行)

```typescript
loadHistory: async (quiet = false) => {
  const { currentSessionKey, sessions } = get();
  if (!quiet) set({ loading: true, error: null });
  
  // 1. 调用 chat.history RPC
  const result = await hostApiFetch(`/api/chat/history?sessionKey=${...}&limit=${CHAT_HISTORY_LENGTH_MAX_LIMIT}`);
  
  const applyLoadedMessages = (rawMessages: RawMessage[], thinkingLevel: string | null) => {
    // 2. 合并历史消息
    rawMessages = mergeHistoryWhenShrunk(rawMessages, get().messages);
    
    // 3. 工具结果文件富化
    const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
    const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role));
    
    // 4. 图片缓存恢复
    const enrichedMessages = enrichWithCachedImages(filteredMessages);
    
    // 5. 合并乐观用户消息（防止闪烁）
    let finalMessages = enrichedMessages;
    if (userMsgAt) {
      finalMessages = mergeOptimisticUserIntoHistory(enrichedMessages, get().messages, {
        userMessageAt: userMsgAt,
        sending: get().sending,
        sessionKey: currentSessionKey,
      });
    }
    
    // 6. 参数表单恢复
    finalMessages = mergeParameterFormBlocksFromCurrent(finalMessages, get().messages, getMessageText);
    
    // 7. 工作流本地回合合并
    finalMessages = mergeLocalWorkflowTurnsFromCurrent(finalMessages, get().messages);
    
    // 8. 用户消息去重
    finalMessages = dedupeRedundantUserMessages(finalMessages, userMsgAt ?? null, { sessionKey: currentSessionKey });
    
    set({ messages: finalMessages, thinkingLevel, loading: false });
  };
}
```

### 5.2 后端历史获取

**文件**: `electron/engines/openclaw-adapter.ts` (第 197-213 行)

```typescript
async getHistory(ctx: EngineAdapterContext, params: { sessionKey: string; limit: number }) {
  const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('chat.history', {
    sessionKey: params.sessionKey,
    limit: params.limit,
  });
  return {
    success: true,
    result: {
      messages: Array.isArray(result.messages) ? result.messages : [],
      thinkingLevel: typeof result.thinkingLevel === 'string' ? result.thinkingLevel : null,
    },
  };
}
```

---

## 6. 乐观更新与补偿机制

### 6.1 乐观消息插入

**文件**: `src/stores/chat/runtime-send-actions.ts` (第 212-240 行)

```typescript
// 在 RPC 调用前立即插入用户消息
const nowMs = Date.now();
const userMsg: RawMessage = {
  role: 'user',
  content: userDisplayText || '(file attached)',
  timestamp: nowMs / 1000,
  id: crypto.randomUUID(),  // 同时作为幂等性键
  _skillMeta: skillMeta,
  _attachedFiles: attachments?.map(...),
};

set((s) => ({
  messages: [...s.messages, userMsg],
  sending: true,
  error: null,
  lastUserMessageAt: nowMs,
}));
```

### 6.2 乐观消息与历史合并

**文件**: `src/stores/chat/user-message-merge.ts` (第 ~200 行区域)

```typescript
export function mergeOptimisticUserIntoHistory(
  historyMessages: RawMessage[],
  localMessages: RawMessage[],
  options: { userMessageAt: number; sending: boolean; sessionKey: string }
): RawMessage[] {
  // 查找乐观用户消息
  const optimisticUserMsg = localMessages.find((msg) => 
    msg.role === 'user' && msg.id && msg.timestamp && toMs(msg.timestamp) >= options.userMessageAt
  );
  
  if (!optimisticUserMsg) return historyMessages;
  
  // 检查历史中是否已存在相同消息（通过 id 或内容匹配）
  const alreadyInHistory = historyMessages.some((msg) => 
    isSameUserMessage(msg, optimisticUserMsg)
  );
  
  if (alreadyInHistory) return historyMessages;
  
  // 将乐观消息插入到历史末尾
  return [...historyMessages, optimisticUserMsg];
}
```

### 6.3 用户消息去重

**文件**: `src/stores/chat/user-message-merge.ts` (第 ~300 行区域)

```typescript
export function dedupeRedundantUserMessages(
  messages: RawMessage[],
  userMessageAt: number | null,
  options: { sessionKey: string }
): RawMessage[] {
  // 基于 idempotencyKey / id / 内容哈希去重
  const seen = new Set<string>();
  const result: RawMessage[] = [];
  
  for (const msg of messages) {
    if (msg.role !== 'user') {
      result.push(msg);
      continue;
    }
    
    const key = msg.id || msg.timestamp || JSON.stringify(msg.content);
    if (seen.has(key)) {
      traceChatSession({ phase: 'dedupe-user', action: 'drop-duplicate', ... });
      continue;
    }
    seen.add(key);
    result.push(msg);
  }
  
  return result;
}
```

---

## 7. 关键设计模式

### 7.1 幂等性设计
- 前端生成 `crypto.randomUUID()` 作为 `idempotencyKey`
- Gateway 回传时在用户消息记录中保留该 id
- 支持基于 id 的乐观 ↔ 历史消息配对 (`isSameUserMessage`)

### 7.2 历史轮询机制
- 发送后立即启动 3 秒延迟 + 4 秒间隔轮询
- 仅在没有流式事件时执行 `loadHistory(true)`
- 90 秒安全超时自动标记失败

### 7.3 错误恢复
- 中间流错误设置 15 秒宽限期
- 宽限期内收到新 delta 自动清除错误
- 超时时保留部分流式内容作为快照

### 7.4 多会话运行时
- `runtimeBySessionKey` 缓存各会话的运行时状态
- 会话切换时保存/恢复运行时状态
- 后台会话的事件通过 `patchSessionRuntimeState` 更新

### 7.5 图片缓存
- `IMAGE_CACHE_KEY = 'stoclaw:image-cache'` (localStorage)
- 按文件路径索引，避免 runId 竞态
- 最大 100 条，LRU 淘汰

---

## 8. 文件清单

### 前端核心
| 文件 | 职责 |
|------|------|
| `src/stores/chat.ts` | 主 Zustand store，状态管理 |
| `src/stores/chat/types.ts` | 类型定义 (RawMessage, ChatSession, ChatState) |
| `src/stores/chat/session-actions.ts` | 会话创建/切换/删除/加载 |
| `src/stores/chat/runtime-send-actions.ts` | 消息发送、配额检查 |
| `src/stores/chat/runtime-event-actions.ts` | 事件入口过滤 |
| `src/stores/chat/runtime-event-handlers.ts` | 事件状态机处理 |
| `src/stores/chat/history-actions.ts` | 历史加载与合并 |
| `src/stores/chat/user-message-merge.ts` | 乐观消息合并与去重 |
| `src/lib/host-api.ts` | IPC 代理调用 |

### 后端核心
| 文件 | 职责 |
|------|------|
| `electron/main/ipc/host-api-proxy.ts` | IPC → Host API 代理 |
| `electron/api/routes/gateway.ts` | `/api/chat/*` 路由 |
| `electron/api/routes/sessions.ts` | `/api/sessions/*` 路由 |
| `electron/engines/openclaw-adapter.ts` | OpenClaw 引擎适配 |
| `electron/engines/claude-adapter.ts` | Claude SDK 引擎适配 |
| `electron/engines/manager.ts` | 引擎适配器选择 |
| `electron/engines/session-engine.ts` | 会话引擎类型解析 |
| `electron/engines/session-registry.ts` | 会话注册表 (SQLite) |
| `electron/engines/session-registry-types.ts` | 注册表类型定义 |
| `electron/gateway/manager.ts` | Gateway 进程管理、RPC |
| `electron/gateway/protocol.ts` | JSON-RPC 2.0 协议 |
| `electron/gateway/event-dispatch.ts` | 事件分发 |
| `electron/services/session-catalog-service.ts` | SQLite 会话目录 |
| `electron/services/workflow-session-writer.ts` | 工作流记录追加 |

### 共享类型
| 文件 | 职责 |
|------|------|
| `shared/session-type.ts` | 会话分类工具 |
| `shared/chat-session-trace.ts` | 调试追踪工具 |
| `shared/session-delete-routing.ts` | 会话删除路由 |
| `shared/session-agent-id.ts` | 会话键解析 |