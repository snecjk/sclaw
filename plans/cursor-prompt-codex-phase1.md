# Cursor Prompt: SClaw Codex Harness 集成 — Phase 1 MVP

## 任务概述

在 SClaw 项目（Electron + React + TypeScript）中，新增 **OpenAI Codex Harness** 作为第三引擎。

项目当前已支持两种引擎：
- `openclaw` — OpenClaw Gateway（主引擎）
- `claude` — Claude Agent SDK（次引擎）

你的任务是参考 `claude` 引擎的完整实现，新增 `codex` 引擎，使 Phase 1 MVP（基础对话跑通）可用。

---

## 项目背景

SClaw 是一个 Electron 桌面应用，AI 引擎通过统一的 `EngineAdapter` 接口接入。

### 关键抽象（已存在，无需修改）

```typescript
// electron/engines/types.ts
export type AgentEngineType = 'openclaw' | 'claude';  // 需要扩展为 'codex'

export interface EngineAdapter {
  type: AgentEngineType;
  chatCapabilities: EngineChatCapabilities;
  inspectRun(ctx, params): Promise<EngineRuntimeInspection>;
  classifyFinalMessage(input): 'completed' | 'awaiting_transcript' | 'progress';
  prepareMemoryInjection(params, memory): EngineSendParams;
  abortRun(ctx, params): Promise<{ success: boolean; error?: string }>;
  getHistory(ctx, params): Promise<{ success: boolean; result?: EngineHistoryResult; error?: string }>;
  getExecutionSnapshot(ctx, params): Promise<...>;
  listSessions(ctx): Promise<...>;
  sendMessage(ctx, params): Promise<{ success: boolean; result?: { runId?: string }; error?: string }>;
  sendMessageWithMedia(ctx, params): Promise<...>;
}
```

### 引擎注册（需要修改）

```typescript
// electron/engines/manager.ts
const adaptersByType = {
  openclaw: openClawAdapter,
  claude: claudeAdapter,
  // TODO: 新增 codex: codexAdapter
};
```

### 运行时监管（需要修改）

`ChatRuntimeSupervisor` 已标准化所有引擎的事件流，你只需要确保 Codex 适配器发出的事件符合 `NormalizedEngineEvent` 规范。

会话 Key 命名：
- OpenClaw: `agent:main:session-xxx`
- Claude: `claude:main:session-xxx`
- **Codex: `codex:main:session-xxx`** ← 新增

`inferEngineType` 需要增加：`sessionKey.startsWith('codex:')` 返回 `'codex'`。

---

## 参考实现（必须仔细阅读）

以下 Claude 引擎文件是你的核心参考，**请先通读这些文件再开始实现**：

| 参考文件 | 路径 | 职责 |
|---------|------|------|
| Claude Adapter | `electron/engines/claude-adapter.ts` | **最重要的参考**：EngineAdapter 完整实现、事件流转换、会话管理 |
| Claude SDK Runtime | `electron/engines/claude-sdk-runtime.ts` | Claude SDK 进程管理、会话 CRUD、消息获取 |
| Claude Stream Content | `electron/engines/claude-stream-content.ts` | 流式内容累加器（text/thinking/tool_input） |
| Claude Execution Snapshot | `electron/engines/claude-execution-snapshot.ts` | 执行历史解析为 ExecutionSnapshot |
| Claude Session Recovery | `electron/engines/claude-session-recovery.ts` | 会话恢复、归档逻辑 |
| Runtime Supervisor | `electron/services/chat-runtime-supervisor.ts` | 理解事件流状态机（只需要读 `inferEngineType` 和事件处理部分） |
| Engine Manager | `electron/engines/manager.ts` | 理解引擎注册方式 |
| Engine Types | `electron/engines/types.ts` | 理解 EngineAdapter 接口定义 |
| Normalized Event | `electron/gateway/normalized-engine-event.ts` | 理解 NormalizedEngineEvent 结构 |

---

## 技术方案文档

完整的集成方案已写在：

**`/Users/sto/Documents/copyProject/sto-claw/plans/codex-harness-integration-spec.md`**

该文档包含：
- 目标架构设计
- Codex App Server 协议说明（JSON-RPC over stdio）
- 事件流映射（Codex 原生事件 → SClaw NormalizedEngineEvent）
- 审批流集成方案
- 文件实现清单
- 关键代码片段

