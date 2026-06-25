# 计划：Chat 产物「创建定时任务」复用 MyTask 弹窗

## Context

聊天界面产物卡上有两个操作：「查看工作流」「创建定时任务」。

- 「查看工作流」：`openWorkflowPreview` → `navigate('/workflow/:id')`，路由跳转，本次不动。
- 「创建定时任务」：当前走 `useWorkflowCronTaskModal`（`src/hooks/use-workflow-cron-task-modal.ts`），打开的是 `src/pages/Cron/components/CronTaskCreateModal.tsx`，语义是「用 `buildWorkflowCronTaskMessage(workflowId)` 把 workflowId 拼成一段 prompt 文本落库」，**不绑定 workflowCode**。

目标：把 Chat 里的「创建定时任务」改为复用 `src/pages/MyTask/components/TaskCreateModal.tsx`，语义统一为「绑定 workflowCode、选了工作流即锁定自定义指令」，与 MyTask 页面一致。

## 已确认前提

1. Chat 产物里的 `workflowId` 与 MyTask `workflowOptions` 的 `value` 是同一个标识，可直接当 `workflowCode` 用，无需映射。
2. 采取 MyTask 现有逻辑：选工作流后 `workflowDisabled` 锁定 instructions，落 `workflowCode` 字段。
3. 落库同源：MyTask 的 CRUD 全部走 `useCronStore`（`src/pages/MyTask/index.tsx:4,10`），与 Chat 当前 `useWorkflowCronTaskModal` 走的是同一个 store / 同一个 Gateway 入口，换 modal 不动落库链路。
4. `workflowOptions` 不在页面级，而在全局 `useMyTaskStore`（`TaskCreateModal.tsx:114` 内部自取）。MyTask 主页面只是触发 `fetchWorkflowOptions()`。因此 Chat 侧无需主页面参与，只需在 modal 打开前/同时确保 store 里有数据；**没有就请求一次**。

## 可行性结论

可行，改动集中在 3 个文件，落库链路零改动。

- **数据流已通**：`AssistantTurnMessage` / `ChatMessage` 的 `onCreateScheduledTask?: (workflowId: string) => void`（`AssistantTurnMessage.tsx:50`、`ChatMessage.tsx:89`）已把 workflowId 透传到 `openWorkflowCronTaskModal`，调用点无需改。
- **select 数据不依赖主页面**：modal 内部从全局 store 自取，Chat 侧补一次 `fetchWorkflows()` 即可。
- **唯一需要补的能力**：`TaskCreateModal` 当前 `initialValues` 只支持 `{ name?, message?, schedule? }`（`TaskCreateModal.tsx:35`），`computeInitialValues` 在无 `job` 分支把 `selectedWorkflow` 写死 `''`（`:80`）。需扩展 `initialValues.workflowCode` 以支持从 Chat 产物预选工作流。

## 注意点

- **key 复用问题**：`TaskCreateModal` 用 `key={job?.id ?? '__create__'}`（`:104`）在 job 切换时重建内部 state。Chat 场景无 `job`，key 恒为 `'__create__'`，连续为不同 workflow 打开时 `useState(init)` 不会重算，会导致预选工作流不更新。**需让 key 随 workflowCode 变化**（见步骤 1）。
- **engineType 默认**：`TaskCreateModal` 无 job 时默认 `openclaw`（`:79`）。采取 MyTask 现有逻辑即默认 openclaw，与 Chat 之前（claude/openclaw 双支持）不同，需知悉此行为变更。
- **不再生成 prompt 文本**：替换后不再调用 `buildWorkflowCronTaskMessage`（`src/lib/workflow-cron-task.ts`），改为绑定 workflowCode。该函数若无其他引用可一并清理。

---

## 修改步骤

### 步骤 1：`TaskCreateModal` 支持外部预选工作流

**文件**：`src/pages/MyTask/components/TaskCreateModal.tsx`

1. `TaskCreateModalProps.initialValues` 与 `TaskCreateModalInnerProps.initialValues` 类型增加 `workflowCode?: string`（`:35`、`:42`）。
2. `computeInitialValues` 的 `initialValues` 分支（`:71-82`）：`selectedWorkflow` 由 `''` 改为 `initialValues.workflowCode || ''`。
3. `TaskCreateModal` 外层组件（`:94-111`）的 `key`：由 `job?.id ?? '__create__'` 改为 `job?.id ?? `workflow:${initialValues?.workflowCode ?? '__create__'}``，确保 Chat 场景下切换不同 workflow 时内部 state 重建、预选值生效。

### 步骤 2：Chat 侧 hook 改造

**文件**：`src/hooks/use-workflow-cron-task-modal.ts`

1. `openForWorkflow(workflowId)` 改为：
   - `setInitialValues({ workflowCode: workflowId })`（替代原先的 `{ message: buildWorkflowCronTaskMessage(workflowId) }`）。
   - 打开前判断 `useMyTaskStore.getState().workflowOptions.length === 0`，为空则 `await useMyTaskStore.getState().fetchWorkflows()`（失败忽略，modal 内 select 兜底空列表）。
   - `setOpen(true)`。
2. `handleSave`：复用 MyTask `handleSave` 的创建路径逻辑（`src/pages/MyTask/index.tsx:313-346`），即按 `engineType` 走 `useCronStore.createJob`，payload 带上 `workflowCode: input.workflowCode`。建议把这段创建逻辑抽成共享函数（如 `src/lib/scheduled-task-create.ts` 的 `createScheduledTask(input, agents, defaultAgentId)`），MyTask 与本 hook 共用，避免两边重复。
3. 移除对 `buildWorkflowCronTaskMessage` 的 import。

### 步骤 3：Chat 页面替换 modal 组件

**文件**：`src/pages/Chat/index.tsx`

1. import 由 `CronTaskCreateModal`（`:50`）改为 `TaskCreateModal`（来自 `@/pages/MyTask/components/TaskCreateModal`）。
2. 渲染（`:726-731`）改为：
   ```tsx
   <TaskCreateModal
     open={workflowCronModalOpen}
     onClose={closeWorkflowCronTaskModal}
     onSave={handleWorkflowCronTaskSave}
     initialValues={workflowCronInitialValues}
   />
   ```
   （无需传 `job`，走 create 路径。）
3. `onCreateScheduledTask={openWorkflowCronTaskModal}` 透传不变（`:540,554,572`）。

### 步骤 4：清理

- 确认 `src/lib/workflow-cron-task.ts` 的 `buildWorkflowCronTaskMessage` 无其他引用后删除该文件（或仅删函数）。
- 全局搜索 `CronTaskCreateModal` 引用，确认 Chat 之外无残留依赖。

---

## 验证

1. Chat 产物卡点「创建定时任务」→ 弹出 `TaskCreateModal`，工作流 select 默认选中该产物对应的工作流，instructions 被锁定（`workflowDisabled` 生效）。
2. 首次进入 Chat（`workflowOptions` 为空）点「创建定时任务」→ 自动触发 `fetchWorkflows`，select 有数据。
3. 提交 → `useCronStore.createJob` 落库，payload 含 `workflowCode`；MyTask 列表可见该任务且关联了正确工作流。
4. 连续为两个不同工作流产物打开弹窗 → 第二次预选值正确更新（验证步骤 1 的 key 改动）。
5. 引擎切换（openclaw/claude）→ 两条路径均能创建成功。
