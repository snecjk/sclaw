# Claude 引擎含工作流钉钉不发送问题

## Context（为什么改）

**现象**：含工作流的 Claude 定时任务，短工作流（<5 分钟）能发出钉钉结果通知；10 分钟级长工作流不发。

**根因**：`claude-task-run:` 会话走 `electron/services/claude-task-worker.ts`，`timeoutSec` 默认 300（5 分钟，见 `claude-scheduled-task-service.ts:120`）。`get_workflow_status` 是单次非阻塞 GET，agent 必须反复轮询直到 `completed`。10 分钟工作流在第 5 分钟被 `setTimeout → query.close()` 硬掐断，agent 还卡在轮询循环里，`dws chat message send` 从未执行 → run 标记 `timed_out`，收件人沉默。

**范围**：本次**仅修 Claude 引擎**。OpenClaw 引擎的 agent 跑在 `build/openclaw/openclaw.mjs` 编译产物内，本仓无源码、无硬杀超时点，若其长工作流也不发钉钉属另一根因，需单独排查，不在本次改动内。

**目标**：
- 方案1：含工作流的新任务默认给到 30 分钟超时上限，覆盖真实工作流时长。
- 方案2：即便超时被掐断，worker 自己接管"轮询到完成 → 发钉钉结果"的兜底，保证长工作流结果不沉默。

## 关键事实（探索结论）

- 收件人 JSON 嵌在 `definition.promptTemplate`（`[STOCLAW:DINGTALK_RECIPIENTS:v1]` marker + ```json 块）；`SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT`（`shared/scheduled-task-instruction.ts`）要求 agent 从 message 中读取。→ worker 可从 `promptTemplate` 解析收件人。
- `ClaudeScheduledTaskDefinition`（`electron/services/claude-scheduled-task-store.ts`）有 `workflowCode?`、`promptTemplate`、`timeoutSec`，但**无** dingtalk 收件人字段、**无** workflow runId 字段。→ runId 必须从 SDK 消息流实时捕获。
- `WorkflowExecutionTracker` 只追踪 renderer 启动的工作流，headless `claude-task-run:` 不入库，且按 runId 而非 sessionKey 索引。→ 不可复用，worker 须自建捕获。
- `onMessage`（`claude-task-worker.ts:116`）对每条 user/assistant/result 消息触发，含 synthetic `user` 携带 `tool_result` 块的消息（`consumeClaudeQuery` 内部 `extractWorkflowToolResult` 已证实）。→ 是捕获 runId / dws 已发的正确挂钩点。
- 工作流状态 API：`GET /agent/v1/runs/{runId}`，返回 `WorkflowRunApiPayload`（`shared/workflow-run-status.ts`，含 `output`/`result.summary`/`result.artifacts`/`nodeRuns`）。已有 `resolveWorkflowRunStatus`、`workflowRunResponseToExecutionState`、`isActiveWorkflowRunStatus`、`isTerminalWorkflowRunStatus`、`collectAllRunArtifacts` 可复用。
- 认证：`resolveStoBaseUrl()`（`electron/utils/sto-domain.ts`）+ `getStoToken()`（`electron/utils/auth-store.ts`）+ `proxyAwareFetch`（`electron/utils/proxy-fetch.ts`），全局 SSO，无需 `providerAccountId`。
- 发钉钉：无现成高级函数；用 `runDws(['chat','message','send','--user'|'--group',id,'--title',t,'--text',body,'--format','json'])`（`electron/utils/dws-cli.ts`）。正文经 `normalizeDwsChatMessageSendText`（`shared/dws-send-text.ts`）追加代发说明。
- 收件人结构（`shared/dingtalk-mention-context.ts`）：`{version,source,recipients:[{type:'user'|'group',displayName,userId?,openConversationId?,corpId?}]}`。有 `messageHasDingTalkRecipientContext` 检测，但**无**解析器 → 需新增。

## 改造后的工作流程

```
[创建] MyTask 选 claude 引擎 + 工作流 + 收件人
  → claude-scheduled-task-service 创建时 looksLikeWorkflowTask(input) 命中 → 默认 timeoutSec=1800
  → 落 definitions.json

