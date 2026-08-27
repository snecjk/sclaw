## ADDED Requirements

### Requirement: 一次性 AI 调用能力 `chat.complete`

系统 SHALL 通过 JSBridge 向已授权的 `*.sto.cn` H5 页面提供 `chat.complete` 能力，接受任务指令与业务上下文，在 AI 运行到达终态后一次性返回完整结果。

请求参数 MUST 包含 `prompt: string`；MAY 包含 `context`、`agentId`、`skillSlugs`、`responseFormat`、`conversationId`、`timeoutMs`。

响应 MUST 包含 `requestId`、`runId`、`text`、`finishReason`，其中 `finishReason` 取值 SHALL 限定为 `completed` / `timeout` / `aborted` / `failed`。

#### Scenario: 正常完成并返回文本
- **WHEN** 已授权应用调用 `chat.complete({ prompt })` 且 AI 运行正常结束
- **THEN** Bridge 返回 `finishReason: 'completed'`，`text` 为模型完整输出，`runId` 为本次运行标识

#### Scenario: 缺少必填参数
- **WHEN** 调用方未提供 `prompt` 或 `prompt` 为空字符串
- **THEN** Bridge MUST 拒绝该请求并返回参数校验错误码，且 MUST NOT 发起任何 AI 运行

#### Scenario: AI 运行失败
- **WHEN** AI 运行以失败终态结束
- **THEN** Bridge 返回 `finishReason: 'failed'` 并携带可诊断的错误信息，而非抛出未捕获异常

### Requirement: AI 调用在 Main 进程完成，不依赖聊天 UI 状态

系统 SHALL 在 Main 进程内完成 AI 调用的发起、事件订阅与终态判定。该链路 MUST NOT 依赖聊天页面已挂载、聊天 store 已订阅，或目标会话为当前可见会话。

渲染进程 MUST NOT 新增直接 `window.electron.ipcRenderer.invoke(...)` 调用，也 MUST NOT 直连 Gateway HTTP 端点；传输策略保持 Main 所有。

#### Scenario: 聊天页面未挂载时调用
- **WHEN** 用户从未打开过聊天页面，H5 直接发起 `chat.complete`
- **THEN** AI 调用正常执行并返回结果

#### Scenario: 目标会话非当前可见会话
- **WHEN** 用户当前停留在其他会话，H5 发起 `chat.complete`
- **THEN** AI 调用在其独立会话中执行，且 MUST NOT 切换用户当前可见的会话

### Requirement: 超时口径三层对齐

系统 SHALL 使 guest preload 超时、Bridge `timeoutMs` 与 supervisor `deadlineAt` 保持一致。

Bridge `timeoutMs` 默认值 SHALL 为 120 秒，上限 SHALL 为 180 秒；`deadlineAt` MUST 等于 `now + timeoutMs` 且 MUST 满足 `deadlineAt <= guest timeout`。

guest preload 的既有 30 秒默认值 MUST NOT 被修改；SDK 发起 AI 调用时 MUST 显式传入 `timeoutMs`。

#### Scenario: 超时后同步中止运行
- **WHEN** AI 运行超过 `timeoutMs` 仍未到达终态
- **THEN** Bridge 返回 `finishReason: 'timeout'`，且 Main MUST 同步中止该运行，不遗留在途任务

#### Scenario: 请求超出上限
- **WHEN** 调用方传入的 `timeoutMs` 大于 180000
- **THEN** 系统 MUST 拒绝该请求或将其钳制到上限，且不得使 `deadlineAt` 超过 guest 侧超时

### Requirement: 取消能力 `chat.cancel`

系统 SHALL 提供 `chat.cancel({ requestId })`，用于中止一次在途的 AI 运行并返回 `{ ok: boolean }`。

#### Scenario: 取消在途运行
- **WHEN** 调用方对一个正在运行的 `requestId` 调用 `chat.cancel`
- **THEN** 系统中止该运行，`chat.complete` 以 `finishReason: 'aborted'` 返回，`chat.cancel` 返回 `ok: true`

#### Scenario: 取消不存在或已结束的运行
- **WHEN** `requestId` 不存在或对应运行已到达终态
- **THEN** `chat.cancel` 返回 `ok: false`，且 MUST NOT 影响其他运行

#### Scenario: 跨应用取消隔离
- **WHEN** 应用 A 尝试取消属于应用 B 的 `requestId`
- **THEN** 系统 MUST 拒绝该操作，B 的运行不受影响

### Requirement: JSON 输出尽力解析且失败可降级

当 `responseFormat` 为 `'json'` 时，系统 SHALL 尝试解析模型输出。解析成功 MUST 提供 `parsed`；解析失败 MUST 提供 `parseError` 并保留原始 `text`。

系统 MUST NOT 因解析失败而丢弃模型原始输出。

#### Scenario: 输出为合法 JSON
- **WHEN** `responseFormat: 'json'` 且模型返回合法 JSON
- **THEN** 响应包含 `parsed`，且不包含 `parseError`

#### Scenario: 输出为非法 JSON
- **WHEN** `responseFormat: 'json'` 但模型输出夹带 markdown 或结构不完整
- **THEN** 响应省略 `parsed`、提供 `parseError` 说明原因，并在 `text` 中保留完整原始输出

### Requirement: 上下文体积上限

系统 SHALL 对 `context` 设定字节上限。超限时 MUST 返回明确错误码，MUST NOT 静默截断业务数据。

#### Scenario: 上下文超限
- **WHEN** H5 传入的 `context` 序列化后超过配置上限
- **THEN** Bridge 拒绝该请求并返回体积超限错误码，提示调用方自行裁剪或摘要

### Requirement: 单会话并发约束

系统 SHALL 限制每个 bridge session 的在途 AI 运行数，默认为 1。超出限制的请求 MUST 返回明确错误码，MUST NOT 因幂等机制被静默判为重放。

#### Scenario: 并发超限
- **WHEN** 同一 bridge session 已有在途运行，又发起新的 `chat.complete`
- **THEN** 系统返回并发超限错误码，且已有运行不受影响

### Requirement: 流式 AI 调用 `chat.invokeAgent`

系统 SHALL 提供 `chat.invokeAgent`，立即返回 `{ requestId, sessionKey }`，并通过既有 `jsbridge:event` 通道向 guest 推送 `chat:stream` 事件。

事件类型 SHALL 限定为 `start` / `delta` / `tool` / `done` / `error` / `aborted`；`delta` 事件 MUST 携带单调递增的 `seq` 以便调用方检测乱序或丢失。

#### Scenario: 流式增量推送
- **WHEN** 已授权应用调用 `chat.invokeAgent` 且运行正常产出增量
- **THEN** guest 依次收到 `start`、若干带递增 `seq` 的 `delta`，最终收到携带完整文本的 `done`

#### Scenario: 流式运行被取消
- **WHEN** 运行过程中调用方执行 `chat.cancel`
- **THEN** guest 收到 `aborted` 事件，且此后 MUST NOT 再收到该 `requestId` 的任何 `delta`
