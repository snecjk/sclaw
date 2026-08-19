## Why

SClaw webview 内的 `*.sto.cn` H5 页面目前只能通过 JSBridge 调用宿主的基础能力（鉴权、导航、存储等），**无法使用 SClaw 已有的 AI 引擎**。业务侧的典型诉求是：填报页把「任务指令 + 表单数据」交给 AI 做校验与内容优化，拿到结构化结果后回填页面。

现状下业务方只能各自接入外部模型，导致 API Key 分散、成本不可控、上下文与技能无法复用 SClaw 已沉淀的能力。SClaw 的 Main 进程已具备完整的无 UI agent 执行链路（定时任务在用），把它通过 JSBridge 暴露给受信 H5 是低边际成本的能力复用。

## What Changes

- 新增三个 Bridge 能力：`chat.complete`（一次性，P0）、`chat.cancel`（P0）、`chat.invokeAgent` + `chat:stream` 事件（流式，P1）
- AI 调用**全程在 Main 进程完成**：复用 `runMainChatSend` 发起运行，订阅 `ChatRuntimeSupervisor` 规范事件等待终态，一次性返回结果；不依赖聊天 UI 挂载
- 新增应用级 **AI Profile** 配置（`bridgePolicy.ai`）：默认 `enabled: false`，AI 能力必须显式开启，不随 catalog 绑定自动获得
- 新增 **Bridge AI 专属会话命名与隔离**：webview 发起的会话**不得出现在左侧对话列表**，默认不读写用户记忆
- `ChatRuntimePolicy.origin` 新增 `'bridge'` 取值，用于区分来源并支撑记忆/清理策略
- AI 调用使用**独立配额**，不复用通用 Bridge 限流

**不在本次范围内**：为单个 webview 微调或训练模型；Bridge 自动读写业务页面 DOM；Bridge 代替业务系统做数据查重（数据须由页面或工具提供）。

### 界面与主题影响

本次**不新增页面级 UI**。唯一用户可见面是首次调用时的 **consent 授权弹窗**，复用现有 Bridge consent 组件与既有主题令牌，不引入新配色。若实施中确需新增任何可见控件，必须使用 `docs/sto-design.md` 的语义令牌并同时覆盖**暗色模式**（禁止 `bg-white` 一类仅亮色硬编码）。Phase 5 的「设置页查看/撤销 AI 授权」若落地，需按同一标准单独补充暗色验收。

## Capabilities

### New Capabilities

- `jsbridge-ai-invocation`: H5 调用 AI 的请求/响应契约与 Main 端执行语义——`chat.complete` / `chat.cancel` / `chat.invokeAgent` 的参数与结果、终态判定、超时口径（三层对齐）、取消与中断、`responseFormat='json'` 的解析与失败降级、流式事件序列。
- `jsbridge-ai-app-profile`: 应用级 AI 配置契约——启用开关（默认关闭）、目标 agent、应用级 systemPrompt、默认技能与可追加技能白名单、记忆模式、会话模式、独立配额；以及配置缺失时的拒绝行为。
- `bridge-ai-session-isolation`: 会话与上下文隔离——Bridge AI 会话 key 的构造与识别契约（主/渲染共用）、**左侧对话列表不可见**、记忆读写隔离、`origin: 'bridge'` 标记、会话生命周期与清理。

### Modified Capabilities

无。`openspec/specs/` 现有能力（`cron-cloud-result-sync`、`cron-cloud-task`、`sqlite-dev-documentation`、`spec-*` 系列）均不涉及 JSBridge 或聊天会话可见性，本次不修改其需求。

侧边栏会话隐藏虽然要改动既有实现（`isSidebarHiddenChatSessionKey`），但该行为**当前没有对应的 spec 能力**，因此其规范化统一纳入新能力 `bridge-ai-session-isolation`，不产生 delta spec。

## Impact

### 受影响代码

| 范围 | 位置 |
|------|------|
| 新增 Main 服务 | `electron/main/services/jsbridge/bridge-ai-service.ts`、`bridge-ai-registry.ts`、`handlers/chat-ai.ts` |
| 新增主渲共用模块 | `shared/bridge-ai-session.ts`（会话 key 构造/sanitize/判定） |
| 协议扩展 | `shared/jsbridge/capabilities.ts`、`shared/jsbridge/trust-policy.ts`、`shared/chat-runtime-protocol.ts` |
| Bridge 分发 | `electron/main/services/jsbridge/dispatcher.ts`、`session-registry.ts` |
| **主链路（需评审）** | `electron/services/chat-send-service.ts`——记忆注入当前无条件执行，实现 `memory.mode: 'none'` 必须改动此共用函数 |
| 渲染进程（会话隐藏） | `src/lib/sto-task-session.ts`、`src/lib/sidebar-recent-order.ts` |
| SDK 与文档 | `packages/claw-bridge-sdk/`（`src/client.ts`、`types.ts`、`jsbridge-api.md`） |

### 风险与依赖

- **触及通信链路**：属工程红线范围，需技术评审；按项目规则实施后必须执行 `pnpm run comms:replay` 与 `pnpm run comms:compare`。
- **主链路回归面**：`runMainChatSend` 为主会话与定时任务共用，改动需回归两者。
- **两项前置假设未验证**，需在动工前以 spike 确认，否则主体设计可能返工：
  1. 引擎（OpenClaw / Claude 适配器）是否接受 Bridge 自造的 `sessionKey`；
  2. Main 侧能否仅凭 `message.delta` 拼出完整文本（否则需回退到读取 transcript）。
- **成本面**：每次调用是一次完整 agent 运行，配额缺失会显著推高 token 成本，故配额列为上线门槛。
- **数据面**：prompt 可能含 PII，审计日志只记元数据（appId／用户／长度），不记原文。

### 参考

详细技术论证见 `docs/jsbridge-ai-capability-design.md`（含调用链时序、超时口径、13 项风险与缓解）。
