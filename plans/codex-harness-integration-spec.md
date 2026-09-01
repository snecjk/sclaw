# SClaw 编程能力技术升级方案 — Codex Harness 集成

> **版本**: v1.0  
> **日期**: 2026-08-23  
> **范围**: 仅聚焦编程能力的技术升级，在现有 OpenClaw + Claude Code 双引擎基础上，新增 Codex Harness 作为第三引擎  
> **目标读者**: Cursor / 代码实现者

---

## 一、方案概述

### 1.1 背景

SClaw 当前已支持两种 AI 引擎：
- **OpenClaw Gateway**（主引擎）：通用对话、工作流、定时任务
- **Claude Agent SDK**（次引擎）：代码生成、工具调用、Agent 执行

为了提升**编程与建站能力**，本方案引入 **OpenAI Codex Harness** 作为第三引擎。Codex 在前端框架理解、代码 diff 生成、Skills 系统、沙箱安全执行等方面有原生优化，与现有 Claude 引擎形成互补。

### 1.2 核心原则

1. **零侵入现有引擎**：OpenClaw 和 Claude 引擎不做任何改动
2. **复用现有抽象**：沿 `EngineAdapter` 接口扩展，复用 `ChatRuntimeSupervisor` 运行时
3. **会话级引擎切换**：用户可在聊天会话中切换引擎（类似现有 Claude/OpenClaw 切换）
4. **渐进式落地**：先跑通基础对话，再接入 Skills、沙箱、MCP

### 1.3 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 集成协议 | Codex App Server (JSON-RPC over stdio) | 稳定协议，支持流式事件、审批交互、工具调用 |
| 认证方式 | ChatGPT OAuth / OpenAI API Key | 与现有 Provider 认证体系对齐 |
| 进程模型 | Electron Main 子进程 | 与 OpenClaw Gateway 进程管理对齐 |
| 前端渲染 | 复用现有聊天组件 | 事件流已标准化，无需新建 UI |

---

## 二、现有架构分析

### 2.1 引擎抽象层

```typescript
// electron/engines/types.ts
export type AgentEngineType = 'openclaw' | 'claude';   // ← 扩展为 'openclaw' | 'claude' | 'codex'

export interface EngineAdapter {
  type: AgentEngineType;
  chatCapabilities: EngineChatCapabilities;
  inspectRun(...): Promise<EngineRuntimeInspection>;
  classifyFinalMessage(...): 'completed' | 'awaiting_transcript' | 'progress';
  prepareMemoryInjection(...): EngineSendParams;
  abortRun(...): Promise<{ success: boolean; error?: string }>;
  getHistory(...): Promise<{ success: boolean; result?: EngineHistoryResult; error?: string }>;
  getExecutionSnapshot(...): Promise<...>;
  listSessions(...): Promise<...>;
  sendMessage(...): Promise<{ success: boolean; result?: { runId?: string }; error?: string }>;
  sendMessageWithMedia(...): Promise<...>;
}
```

### 2.2 引擎注册与路由

```typescript
// electron/engines/manager.ts
const adaptersByType = {
  openclaw: openClawAdapter,
  claude: claudeAdapter,
  // ← 新增 codex: codexAdapter
};
```

### 2.3 运行时状态机

`ChatRuntimeSupervisor` 已标准化所有引擎的事件流：
- `run.dispatching` → `run.accepted` → `message.delta` → `tool.updated` → `run.completed`
- 引擎差异由各自的 `EngineAdapter` 屏蔽

### 2.4 Claude 集成参考

Claude 引擎的完整实现分布在以下文件，是 Codex 集成的最佳参考：

| 文件 | 职责 | Codex 对应文件 |
|------|------|----------------|
| `claude-sdk-runtime.ts` | Claude SDK 进程管理、会话 CRUD | `codex-app-server-runtime.ts` |
| `claude-adapter.ts` | EngineAdapter 实现、事件流转换 | `codex-adapter.ts` |
| `claude-stream-content.ts` | 流式内容累加器 | `codex-stream-content.ts` |
| `claude-execution-snapshot.ts` | 执行快照解析 | `codex-execution-snapshot.ts` |
| `claude-session-recovery.ts` | 会话恢复逻辑 | `codex-session-recovery.ts` |
| `claude-runtime-extensions.ts` | 运行时扩展选项 | `codex-runtime-extensions.ts` |

