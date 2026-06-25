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
4. `workflowOptions` 不在页面级，而在全局 `useMyTaskStore`（`TaskCreateModal.tsx:114` 内部自取）。MyTask 主页面只是触发 `fetchWorkflows()`（store 实际方法名，见 `src/pages/MyTask/store.ts:94,161`）。因此 Chat/Home 侧无需主页面参与，只需在 modal 打开前/同时确保 store 里有数据；**没有就请求一次**。
5. `useWorkflowCronTaskModal` 与 `CronTaskCreateModal` 同时被 **Chat 与 Home** 两个对话面消费：`src/pages/Chat/index.tsx` 与 `src/pages/Home/HomeMainConversation.tsx:32,266-271,546-551`。改造 hook 的 `initialValues` 语义与 `handleSave` payload 后，Home 必须同步换组件，否则预填失效且拿不到 `workflowCode`。
6. `CronTaskCreateModal` 仍服务于 `src/pages/Cron/index.tsx:21,80,291`，是合法保留方，**该组件文件不删**；本次只从 Chat 与 Home 移除引用。

## 可行性结论

可行，改动集中在 4 个文件，落库链路零改动。

- **数据流已通**：`AssistantTurnMessage` / `ChatMessage` 的 `onCreateScheduledTask?: (workflowId: string) => void`（`AssistantTurnMessage.tsx:50`、`ChatMessage.tsx:89`）已把 workflowId 透传到 `openWorkflowCronTaskModal`，调用点无需改。Home 侧 `HomeMainConversation.tsx:417,429,444` 同理。
- **select 数据不依赖主页面**：modal 内部从全局 store 自取，Chat/Home 侧补一次 `fetchWorkflows()` 即可。
- **需补的能力一：预选工作流**：`TaskCreateModal` 当前 `initialValues` 只支持 `{ name?, message?, schedule? }`（`TaskCreateModal.tsx:35`），`computeInitialValues` 在无 `job` 分支把 `selectedWorkflow` 写死 `''`（`:80`）。需扩展 `initialValues.workflowCode` 以支持从 Chat 产物预选工作流。
- **需补的能力二：预选时的 instructions 模板**：`computeInitialValues` 是纯函数，拿不到 `workflowOptions`，无法像 dropdown 选中分支那样生成 `帮我执行 id 为：${id} 的工作流 【${label}】`。若只预填 `workflowCode` 不填 `instructions`，则 `workflowDisabled=true` 锁死指令框、而 `handleSubmit`（`:157`）仍要求 instructions 非空，导致校验失败、用户无法提交。必须在预选工作流时同步生成模板文本（见步骤 1.3）。

## 注意点

- **key 复用问题**：`TaskCreateModal` 用 `key={job?.id ?? '__create__'}`（`:104`）在 job 切换时重建内部 state。Chat 场景无 `job`，key 恒为 `'__create__'`，连续为不同 workflow 打开时 `useState(init)` 不会重算，会导致预选工作流不更新。**需让 key 随 workflowCode 变化**（见步骤 1.2）。
- **engineType 默认**：`TaskCreateModal` 无 job 时默认 `openclaw`（`:79`）。采取 MyTask 现有逻辑即默认 openclaw，与 Chat 之前（claude/openclaw 双支持）不同，需知悉此行为变更。
- **不再生成 prompt 文本**：替换后不再调用 `buildWorkflowCronTaskMessage`（`src/lib/workflow-cron-task.ts`），改为绑定 workflowCode。该函数若无其他引用可一并清理。
- **Home 必须同步迁移**：`useWorkflowCronTaskModal` 与 `CronTaskCreateModal` 被 Chat 和 Home 共用，只改 Chat 会让 Home 预填失效且 payload 缺 `workflowCode`。
- **`CronTaskCreateModal` 不删除**：Cron 页（`src/pages/Cron/index.tsx`）仍在使用，本次只从 Chat/Home 移除引用，组件文件保留。
- **instructions 模板单点化**：预选工作流生成的模板文案必须与 dropdown 选中分支（`TaskCreateModal.tsx:312-315`）保持同源，避免文案分叉。

---

## 修改步骤

### 步骤 1：`TaskCreateModal` 支持外部预选工作流（含 instructions 模板）

**文件**：`src/pages/MyTask/components/TaskCreateModal.tsx`

1. `TaskCreateModalProps.initialValues` 与 `TaskCreateModalInnerProps.initialValues` 类型增加 `workflowCode?: string`（`:35`、`:42`）。
2. `computeInitialValues` 的 `initialValues` 分支（`:71-82`）：`selectedWorkflow` 由 `''` 改为 `initialValues.workflowCode || ''`。
3. **预选时同步生成 instructions 模板**（修复锁死+校验失败）：`TaskCreateModalInner` 在 `init` 之后、`useState` 之前补一段修正——当 `init.selectedWorkflow` 非空且 `init.instructions` 为空时，从 `workflowOptions` 解析 label，写入与 dropdown 选中分支（`:312-315`）同源的模板 `帮我执行 id 为：${id} 的工作流 【${label}】`；label 找不到时降级为 `帮我执行 id 为：${id} 的工作流`。以此作为 `instructions` 的 `useState` 初值，保持"选工作流即生成指令"单点逻辑在组件内，hook 只传 code。注意 `workflowOptions` 此时可能尚未加载完（异步 `fetchWorkflows`），需保证 hook 在 `fetchWorkflows` 完成后再 `setOpen(true)`（见步骤 2.1），从而修正时已有数据。
4. `TaskCreateModal` 外层组件（`:94-111`）的 `key`：由 `job?.id ?? '__create__'` 改为 `job?.id ?? `workflow:${initialValues?.workflowCode ?? '__create__'}``，确保 Chat 场景下切换不同 workflow 时内部 state 重建、预选值与模板均生效。