**请结合该方案文档和 Claude 参考实现进行编码。**

---

## Phase 1 目标：MVP 基础对话跑通

### 验收标准

1. 在 SClaw 中创建 `codex:` 前缀的会话
2. 发送消息 "Hello"，Codex 返回流式回复
3. 对话历史可正常加载
4. 与 OpenClaw/Claude 引擎互不干扰

### 不需要在 Phase 1 实现（留到 Phase 2）

- 工具调用（file_edit / bash）
- 审批弹窗
- 沙箱策略
- Skills 同步
- MCP 桥接
- 图片/多媒体输入
- 定时任务桥接

---

## 需要实现的文件清单

### 新增文件（按优先级排序）

| 优先级 | 文件路径 | 说明 |
|-------|----------|------|
| P0 | `shared/codex-protocol.ts` | Codex App Server JSON-RPC 类型定义（Thread, Turn, Item, 请求/响应结构） |
| P0 | `electron/engines/codex-app-server-runtime.ts` | Codex CLI 进程管理：检测安装、启动 `codex app-server` 子进程、JSON-RPC 通信封装 |
| P0 | `electron/engines/codex-adapter.ts` | **核心文件**：EngineAdapter 实现，事件流转换 |
| P1 | `electron/engines/codex-stream-content.ts` | 流式内容累加器（参考 `claude-stream-content.ts`） |
| P1 | `electron/engines/codex-session-recovery.ts` | 会话恢复、thread 归档逻辑 |
| P2 | `electron/services/codex-auth-service.ts` | 认证管理：API Key 读取（从现有 Provider 体系获取） |

### 修改文件

| 优先级 | 文件路径 | 修改点 |
|-------|----------|--------|
| P0 | `electron/engines/types.ts` | `AgentEngineType` 增加 `'codex'` |
| P0 | `electron/engines/manager.ts` | `adaptersByType` 增加 `codex: codexAdapter`；`resolveAgentEngineType` 增加 codex 分支 |
| P0 | `electron/services/chat-runtime-supervisor.ts` | `inferEngineType` 增加 `sessionKey.startsWith('codex:')` |

---

## 关键实现要求

### 1. Codex App Server 进程管理

Codex 通过 CLI 启动 App Server：

```bash
codex app-server
```

通信协议：**JSON-RPC over stdio**（JSON Lines 格式）。

你的 `codex-app-server-runtime.ts` 需要：
- 检测 `codex` 是否已安装（`codex --version`）
- 每个 session 启动一个 `codex app-server` 子进程（或通过 thread 复用同一进程）
- 通过 stdin 写入 JSON-RPC 请求，从 stdout 读取响应/通知
- 进程异常退出时清理资源

**参考**：`claude-sdk-runtime.ts` 中的 `prepareClaudeRuntime`、`ensureClaudeRuntimeReady`。

### 2. JSON-RPC 客户端

你需要一个轻量的 JSON-RPC 客户端（可内联在 runtime 文件中）：

```typescript
class CodexJsonRpcClient {
  private requestId = 0;
  private pending = new Map<number, { resolve, reject }>();
  
  // 发送请求，返回 Promise<响应>
  async call(method: string, params: unknown): Promise<unknown>;
  
  // 处理服务器推送的通知
  onNotification?: (notification: { method: string; params: unknown }) => void;
}
```

**Codex App Server 关键方法**：
- `initialize` — 握手
- `thread/create` — 创建会话
- `thread/resume` — 恢复会话
- `turn/submit` — 提交用户消息
- `turn/cancel` — 取消当前 turn

**Codex App Server 推送通知**：
- `item/delta` — 内容增量（流式）
- `item/completed` — 内容块完成
- `turn/completed` — 本轮完成
- `approval/request` — 请求审批（Phase 2 再处理）

### 3. 事件流转换（最关键）

Codex 的 `item/delta` 需要映射为 SClaw 的 `NormalizedEngineEvent`：

```typescript
// Codex item/delta (text)
→ SClaw {
    type: 'message.delta',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '...' }]
    }
  }

// Codex item/completed
→ SClaw {
    type: 'message.final',
    message: {
      role: 'assistant',
      content: [...]
    }
  }

// Codex turn/completed
→ SClaw {
    type: 'turn.completed'
  }
// 同时触发：eventSink.emit('notification', { method: 'agent', params: { phase: 'completed', runId, sessionKey } })

// Codex turn/failed
→ SClaw {
    type: 'turn.failed',
    errorMessage: '...'
  }
```