---

## 三、目标架构设计

### 3.1 新增引擎后的架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        SClaw Electron App                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              React Renderer Process                          │ │
│  │  • 聊天 UI（复用，引擎无关）                                  │ │
│  │  • 引擎选择器（新增 Codex 选项）                               │ │
│  │  • 审批弹窗（复用）                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              │ IPC                                │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Electron Main Process                           │ │
│  │                                                               │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │   OpenClaw  │  │   Claude    │  │   Codex App Server  │  │ │
│  │  │   Adapter   │  │   Adapter   │  │   Adapter (新增)    │  │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │ │
│  │         │                │                     │             │ │
│  │         └────────────────┴─────────────────────┘             │ │
│  │                          │                                   │ │
│  │              ┌───────────▼───────────┐                       │ │
│  │              │ ChatRuntimeSupervisor │                       │ │
│  │              │   (复用，无改动)       │                       │ │
│  │              └───────────────────────┘                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
            ┌──────────────┐     ┌──────────────┐
            │ Claude SDK   │     │ Codex CLI    │
            │ (子进程)      │     │ (子进程)      │
            └──────────────┘     └──────────────┘
```

### 3.2 会话 Key 命名规则

沿用现有约定：
- OpenClaw: `agent:main:session-xxx`
- Claude: `claude:main:session-xxx` 或 `claude-task:xxx`
- **Codex: `codex:main:session-xxx`** ← 新增

`inferEngineType` 在 `chat-runtime-supervisor.ts` 中已处理：
```typescript
function inferEngineType(sessionKey: string): AgentEngineType {
  if (sessionKey.startsWith('claude:') || sessionKey.startsWith('claude-task:')) return 'claude';
  if (sessionKey.startsWith('codex:')) return 'codex';   // ← 新增
  return 'openclaw';
}
```

---

## 四、核心接口与数据流

### 4.1 Codex App Server 协议

Codex App Server 通过 **JSON-RPC over stdio** 通信，关键方法：

| 方法 | 方向 | 说明 |
|------|------|------|
| `thread/create` | Client → Server | 创建新会话 |
| `thread/resume` | Client → Server | 恢复已有会话 |
| `turn/submit` | Client → Server | 提交用户消息 |
| `turn/approve` | Client → Server | 审批工具调用 |
| `item/delta` | Server → Client | 流式内容增量 |
| `item/completed` | Server → Client | 内容块完成 |
| `turn/completed` | Server → Client | 本轮完成 |
| `approval/request` | Server → Client | 请求用户审批 |

### 4.2 事件流映射

Codex 原生事件 → SClaw `NormalizedEngineEvent` 映射：

```
Codex                          SClaw NormalizedEvent
─────────────────────────────────────────────────────────
turn/submit response           { type: 'turn.started' }
item/delta (text)              { type: 'message.delta', message: { role: 'assistant', content: [...] } }
item/completed                 { type: 'message.final', message: { role: 'assistant', content: [...] } }
tool/execute (item)            { type: 'tool.result', message: { role: 'tool', ... } }
approval/request               → 触发 UI 审批弹窗，用户确认后发送 turn/approve
turn/completed                 { type: 'turn.completed' }
turn/failed                    { type: 'turn.failed', errorMessage: ... }
```

### 4.3 审批流集成

Codex 的审批请求通过 App Server 的 `approval/request` 事件发出。SClaw 需要：

1. 在 `codex-adapter.ts` 中监听 `approval/request`
2. 转换为现有审批弹窗数据结构（与 Claude `bypassPermissions` / OpenClaw 审批对齐）
3. 用户确认后，通过 `turn/approve` 或 `turn/deny` 回传

---

## 五、文件实现清单

### 5.1 新增文件

| # | 文件路径 | 参考实现 | 职责 |
|---|----------|----------|------|
| 1 | `electron/engines/codex-app-server-runtime.ts` | `claude-sdk-runtime.ts` | Codex CLI 进程管理、App Server 启停、JSON-RPC 通信 |
| 2 | `electron/engines/codex-adapter.ts` | `claude-adapter.ts` | `EngineAdapter` 实现、Codex 事件流 → SClaw 事件流转换 |
| 3 | `electron/engines/codex-stream-content.ts` | `claude-stream-content.ts` | Codex 流式文本/工具输入累加器 |
| 4 | `electron/engines/codex-execution-snapshot.ts` | `claude-execution-snapshot.ts` | Codex 执行历史解析为 ExecutionSnapshot |
| 5 | `electron/engines/codex-session-recovery.ts` | `claude-session-recovery.ts` | 会话恢复、thread 归档逻辑 |
| 6 | `electron/engines/codex-runtime-extensions.ts` | `claude-runtime-extensions.ts` | Codex 运行时选项构建（sandbox 策略、model 选择） |
| 7 | `electron/engines/codex-model-selection.ts` | `claude-model-selection.ts` | Codex 模型选择逻辑（gpt-5.6-sol / gpt-5.4 等） |
| 8 | `electron/services/codex-auth-service.ts` | — | Codex 认证管理（OAuth / API Key、token 刷新） |
| 9 | `electron/services/codex-skill-bridge.ts` | `claude-skill-bridge.ts` | Codex Skills 同步（.agents/skills → Codex Skills） |
| 10 | `shared/codex-protocol.ts` | — | Codex App Server JSON-RPC 类型定义 |

### 5.2 修改文件

| # | 文件路径 | 修改点 |
|---|----------|--------|
| 1 | `electron/engines/types.ts` | `AgentEngineType` 增加 `'codex'` |
| 2 | `electron/engines/manager.ts` | `adaptersByType` 增加 `codex: codexAdapter`；`resolveAgentEngineType` 增加 codex 分支 |
| 3 | `electron/services/chat-runtime-supervisor.ts` | `inferEngineType` 增加 `sessionKey.startsWith('codex:')` 分支 |
| 4 | `src/types/agent.ts` | 引擎类型枚举增加 `'codex'` |
| 5 | `src/stores/chat/resolve-send-target.ts` | 发送目标解析增加 codex 分支 |
| 6 | `src/components/chat/EngineSelector.tsx` | UI 增加 Codex 选项（如有） |

### 5.3 可选增强文件（Phase 2+）

| # | 文件路径 | 说明 |
|---|----------|------|
| 1 | `electron/services/codex-sandbox-service.ts` | 沙箱策略配置（workspace-write / readonly-safe / dangerous-bypass） |
| 2 | `electron/services/codex-mcp-bridge.ts` | MCP Server 桥接（将 SClaw MCP 工具暴露给 Codex） |
| 3 | `electron/services/codex-scheduled-task-bridge.ts` | 定时任务桥接（类似 `claude-workflow-session-writer.ts`） |

---

## 六、实施步骤

### Phase 1：MVP 跑通基础对话（1 周）

**目标**：在 SClaw 中发送消息给 Codex，接收流式回复，完成一次完整对话。

**任务清单**：

1. **定义协议类型**（`shared/codex-protocol.ts`）
   - 定义 JSON-RPC 请求/响应结构
   - 定义 Thread、Turn、Item 类型
   - 定义 approval/request 数据结构

2. **实现 App Server 运行时**（`codex-app-server-runtime.ts`）
   - 检测 `codex` CLI 是否安装 (`codex --version`)
   - 启动 `codex app-server` 子进程（JSON-RPC over stdio）
   - 管理 thread 生命周期（create / resume / archive）
   - 请求方法封装：`thread.create`、`turn.submit` 等

3. **实现 EngineAdapter**（`codex-adapter.ts`）
   - 实现 `EngineAdapter` 所有方法
   - `sendMessage`：调用 App Server 发送消息
   - `getHistory`：从 Codex thread 读取历史
   - `abortRun`：发送 turn/cancel 或中断子进程
   - 事件流转换：Codex item/delta → SClaw message.delta

4. **注册引擎**
   - 修改 `types.ts` / `manager.ts` / `chat-runtime-supervisor.ts`
   - 在 `adaptersByType` 中注册 codex 适配器

5. **前端引擎选择**
   - 在新建会话/设置中增加 "Codex" 引擎选项
   - 会话 key 以 `codex:` 前缀创建

**验收标准**：
- [ ] 在 SClaw 中切换到 Codex 引擎，发送 "Hello"
- [ ] 看到 Codex 的流式回复
- [ ] 对话历史可正常加载
- [ ] 与 OpenClaw/Claude 引擎互不干扰

### Phase 2：工具调用与审批（1 周）

**目标**：Codex 可执行文件读写、Bash 命令，审批弹窗正常工作。

**任务清单**：

1. **工具调用映射**
   - Codex 的 `file_edit`、`bash` 工具 → SClaw `tool.updated` 事件
   - 在渲染层显示工具卡片（复用现有组件）

2. **审批流集成**
   - 监听 `approval/request` 事件
   - 转换为现有审批弹窗数据结构
   - 用户确认后发送 `turn/approve`
   - 用户拒绝后发送 `turn/deny`

3. **沙箱策略配置**
   - 实现 `EnginePermissionProfile` 映射：
     - `readonly-safe` → Codex sandbox 只读模式
     - `workspace-write` → Codex 默认沙箱（可写工作区）
     - `dangerous-bypass` → `--sandbox full-access`

4. **错误处理**
   - Codex 执行失败 → `turn.failed` → 渲染层显示错误

**验收标准**：
- [ ] Codex 请求编辑文件时，弹出审批确认
- [ ] 用户批准后，文件被正确修改
- [ ] 用户拒绝后，Codex 收到拒绝响应并继续
- [ ] 沙箱生效（无法读取工作区外敏感文件）

### Phase 3：Skills 与建站优化（1-2 周）

**目标**：让 Codex 具备专业建站能力。

**任务清单**：

1. **Skills 同步**
   - 将 SClaw Skills（`electron/services/skills/`）转换为 Codex Skills（`~/.agents/skills/` 或 `.agents/skills/`）
   - 实现 `codex-skill-bridge.ts` 自动同步

2. **建站专用 Skill**
   - 创建 `website-building` Skill：
     ```markdown
     # Skill: website-building
     
     ## 技术栈
     - React 19 + TypeScript
     - Vite (build tool)
     - Tailwind CSS + shadcn/ui
     - React Router
     
     ## 项目结构
     - `src/components/` — 组件
     - `src/pages/` — 页面
     - `src/lib/` — 工具函数
     - `src/hooks/` — Hooks
     
     ## 约束
     - 所有组件使用函数式组件 + Hooks
     - 样式优先使用 Tailwind 工具类
     - 图标使用 lucide-react
     - 表单使用 react-hook-form + zod
     ```

3. **预览集成**
   - 复用现有 `app-dev-service.ts` / `app-dev-server-manager.ts`
   - Codex 生成的网站可在 SClaw 内嵌预览

4. **多 Agent 协作**
   - Codex 负责代码生成
   - Claude 负责代码审查
   - OpenClaw 负责部署工作流

**验收标准**：
- [ ] 说 "帮我建一个待办事项网站"，Codex 自动创建完整项目
- [ ] 生成的项目可直接 `npm run dev` 运行
- [ ] Skills 规则被遵守（如使用 shadcn/ui 组件）

---

## 七、关键代码片段

### 7.1 App Server 进程启动

```typescript
// electron/engines/codex-app-server-runtime.ts
import { spawn } from 'node:child_process';