### 步骤 2：Chat/Home 共用 hook 改造

**文件**：`src/hooks/use-workflow-cron-task-modal.ts`

1. `openForWorkflow(workflowId)` 改为：
   - 先判断 `useMyTaskStore.getState().workflowOptions.length === 0`，为空则 `await useMyTaskStore.getState().fetchWorkflows()`（失败忽略，modal 内 select 兜底空列表）。
   - `setInitialValues({ workflowCode: workflowId })`（替代原先的 `{ message: buildWorkflowCronTaskMessage(workflowId) }`；instructions 模板由步骤 1.3 在组件内生成，hook 不再拼文案）。
   - `setOpen(true)`。保证 `fetchWorkflows` 完成后再开 modal，使步骤 1.3 的 label 解析有数据。
2. `handleSave` 类型与 payload 调整：
   - 入参类型由 `CronTaskFormInput`（import 自 `CronTaskCreateModal`）改为 `TaskCreateInputWithRun`（import 自 `TaskCreateModal`），二者结构相同（均 `CronJobCreateInput & { engineType; claudeWorkspacePath?; claudePermissionProfile? }`），仅切换 import 来源，避免对 Cron 组件的残留依赖。
   - 两个分支 payload 补 `workflowCode: input.workflowCode`（对齐 `MyTask/index.tsx:345-356`）。其余创建逻辑保持原样，**不抽共享函数**——现有 hook 已含完整路径，新增 `src/lib/scheduled-task-create.ts` 属过度设计。
3. 移除对 `buildWorkflowCronTaskMessage` 的 import，并删除 `import type { CronTaskFormInput }` 这条对 `CronTaskCreateModal` 的类型依赖。

### 步骤 3：Chat 与 Home 页面同步替换 modal 组件

**文件**：`src/pages/Chat/index.tsx`、`src/pages/Home/HomeMainConversation.tsx`

1. 两处 import 由 `CronTaskCreateModal`（Chat `:51`、Home `:33`）改为 `TaskCreateModal`（来自 `@/pages/MyTask/components/TaskCreateModal`）。
2. 渲染（Chat `:726-731`、Home `:546-551`）改为：
   ```tsx
   <TaskCreateModal
     open={workflowCronModalOpen}
     onClose={closeWorkflowCronTaskModal}
     onSave={handleWorkflowCronTaskSave}
     initialValues={workflowCronInitialValues}
   />
   ```
   （无需传 `job`，走 create 路径。）
3. `onCreateScheduledTask={openWorkflowCronTaskModal}` 透传不变（Chat `:540,554,572`、Home `:417,429,444`）。

### 步骤 4：清理

- 确认 `src/lib/workflow-cron-task.ts` 的 `buildWorkflowCronTaskMessage` 无其他引用后删除该文件（或仅删函数）。**同时删除 `tests/unit/workflow-cron-task.test.ts`**——该测试直接断言 `buildWorkflowCronTaskMessage` 输出，删函数后必然红。
- 全局搜索 `CronTaskCreateModal` 引用，确认仅剩 `src/pages/Cron/index.tsx`（Cron 页合法保留方），Chat 与 Home 已无残留。**`CronTaskCreateModal` 组件文件保留不删。**
- 确认 `buildWorkflowCronTaskMessage` 在 `src/hooks/use-workflow-cron-task-modal.ts` 之外无其他引用（当前仅该 hook 与测试文件引用）。

---

## 验证

1. Chat 产物卡点「创建定时任务」→ 弹出 `TaskCreateModal`，工作流 select 默认选中该产物对应的工作流，instructions 被锁定（`workflowDisabled` 生效）且自动填入模板文本 `帮我执行 id 为：… 的工作流 【…】`，可直接提交。
2. Home 对话面产物卡点「创建定时任务」→ 同 1，行为一致。
3. 首次进入 Chat/Home（`workflowOptions` 为空）点「创建定时任务」→ 自动触发 `fetchWorkflows`，select 有数据且模板 label 正常解析。
4. 提交 → `useCronStore.createJob` 落库，payload 含 `workflowCode`；MyTask 列表可见该任务且关联了正确工作流。
5. 连续为两个不同工作流产物打开弹窗 → 第二次预选值与模板均正确更新（验证步骤 1.4 的 key 改动）。
6. 引擎切换（openclaw/claude）→ 两条路径均能创建成功；claude 路径下 `prepareDingTalkAgentTurnMessage` 拿到的 `promptTemplate` 与 MyTask claude 创建路径（`MyTask/index.tsx:329-344`）语义一致。
7. `pnpm test` 通过（`workflow-cron-task.test.ts` 已删除，无残留红测）；`pnpm run typecheck` 通过（hook 入参类型已切到 `TaskCreateInputWithRun`，无悬空 import）。
