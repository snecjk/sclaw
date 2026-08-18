## Why

嵌入式工作流编辑器已经完成单顶栏和“保存后本地试运行”链路，但结果抽屉仍是旧的 800px 技术型界面，且 iframe bridge 在本地运行结束后直接回到 `idle`。用户关闭抽屉后无法从画布顶栏判断运行结果，取消、失败和完成状态也不能与抽屉保持一致。

需要按 MasterGo 工作流试运行设计统一结果抽屉和顶栏状态，并用低风险语义处理取消后的“继续运行”：创建新的完整试运行，而不是回退服务端终态或复用已取消的运行。

## What Changes

- 将 StoClaw 试运行模式改为 500px 紧凑右侧抽屉，覆盖 4 类状态和完成态收起/展开在内的 5 个视觉视图
- 在既有 workflow iframe bridge 中增加 `cancelled`、`failed`、`completed` 稳定终态
- 让 `memory-center-web` 顶栏状态徽标与 StoClaw 抽屉消费同一 Host 状态，关闭抽屉后仍保持状态
- 将运行生命周期与抽屉可见性分离，关闭抽屉不再发送 `idle` 或取消运行
- 保留执行事件、产物、人工审批和补充输入；完成态使用“执行过程/产物名称”折叠区替代 Tab
- 将取消态“继续运行”接到现有保存后重跑链路，创建新 `runId` 并从头执行
- 隔离试运行与共享运行详情模式，避免影响历史运行详情和完成通知
- 使用 `docs/sto-design.md` 的 Brand、Success、Warning、Danger、Text、Fill、Border 语义 Token，并覆盖浅色和深色主题

## Capabilities

### New Capabilities

- `workflow-trial-run-experience`: 嵌入式工作流试运行的结果抽屉、稳定终态同步、后台运行可见性和安全重跑体验

### Modified Capabilities

<!-- No existing base capabilities modified; this change builds on workflow-embedded-editor-integration. -->

## Impact

- `sto-claw/src/pages/WorkflowDesigner/components/test-run-drawer.tsx`: 试运行模式布局和状态视图
- `sto-claw/src/pages/WorkflowDesigner/hooks/use-designer-try-run.ts`: 本地状态事实与新运行行为
- `sto-claw/src/pages/Workflow/hooks/use-embedded-workflow-try-run.ts`: 终态同步、request 生命周期和重跑编排
- `sto-claw/src/pages/Workflow/workflow-routes.tsx`: 抽屉关闭与“继续运行”接线
- `sto-claw/src/lib/workflow-iframe-bridge.ts` 及相关测试：新增终态协议
- `memory-center-web/src/agent-workflow/`: bridge 终态、顶栏徽标和主题样式
- `memory-center`: 不修改生产代码或终态锁
- `README.md`、`README.zh-CN.md`、`README.ja-JP.md`: 实现阶段评估行为说明是否需要同步
