## 1. WorkflowCard action

- [x] 1.1 Add `onCreateScheduledTask?: (workflowId: string) => void` to `WorkflowCard` props (Requirement: Workflow card exposes create scheduled task action)
- [x] 1.2 Render **创建定时任务** beside **查看工作流** in a shared `flex gap-2` row when terminal + `workflowId` present (Requirement: Workflow card exposes create scheduled task action)
- [x] 1.3 Hide the button for `running` / `pending` or missing `workflowId` (Requirement: Workflow card exposes create scheduled task action)

## 2. Prop wiring

- [x] 2.1 Pass `onCreateScheduledTask` through `ChatMessage` and `AssistantTurnMessage` (Requirement: Workflow card entry is available in chat surfaces)
- [x] 2.2 Wire callback from `Chat/index.tsx` message list into `WorkflowCard` (Requirement: Workflow card entry is available in chat surfaces)
- [x] 2.3 Wire callback from `HomeMainConversation.tsx` message list into `WorkflowCard` (Requirement: Workflow card entry is available in chat surfaces)

## 3. Cron modal integration (Chat)

- [x] 3.1 Add local state in `Chat/index.tsx` for `cronModalOpen` and `cronInitialValues` (Requirement: Create action opens existing local Cron modal)
- [x] 3.2 Mount `CronTaskCreateModal` in `Chat/index.tsx`; on card click set `message` to `执行 ${workflowId} 工作流` and open modal (Requirement: Instructions field is prefilled from workflow id)
- [x] 3.3 Implement `onSave` via `useCronStore.createJob({ engineType: 'openclaw', payload })`; toast on success, close modal, no navigation (Requirement: Save uses existing OpenClaw local cron creation path)

## 4. Cron modal integration (Home)

- [x] 4.1 Mirror Chat modal state + `CronTaskCreateModal` mount in `HomeMainConversation.tsx` (Requirement: Workflow card entry is available in chat surfaces)
- [x] 4.2 Reuse same prefilled `message` and OpenClaw `createJob` save handler as Chat (Requirement: Save uses existing OpenClaw local cron creation path)

## 5. Tests & docs

- [x] 5.1 Add unit tests for WorkflowCard button visibility and click invoking `onCreateScheduledTask(workflowId)` (Requirement: Workflow card exposes create scheduled task action)
- [x] 5.2 Add test or assertion for prefilled instructions text `执行 {workflowId} 工作流` when opening modal from card handler (Requirement: Instructions field is prefilled from workflow id)
- [x] 5.3 Review `README.md`, `README.zh-CN.md`, `README.ja-JP.md` for workflow → cron shortcut documentation; update if user-facing flow changed (Requirement: Workflow card entry is available in chat surfaces)
