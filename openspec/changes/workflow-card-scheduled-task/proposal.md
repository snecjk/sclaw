## Why

工作流在对话中执行完成后，用户常希望把同一条工作流固化为周期性任务。当前 WorkflowCard 只有「查看工作流」，用户需手动进入 Cron 页新建任务并自己填写工作流 ID。应在卡片上提供快捷入口，直接调起已有 Cron 创建弹窗并预填执行指令。

## What Changes

- 在 `WorkflowCard` 终态卡片的「查看工作流」右侧新增 **「创建定时任务」** 按钮（终态且存在 `workflowId` 时展示）。
- 点击后 **调起现有 `CronTaskCreateModal`**（与 Cron 页「新建定时任务」同一组件），通过 `initialValues` 预填：
  - `message`：`执行 {workflowId} 工作流`
  - `name`：可选，默认可留空由用户填写
- 用户只需补充 **计划时间**、**发送对象** 等 Cron 弹窗已有字段，点保存走 Cron 页同款 `createJob` 逻辑。
- 在 Chat 与 Home 主对话中各挂载一次 `CronTaskCreateModal`（或共享父级状态），无新弹窗、无新 API、无新 store。

## Capabilities

### New Capabilities

- `workflow-card-scheduled-task`：工作流卡片调起 Cron 创建弹窗，并按 `workflowId` 预填任务描述。

### Modified Capabilities

（无）

## Impact

- `src/components/workflow/WorkflowCard.tsx` — 新按钮 + `onCreateScheduledTask(workflowId)` 回调
- `src/pages/Chat/ChatMessage.tsx`、`AssistantTurnMessage.tsx` — 透传回调
- `src/pages/Chat/index.tsx`、`src/pages/Home/HomeMainConversation.tsx` — 弹窗 `open` 状态 + `CronTaskCreateModal` + 复用 Cron `handleSave`
- 复用：`src/pages/Cron/components/CronTaskCreateModal.tsx`、`src/stores/cron.ts`
