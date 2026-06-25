## Context

- `WorkflowCard` 终态展示「查看工作流」，数据来自 `workflowCardStates[runId].workflowId`。
- Cron 页已有完整创建流程：`CronTaskCreateModal` + `initialValues` + `useCronStore.createJob`。
- Home 页 AI 创建定时任务场景已用 `TaskCreateModal`（云端 Scheduled Tasks），**本变更明确复用本地 Cron 弹窗**，与截图中「执行引擎 OpenClaw」一致。

## Goals / Non-Goals

**Goals:**

- 卡片按钮 → 打开 `CronTaskCreateModal`
- `initialValues.message = \`执行 ${workflowId} 工作流\``
- 保存行为与 Cron 页新建 OpenClaw 任务一致

**Non-Goals:**

- 不新建弹窗或表单组件
- 不接入云端 `ScheduledTasks` / `TaskCreateModal`
- 不新增 IPC、后端 API 或全局事件总线
- 不强制预填任务名称、执行引擎（引擎默认 OpenClaw 由弹窗自身处理）

## Decisions

### 1. 直接复用 `CronTaskCreateModal`

**选择**：在 Chat / Home 对话容器内挂载已有 `CronTaskCreateModal`，用本地 `useState` 控制 `open` 与 `initialValues`。

**理由**：弹窗已包含计划时间、发送对象、执行引擎；`initialValues` 在 `open` 时写入表单（见 `CronTaskCreateModal` 的 `useEffect`）。

**替代方案**：
- 导航到 `/cron?create=1&workflowId=...` — 需改路由与 Cron 页解析，改动面更大。
- 抽取全局 hook/store — 本需求仅两处入口，内联 state 足够。

### 2. 卡片只抛回调，不内嵌弹窗

**选择**：`WorkflowCard` 增加 `onCreateScheduledTask?: (workflowId: string) => void`，由 `Chat/index` 与 `HomeMainConversation` 打开弹窗。

**理由**：保持卡片纯展示，与现有 `onViewWorkflow` 模式一致。

### 3. 保存逻辑复制 Cron 页 OpenClaw 分支（最小片段）

**选择**：父组件 `onSave` 调用 `useCronStore.getState().createJob({ engineType: 'openclaw', payload: { ... } })`，成功后 `toast` + `onClose`；逻辑与 `Cron/index.tsx` `handleSave` 的 openclaw 新建分支对齐。

**理由**：不抽公共 hook，避免为单次入口过度抽象；与「只调起 Cron 弹窗」范围一致。

**替代方案**：抽 `createOpenClawCronJob` 工具函数 — 可后续重构，非本变更必须。

### 4. 按钮布局

**选择**：「查看工作流」与「创建定时任务」同一行 `flex gap-2`，样式与查看按钮同级（白底描边，Brand 图标色参考 `docs/sto-design.md` Brand-6）。

## Risks / Trade-offs

- **[Risk] Chat 与 Home 各有一份弹窗 state，逻辑重复** → Mitigation：两处各 ~15 行，接受；若第三处出现再抽取。
- **[Risk] Gateway 未连接时 OpenClaw 任务不可用** → Mitigation：与 Cron 页行为一致，不在卡片层单独拦截；弹窗保存失败由现有 toast 处理。
- **[Risk] `workflowId` 为空时不应展示按钮** → Mitigation：与「查看工作流」相同守卫条件。

## Migration Plan

纯前端增量：发版即生效，无数据迁移。回滚即移除按钮与弹窗挂载。

## Open Questions

- 保存成功后是否跳转 Cron 页？**建议**：仅 toast「任务已创建」，不强制跳转，减少打断对话。
