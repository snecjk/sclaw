# 计划：MyTask 关联工作流 (workflowCode) 的持久化与编辑回显

## Context

用户在 MyTask 新建弹窗中已增加了「关联工作流」下拉选项，选择后自动填充描述并提交 `workflowCode`。但存在以下问题：

1. **创建时 workflowCode 被丢弃** — `handleSave` 的 OpenClaw/Claude 创建/更新路径没有传 `workflowCode`
2. **OpenClaw Gateway 不接受 workflowCode** — POST/PUT handler 不传递，GET handler (`transformCronJob`) 不提取
3. **Claude 路径不支持 workflowCode** — 类型/服务/路由全链路无此字段
4. **编辑时不回显工作流** — `computeInitialValues` 总是返回 `selectedWorkflow: ''`
5. **TaskCard 用 regex hack** — 用 `description.match(/wf_\w+/)` 判断，而非用 `workflowCode`

## 方案

**OpenClaw**: 复用 `CronDescriptionMeta` 模式，将 workflowCode 存入 `description` JSON 元数据（与 `agentId`、`dingTalkMentions` 同构）。Gateway 不感知此字段，Electron 路由层注入/提取。

**Claude**: 新增 `workflowCode` 字段到类型/服务/路由层。Claude 持久化用 `definitions.json`（无严格 schema），加字段自然序列化。

---

## 修改步骤

### 步骤 1: Electron 路由层 — OpenClaw description 扩展

**文件**: `electron/api/routes/cron.ts`

- **`CronDescriptionMeta`** (line 565) 增加 `workflowCode?: string`
- **`buildCronDescription`** (line 588) 签名增加 `workflowCode?: string` 参数，写入 meta
- **`transformCronJob`** (line 529) 从 `parseCronDescriptionMeta(job.description)` 提取 `workflowCode`，添加到返回对象
- **POST handler** (line 727) — `parseJsonBody` 类型增加 `workflowCode?: string`；将 `input.workflowCode` 传给 `buildCronDescription`
- **PUT handler** (line 758) — 处理 `workflowCode`：当 patch 含 workflowCode 时，合并到 description JSON

### 步骤 2: 前端 description 元数据工具函数

**文件**: `src/lib/scheduled-task-recipients.ts`

- **`CronDescriptionMeta`** (line 120) 增加 `workflowCode?: string`
- **`buildCronDescriptionMeta`** (line 136) 增加 `workflowCode?: string` 参数，写入 meta
- **`parseCronDescriptionMeta`** (line 125) 返回值自然获得 `workflowCode`（JSON.parse 不需改）

### 步骤 3: Electron 路由层 — Claude 类型/服务扩展

**文件**: `electron/services/claude-scheduled-task-service.ts`
- **`ClaudeScheduledTaskCreateInput`** (line 46) 增加 `workflowCode?: string`
- **`buildDefinitionFromCreateInput`** (line 104) 增加 `workflowCode` 字段映射
- **`applyUpdate`** (line 130) 增加 `workflowCode` 字段复制

**文件**: `electron/services/claude-scheduled-task-store.ts`
- **`ClaudeScheduledTaskDefinition`** (line 11) 增加 `workflowCode?: string`
- **`ClaudeScheduledTaskSummary`** 增加 `workflowCode?: string`

**文件**: `electron/api/routes/claude-scheduled-tasks.ts`
- **POST handler** (line 28) — `parseJsonBody` 类型增加 `workflowCode?: string`

### 步骤 4: 前端类型层

**文件**: `src/types/cron.ts`
- **`CronJobUpdateInput`** (line 72) 增加 `workflowCode?: string`

**文件**: `src/types/scheduled-task.ts`
- **`ClaudeScheduledTask`** (line 94) 增加 `workflowCode?: string`
- **`ClaudeScheduledTaskCreateInput`** (line 112) 增加 `workflowCode?: string`
- **`ClaudeScheduledTaskUpdateInput`** (line 124) 增加 `workflowCode?: string`

### 步骤 5: Cron Store — 传递 workflowCode

**文件**: `src/stores/cron.ts`
- **`updateJob` Claude 分支** (line 207) 增加 `workflowCode` 条件拼接

### 步骤 6: MyTask 页面 — 传递 workflowCode

**文件**: `src/pages/MyTask/index.tsx`
- `handleSave` **4 个路径**都增加 `workflowCode: input.workflowCode`：
  - OpenClaw 创建 (line 322)
  - OpenClaw 更新 (line 293)
  - Claude 创建 (line 311)
  - Claude 更新 (line 280)

### 步骤 7: MyTask 弹窗 — 编辑回显

**文件**: `src/pages/MyTask/components/TaskCreateModal.tsx`
- `computeInitialValues` **两个分支**回显 `workflowCode`：
  - OpenClaw (line 77): `selectedWorkflow: job.workflowCode || ''`
  - Claude (line 67): `selectedWorkflow: job.workflowCode || ''`
- auto-fill effect 修正：编辑回显触发 `selectedWorkflow` change 时会重新 auto-fill instructions，需确保初始化回显时保留 job 原始 instructions 而不被 effect 覆盖

### 步骤 8: TaskCard — 用 workflowCode 替代 regex

**文件**: `src/pages/MyTask/components/TaskCard.tsx`
- 将 `task.description?.match(/wf_\w+/)?.[0] ?? null` (line 87) 改为 `task.workflowCode ?? null`

---

## 修改文件清单

| # | 文件 | 改动要点 |
|---|------|---------|
| 1 | `electron/api/routes/cron.ts` | CronDescriptionMeta + build + transform + POST/PUT handler |
| 2 | `src/lib/scheduled-task-recipients.ts` | CronDescriptionMeta + buildCronDescriptionMeta 增加 workflowCode |
| 3 | `electron/services/claude-scheduled-task-service.ts` | CreateInput + buildDefinition + applyUpdate |
| 4 | `electron/services/claude-scheduled-task-store.ts` | Definition + Summary 类型 |
| 5 | `electron/api/routes/claude-scheduled-tasks.ts` | POST handler parseJsonBody 类型 |
| 6 | `src/types/cron.ts` | CronJobUpdateInput 增加 workflowCode? |
| 7 | `src/types/scheduled-task.ts` | 三个 Claude 类型增加 workflowCode? |
| 8 | `src/stores/cron.ts` | updateJob Claude 分支增加 workflowCode |
| 9 | `src/pages/MyTask/index.tsx` | handleSave 4 个路径传 workflowCode |
| 10 | `src/pages/MyTask/components/TaskCreateModal.tsx` | computeInitialValues 回显 + auto-fill effect |
| 11 | `src/pages/MyTask/components/TaskCard.tsx` | workflowCode 替代 regex |

## 验证方式

1. 新建 OpenClaw 任务 → 选择工作流 → 保存 → 刷新 → 卡片显示"工作流"badge
2. 编辑 OpenClaw 任务 → 正确回显已选工作流、描述、计划时间
3. 取消关联工作流 → 保存 → 再编辑 → 工作流下拉为空
4. 同样验证 Claude 引擎的创建/编辑/取消流程
5. `GET /api/cron/jobs` 返回中 workflowCode 字段正确
6. `GET /api/claude-scheduled-tasks` 返回中 workflowCode 字段正确
7. TypeScript 编译无新增错误