[调度执行] cron 到点 → ClaudeTaskWorker.runTask → executeClaudeTask → sdk.query
  → onMessage 实时捕获：
      • get_workflow_status 的 input.runId → workflowRunIds
      • Bash 'dws chat message send' 的 tool_use id → 待配对
      • execute_workflow 响应 JSON 里的 runId → workflowRunIds
      • 对应 tool_result 非 error → dingtalkAlreadySent=true
  → 短工作流：5 分钟内 completed，agent 自己发钉钉，dingtalkAlreadySent=true，run succeeded，不走兜底

[超时兜底] 即便默认 1800 仍可能超时（或老任务仍是 300）
  → 到点 query.close()，agent 被掐断，run 立即标记 timed_out 并返回（不阻塞）
  → 返回前判断：workflowRunIds 非空 && !dingtalkAlreadySent
      → fire-and-forget sendWorkflowFallbackOnTimeout(...)（不 await）
  → 兜底后台（最长 30 分钟）：
      1. parseDingTalkRecipientsFromText(promptTemplate) 取收件人；无则早退
      2. pollWorkflowRunsUntilTerminal(runIds)：每 5s 并发 GET /agent/v1/runs/{runId}
         用 resolveWorkflowRunStatus 判态，直到全部 terminal 或 30 分钟到
      3. workflowRunResponseToExecutionState 转：
         completed → result.summary + artifacts
         failed/timeout → error
         仍 running → 提示去 StoClaw 查看
         多 run 合并一条正文
      4. 对每个收件人 runDws(['chat','message','send',...]) 逐个 try/catch 不抛
  → 收件人在工作流真正完成后收到结果钉钉（仅晚几分钟～几十分钟）