**参考**：`claude-adapter.ts` 中的 `consumeClaudeQuery` 函数，这是 Claude 事件流消费的核心循环。你的 Codex 版本需要类似的 `consumeCodexStream` 函数。

### 4. 会话生命周期

```
用户发送消息
  → sendMessage() 被调用
  → 检查/启动 App Server 进程
  → 调用 thread/create 或 thread/resume 获取 thread_id
  → 调用 turn/submit 提交消息
  → 启动事件消费循环（监听 item/delta, item/completed, turn/completed）
  → 事件通过 gatewayManager.emit('chat:message', ...) 发送到渲染层
  → 渲染层显示流式回复
```

### 5. 认证

Phase 1 简化处理：从现有 Provider 体系读取 OpenAI API Key。

```typescript
// electron/services/codex-auth-service.ts
export async function resolveCodexApiKey(): Promise<string> {
  // 从 electron/services/providers/ 或 secrets/ 中读取已配置的 OpenAI API Key
  // 或从 codex CLI 的本地配置中读取（~/.config/codex/auth.json）
}
```

**注意**：Codex CLI 有自己的认证文件（`~/.config/codex/auth.json`），优先复用用户的 Codex CLI 配置。

### 6. 错误处理

必须处理的错误场景：
- Codex CLI 未安装 → 返回友好错误提示
- App Server 进程崩溃 → 清理资源，标记会话失败
- JSON-RPC 通信超时 → 重试或失败
- 认证失败 → 提示用户配置 API Key

---

## 代码风格要求

1. **严格遵循项目现有风格**：
   - 使用单引号
   - 不使用分号（项目配置）
   - 类型优先用 `interface` 而非 `type`
   - 错误日志使用 `logger.warn` / `logger.error`

2. **文件结构对齐**：
   ```
   electron/engines/
   ├── codex-app-server-runtime.ts    # 进程管理 + JSON-RPC
   ├── codex-adapter.ts               # EngineAdapter 实现
   ├── codex-stream-content.ts        # 流式累加器
   └── codex-session-recovery.ts      # 会话恢复
   ```

3. **命名约定**：
   - 函数/变量：camelCase
   - 类型/接口：PascalCase
   - 常量：SCREAMING_SNAKE_CASE

---

## 输出要求

请按以下顺序输出代码：

1. **`shared/codex-protocol.ts`** — 类型定义（Thread, Turn, Item, JSON-RPC 结构）
2. **`electron/engines/codex-app-server-runtime.ts`** — App Server 进程管理 + JSON-RPC 客户端
3. **`electron/engines/codex-adapter.ts`** — EngineAdapter 实现（核心文件）
4. **`electron/engines/codex-stream-content.ts`** — 流式内容累加器
5. **修改点摘要** — `types.ts`、`manager.ts`、`chat-runtime-supervisor.ts` 的精确修改内容

每个文件请包含：
- 文件顶部注释说明职责
- 所有 import 语句
- 完整类型定义
- 完整函数实现
- 关键逻辑注释

---

## 调试提示

实现完成后，可通过以下方式验证：

1. 在 SClaw 中创建新会话，选择 "Codex" 引擎
2. 观察 Electron Main 进程日志（`logger.info` / `logger.debug`）
3. 确认 App Server 进程已启动：`ps aux | grep "codex app-server"`
4. 检查 JSON-RPC 通信是否正常（可在 runtime 文件中临时添加 console.log）
5. 渲染层应收到 `message.delta` 和 `message.final` 事件

---

## 参考资料

- **技术方案文档**：`/Users/sto/Documents/copyProject/sto-claw/plans/codex-harness-integration-spec.md`
- **Claude 适配器（核心参考）**：`electron/engines/claude-adapter.ts`
- **Claude SDK 运行时（核心参考）**：`electron/engines/claude-sdk-runtime.ts`
- **引擎抽象接口**：`electron/engines/types.ts`
- **标准化事件定义**：`electron/gateway/normalized-engine-event.ts`
- **运行时监管**：`electron/services/chat-runtime-supervisor.ts`
- **Codex App Server 协议**：https://openai.com/index/unlocking-the-codex-harness/