interface CodexAppServerProcess {
  process: ReturnType<typeof spawn>;
  rpc: JsonRpcClient;
  threadId?: string;
}

const activeAppServers = new Map<string, CodexAppServerProcess>();

export async function startCodexAppServer(sessionKey: string): Promise<CodexAppServerProcess> {
  const existing = activeAppServers.get(sessionKey);
  if (existing) return existing;

  const proc = spawn('codex', ['app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // 认证信息从 codex-auth-service 获取
      OPENAI_API_KEY: await resolveCodexApiKey(),
    },
  });

  const rpc = new JsonRpcClient(proc.stdin, proc.stdout);
  
  // 等待 App Server ready
  await rpc.call('initialize', { protocolVersion: '2025-06-02' });

  const server = { process: proc, rpc };
  activeAppServers.set(sessionKey, server);
  
  return server;
}
```

### 7.2 EngineAdapter 骨架

```typescript
// electron/engines/codex-adapter.ts
import type { EngineAdapter, EngineAdapterContext, EngineSendParams } from './types';

export const codexAdapter: EngineAdapter = {
  type: 'codex',
  
  chatCapabilities: {
    hasReliableRuntimeStatus: true,
    hasStructuredReasoningEvents: true,
    hasStructuredToolEvents: true,
    requiresHistoryProjection: false,   // Codex 有完整实时事件流
  },

  async sendMessage(ctx, params: EngineSendParams) {
    const server = await startCodexAppServer(params.sessionKey);
    
    // 创建或恢复 thread
    if (!server.threadId) {
      const thread = await server.rpc.call('thread/create', {
        // 可选：注入 system prompt / skills
      });
      server.threadId = thread.id;
    }

    // 提交用户消息
    const turn = await server.rpc.call('turn/submit', {
      thread_id: server.threadId,
      items: [{ type: 'message', role: 'user', content: params.message }],
    });

    // 启动事件消费循环
    consumeCodexStream(params.sessionKey, server, turn.id, ctx.gatewayManager);

    return { success: true, result: { runId: turn.id } };
  },

  async getHistory(ctx, params) {
    // 从 Codex thread 读取历史，转换为 EngineHistoryResult
    // ...
  },

  async abortRun(ctx, params) {
    const server = activeAppServers.get(params.sessionKey);
    if (!server) return { success: false, error: 'No active App Server' };
    await server.rpc.call('turn/cancel', { thread_id: server.threadId });
    return { success: true };
  },

  // ... 其他方法实现
};
```

### 7.3 事件流消费循环

```typescript
// electron/engines/codex-adapter.ts (内部函数)