```

**防重发**：`dingtalkAlreadySent`（agent 已成功发过）→ 跳过；`workflowRunIds` 为空（非工作流任务）→ 跳过，普通任务超时行为不变；无收件人 → 跳过。

## 实现步骤

### 1. 新增收件人解析器（shared，可单测）
**文件**：`shared/dingtalk-mention-context.ts`
- 新增 `parseDingTalkRecipientsFromText(text: string): DingTalkMention[] | null`：用 `messageHasDingTalkRecipientContext` 检测；定位 `DINGTALK_RECIPIENTS_MARKER`，取其后第一个 ```json ... ``` 代码块，`JSON.parse`，返回 `recipients` 数组（失败返回 `null`）。
- 仅取 `userId`/`openConversationId`/`type`/`displayName`，忽略其余字段。

### 2. 新增工作流状态直连客户端（electron service）
**新文件**：`electron/services/workflow-run-client.ts`
- `fetchWorkflowRunStatus(runId: string): Promise<WorkflowRunApiPayload | null>`
  - `const baseUrl = resolveStoBaseUrl(); const token = await getStoToken();`
  - `proxyAwareFetch(`${baseUrl}/agent/v1/runs/${encodeURIComponent(runId)}`, { headers: { Authorization: \`Bearer ${token}\`, 'X-Trace-Id': crypto.randomUUID() } })`
  - 解 STO 信封 `{success,data,errCode,errMessage}`，`success` 返回 `data as WorkflowRunApiPayload`，否则 `null`；网络/解析异常返回 `null` 并 `logger.warn`。
- `pollWorkflowRunsUntilTerminal(runIds: string[], opts?: { maxMs?: number; intervalMs?: number }): Promise<WorkflowRunApiPayload[]>`
  - 默认 `maxMs=30*60*1000`、`intervalMs=5000`。
  - 每轮并发 fetch 全部 runId，用 `resolveWorkflowRunStatus` 判断；`isTerminalWorkflowRunStatus` 的记入完成集；全部 terminal 或超 `maxMs` 即返回当时快照（未完成者保留最后一次 payload）。

### 3. 新增超时兜底通知器（electron service）
**新文件**：`electron/services/claude-task-workflow-watchdog.ts`
- 导出 `sendWorkflowFallbackOnTimeout(params: { taskName: string; promptTemplate: string; workflowRunIds: string[]; dingtalkAlreadySent: boolean; }): Promise<void>`
- 逻辑：
  1. `if (dingtalkAlreadySent || workflowRunIds.length === 0) return;`
  2. `const recipients = parseDingTalkRecipientsFromText(promptTemplate); if (!recipients?.length) return;`
  3. `const runs = await pollWorkflowRunsUntilTerminal(workflowRunIds);`（最多 30 min）
  4. 用 `workflowRunResponseToExecutionState` 把每个 run 转成 `WorkflowExecutionState`，拼正文：
     - `completed` → `【定时任务·工作流结果】${taskName}\n` + `result.summary || currentStep || '(无摘要)'`；有 artifacts 则附 `collectAllRunArtifacts` 的 `name + url`。
     - `failed/timeout` → `…工作流未成功完成：${error || status}`。
     - 仍 `running/pending`（30 min 未结束）→ `…工作流仍在运行中，请到 StoClaw 查看`。
     - 多个 runId 合并为一条消息，每段以工作流名 / `runId` 前 8 位分隔。
  5. 标题统一 `【定时任务】${taskName}`。
  6. 对每个 recipient：`type==='user' && userId` → `--user userId`；`type==='group' && openConversationId` → `--group openConversationId`；其余跳过。
  7. `await runDws(['chat','message','send', flag, id, '--title', title, '--text', normalizeDwsChatMessageSendText(body), '--format','json'])`；逐个 try/catch，失败 `logger.warn`，不抛。
- 全程 `try/catch` 包裹，**永不 reject**（fire-and-forget）。

### 4. 在 worker 中捕获 runId / dws 已发，并触发兜底
**文件**：`electron/services/claude-task-worker.ts`
- `executeClaudeTask` 顶部（`onMessage` 之前）新增闭包状态：
  - `const workflowRunIds = new Set<string>();`
  - `const pendingDwsSendToolUseIds = new Set<string>();`
  - `let dingtalkAlreadySent = false;`
- 扩展 `onMessage`（现仅读 assistant text）：
  - **assistant 分支**：遍历 `content` 时除 `text` 外识别 `tool_use` 块：
    - `name` 归一化（`normalizeToolName`，`shared/scheduled-task-instruction.ts`）后为 `get_workflow_status` 且 `input.runId` 为字符串 → `workflowRunIds.add(runId)`。
    - `name` 为 `Bash` 且 `input.command`(字符串) 含 `dws` 且含 `chat message send` → `pendingDwsSendToolUseIds.add(tool_use_id)`。
    - `execute_workflow` 的 runId 在响应里 → 留给 user 分支。
  - **新增 user 分支**（synthetic tool_result）：解析 `message.message.content` 数组里的 `tool_result` 块：
    - 若 `block.is_error === false` 且 `block.tool_use_id` ∈ `pendingDwsSendToolUseIds` → `dingtalkAlreadySent = true`。
    - 取 `block.content`（字符串或数组里 text），尝试 `JSON.parse`：若含 `runId` 字符串且（`workflowId` 存在 或 字段名含 `run`）→ `workflowRunIds.add(runId)`。解析失败静默跳过。
- `if (timedOut)` 分支（line 194）返回前：
  - `if (workflowRunIds.size && !dingtalkAlreadySent) { void sendWorkflowFallbackOnTimeout({ taskName: params.definition.name, promptTemplate: params.definition.promptTemplate, workflowRunIds: [...workflowRunIds], dingtalkAlreadySent }).catch(() => {}); }`（不 await，立即返回 `timed_out`）。
- import：`sendWorkflowFallbackOnTimeout`（新 watchdog）、`normalizeToolName`（已存在 shared）。

### 5. 方案1：含工作流任务抬高默认 timeoutSec
**文件**：`electron/services/claude-scheduled-task-service.ts`
- 新增私有 helper `looksLikeWorkflowTask(input: { workflowCode?: string; promptTemplate?: string }): boolean`：`!!input.workflowCode?.trim()` 或 `promptTemplate` 命中 `/execute_workflow|工作流|workflowId|\bwf_|get_workflow_status/i`。
- line 120 改为：`timeoutSec: Math.max(1, input.timeoutSec ?? (looksLikeWorkflowTask(input) ? 1800 : 300))`。
- 注意：line 149 的 update 路径仅在显式传入时写 `timeoutSec`，已存量的 10 分钟任务仍带旧 300。**验证时需重新保存该任务**（或删旧建新）以拿到新默认。

## 不做的事

- 不改 `get_workflow_status` 为阻塞等待（改动面大、影响交互路径）。
- 不给 `ClaudeScheduledTaskDefinition` 加收件人字段（收件人仍由 promptTemplate 承载，与现状一致）。
- 不动 `sto-plugin/claude/sto-workflow-tool/index.ts:113` 的 `maxTurns:25`（那条独立运行路径非定时任务主路径；如后续命中再单独处理）。
- 不处理 OpenClaw 引擎（agent 在 gateway 编译产物内，本仓无硬杀点，另案排查）。

## 改动文件清单

**新增 2 个文件：**
| 文件 | 作用 |
|---|---|
| `electron/services/workflow-run-client.ts` | 直连工作流 API：`fetchWorkflowRunStatus`、`pollWorkflowRunsUntilTerminal` |
| `electron/services/claude-task-workflow-watchdog.ts` | 超时兜底：`sendWorkflowFallbackOnTimeout`（解析收件人→轮询→拼正文→`runDws` 发钉钉） |

**修改 3 个文件：**
| 文件 | 改动 |
|---|---|
| `shared/dingtalk-mention-context.ts` | 新增 `parseDingTalkRecipientsFromText(text)` 解析器 |
| `electron/services/claude-task-worker.ts` | `onMessage` 扩展捕获 `workflowRunIds` + `dingtalkAlreadySent`；`if(timedOut)` 分支 fire-and-forget 触发兜底 |
| `electron/services/claude-scheduled-task-service.ts` | 新增 `looksLikeWorkflowTask(input)`；创建默认 `timeoutSec` 命中工作流则 300→1800 |

## 验证

1. **类型/单测**：`pnpm -s typecheck`（或仓库既有 lint 命令）；为 `parseDingTalkRecipientsFromText` 与 `looksLikeWorkflowTask` 各加一个最小单测（若有既有 test 目录）。
2. **方案1 手测**：创建一个 promptTemplate 含 `execute_workflow` + 收件人 JSON 的定时任务，确认落库 `definitions.json` 的 `timeoutSec=1800`；创建一个普通任务确认仍为 300。
3. **方案2 端到端**：
   - 选一个 ~10 分钟的工作流，配置一个收件人，建定时任务（把 `timeoutSec` 设回 300 以强制命中兜底，或保持 1800 但用 mock 慢工作流）。
   - 手动 trigger；观察到 5 分钟 agent 被 `timed_out`、run 记录结束。
   - 之后 worker 后台持续轮询；工作流 completed 后收件人收到 `【定时任务】…` 钉钉消息，正文含工作流摘要，末尾带代发说明。
   - 对照：一个 1 分钟短工作流任务，agent 自己在超时前发出钉钉（`dingtalkAlreadySent=true`）→ 兜底不再二次发送。
4. **回归**：不带工作流的定时任务超时后**不应**发任何钉钉（`workflowRunIds` 为空 → 兜底早退）；普通任务超时行为不变（仅 `timed_out` 记录）。

## 实现完成状态

实现与上述方案一致，仅一处简化：

- **runId 信封解析**：原方案在 user 分支用 `text.split(/```/)` 切代码栅栏再逐段 `JSON.parse`。实际 `tryParseJson` 已能从任意文本中剥出首个 `{ ... }` 子串（覆盖 markdown 代码栅栏与说明文字），故 worker 直接对 `tool_result` 文本调用一次 `tryParseJson` 即可，无需手动 split。`tryParseJson` 为 worker 内私有 helper。
- 其余收件人解析器、`workflow-run-client`、`claude-task-workflow-watchdog`、worker 捕获与兜底触发、`looksLikeWorkflowTask` 默认超时抬高均按方案落地。

**类型检查**：`tsc --noEmit -p tsconfig.node.json` 对本次新增/改动文件零报错。仓库现存预存错误（`claude-task-worker.ts:238` `runtimeResult` 的 `type` 字段、`tsconfig.node.json` 未列 `sto-plugin` 文件、`dist-electron` 陈旧 d.ts 等）均为 HEAD 既有，非本次引入。
