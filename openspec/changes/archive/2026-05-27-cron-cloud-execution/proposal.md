## Why

当前 StoClaw 的定时任务完全依赖本地 OpenClaw Gateway 执行。用户电脑关机、休眠或退出应用后，定时任务无法触发，导致关键自动化流程中断（如定时报表生成、数据同步等）。用户期望即使电脑离线，定时任务仍能在云端可靠执行，并在重新打开电脑后及时收到执行结果。

## What Changes

- 在 Cron 管理页面新增「执行位置」选项：用户创建/编辑任务时可选择「本地执行」（Gateway）或「云端执行」（Cloud）。
- 选择「云端执行」的任务，其配置（调度表达式、消息内容、目标 Agent、交付方式等）通过 Main-process 代理提交到云端 Task API，由云端托管调度与执行。
- 云端任务执行完成后，结果通过实时通道（WebSocket / SSE）推送给在线的 StoClaw 客户端。
- StoClaw 客户端启动或网络恢复时，自动向云端查询离线期间产生的未读执行结果，并展示在对应任务的运行历史中。
- 用户正在使用 App 时，云端执行成功的结果实时推送到前端，支持 Toast 通知和会话内新消息提示。
- 运行历史支持显示云端任务的执行日志、状态（成功/失败/超时）、耗时和输出内容，体验与本地任务一致。
- 云端任务的开关、删除、手动触发等操作与本地任务保持统一的 UI 交互，差异对终端用户透明。

## Capabilities

### New Capabilities

- `cron-cloud-task`: 用户在 StoClaw 本地创建/编辑/删除定时任务时，可选择将任务提交到云端托管执行。包含云端 Task API 的调用、任务状态双向同步、以及本地与云端任务的统一列表展示。
- `cron-cloud-result-sync`: 云端任务执行完成后，结果向在线客户端实时推送；客户端离线后重新上线时，自动拉取未读结果并合并到任务的运行历史与会话视图中。

### Modified Capabilities

<!-- 无现有 spec 级行为变更；定时任务的核心模型和 UI 交互保持不变，仅增加云端执行模式选项。 -->

## Impact

- **Frontend** (`src/pages/Cron/`, `src/stores/cron.ts`, `src/types/cron.ts`): Cron 页面新增执行位置选择器；store 增加云端任务 CRUD 和结果轮询/推送逻辑。
- **Main Process** (`electron/api/routes/cron.ts`, `electron/gateway/client.ts`, `electron/services/`): 需新增或扩展 Cloud Task API 的代理路由；可能需要新增 `sto-cloud-task-service` 处理云端通信和离线队列。
- **Renderer → Main API**: 新增 `hostapi:fetch` 路由或 IPC 通道用于云端 Task API 调用；遵循现有 Transport 策略（WS → HTTP → IPC fallback）。
- **Gateway / External**: 云端 Task API 为外部依赖（假设由后端团队提供），StoClaw 侧负责集成调用；若云端 API 尚未就绪，需定义接口契约。
- **Security**: 任务配置和结果内容涉及用户数据和 Agent 上下文，云端通信需经过身份认证和传输加密。
- **i18n**: 新增「云端执行」「执行位置」「云端结果」等文案需补充到 `src/i18n/locales/*/cron.json`。