async function consumeCodexStream(
  sessionKey: string,
  server: CodexAppServerProcess,
  turnId: string,
  eventSink: EventEmitter,
) {
  const runId = turnId;
  let seq = 0;

  const emitEngineEvent = (event: NormalizedEngineEvent) => {
    eventSink.emit('chat:message', toLegacyChatMessagePayload({
      ...event, runId, sessionKey, seq: seq++,
    }));
  };

  // 监听 App Server 推送的事件
  server.rpc.onNotification = async (notification) => {
    switch (notification.method) {
      case 'item/delta': {
        const delta = notification.params;
        if (delta.type === 'text') {
          emitEngineEvent({
            type: 'message.delta',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: delta.text }],
            },
          });
        }
        break;
      }
      
      case 'item/completed': {
        emitEngineEvent({
          type: 'message.final',
          message: {
            role: 'assistant',
            content: notification.params.content,
          },
        });
        break;
      }

      case 'approval/request': {
        // 触发审批弹窗
        eventSink.emit('codex:approval-request', {
          sessionKey,
          runId,
          tool: notification.params.tool,
          args: notification.params.arguments,
        });
        break;
      }

      case 'turn/completed': {
        eventSink.emit('notification', {
          method: 'agent',
          params: { phase: 'completed', runId, sessionKey },
        });
        break;
      }
    }
  };
}
```

---

## 八、风险评估与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| Codex CLI 未安装 | 无法启动 App Server | 中 | 首次使用时引导用户安装；提供一键安装脚本 |
| ChatGPT OAuth 过期 | 认证失效 | 中 | 实现 token 自动刷新；过期后引导重新登录 |
| 沙箱限制导致命令失败 | Codex 无法执行某些操作 | 低 | 清晰报错提示；提供 "提升权限" 快捷入口 |
| 事件流格式不兼容 | 渲染层显示异常 | 低 | 严格遵循 NormalizedEngineEvent 规范；充分测试 |
| 三引擎并发资源占用 | 内存/CPU 压力 | 低 | App Server 按需启动；空闲时自动关闭 |
| Codex 模型更新导致行为变化 | 功能异常 | 低 | 锁定 App Server 协议版本；关注 OpenAI 更新公告 |

---

## 九、附录

### 9.1 相关文件速查

| 用途 | 路径 |
|------|------|
| 引擎抽象接口 | `electron/engines/types.ts` |
| 引擎管理器 | `electron/engines/manager.ts` |
| 运行时监管 | `electron/services/chat-runtime-supervisor.ts` |
| Claude 适配器（参考） | `electron/engines/claude-adapter.ts` |
| Claude SDK 运行时（参考） | `electron/engines/claude-sdk-runtime.ts` |
| Claude 流式处理（参考） | `electron/engines/claude-stream-content.ts` |
| Gateway 管理器 | `electron/gateway/manager.ts` |
| 标准化事件 | `electron/gateway/normalized-engine-event.ts` |
| 运行时协议 | `shared/chat-runtime-protocol.ts` |

### 9.2 外部参考

- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)
- [Codex App Server Protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server)
- [Codex Skills](https://github.com/openai/skills)
- [Codex Sandbox](https://developers.openai.com/codex/sandboxing)
