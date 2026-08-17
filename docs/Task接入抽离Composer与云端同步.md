# Task 接入抽离 Composer 与云端同步

> 状态：阶段二联调中；「extra 真源收敛」已编码；Host 已补 prompt 内 `~/.stoclaw/.../outbound` 裸路径 → file segments / composerAttachments；待客户端重启验证
> 日期：2026-08-14
> 关联：`src/pages/MyTask/components/TaskInstructionComposer.tsx`、`src/pages/MyTask/components/TaskCreateModal.tsx`、`src/pages/Chat/ChatInput.tsx`、`src/components/input-composer/`、`src/components/attachments/`、`src/lib/composer-gateway-text.ts`、`src/lib/dingtalk-mention-composer.ts`、`electron/scheduled-tasks/`、`shared/dingtalk-send/scheduled-task-dingtalk-lift.ts`、`sto-plugin/openclaw/sto-scheduled-task-tool/`、`sto-plugin/claude/claude-scheduled-task-tool/`、`memory-center/`（云端同步）

---

## 一、缺陷复盘（四次提交）

| 提交 | 实质 | 遗留问题 |
|------|------|----------|
| `a278b1a4` 抽离 | ChatInput 变装配层；能力进 `input-composer`/`attachments`；Task 已有独立装配 | 场景分叉开始 |
| `59eb3aa1` 三处样式 | Chat 走 inline + `buildComposerGatewayPayload`；edit segments | 双 skill 坐标；editDraft prop/事件双通道 |
| `57cb56f9` 切会话/前缀 | 修回显 sanitize | 仍依赖「脏 gateway 文本再洗」 |
| `0de30f22` 四源附件/@偏移 | **仅 Chat** 接菜单；修 file+skill 前导空白 | Task 仍 `pickFiles`+顶部 chips；共享 hook 带 Chat store |

**对 Task 影响最大的缺陷（当前码已存在）：**

1. **附件双路径**：Chat=`useComposerAttachSource`+inline；Task=`pickFiles`+`AttachmentChips`
2. **保存死路径**：Modal 已 `enableAttachments`/skill/workflow，但 `handleSubmit` 只交 `plainText`+mentions，不读 attachments/skillMetas/segments
3. **执行无 media**：`scheduled-task-executor` 用 `adapter.sendMessage`（无 media），`MainChatSendInput` 不含 media 字段，只读 `task.prompt`
4. **共享泄漏**：`use-workflow-picker-controller` 清 `useChatStore` pending workflow——Task 选工作流也碰 Chat store
5. **编辑回填弱**：编辑只 `setPlainText`+mentions，skill/file/workflow token 无法按 Chat 的 segments 还原
6. **收件人双写**：Modal 用 `prepareDingTalkAgentTurnMessage` 注入收件人块到 prompt + 写 `dingtalkRecipients` 列；prompt 不干净

---

## 二、目标形态

### 2.1 Task Composer 对齐 Chat

创建/编辑仍走 `TaskCreateModal` + `TaskInstructionComposer`，按设计文档「各自动装配」：

| 能力 | 决策 |
|------|------|
| 四源附件菜单 + DataCenter 弹窗 | 与 Chat 同套接入 |
| 附件展示 | `inlineAttachments: true`，去掉顶部 chips |
| Enter | 保持 `submitMode: 'newline'` |
| 语音 / Agent / editDraft 事件 | 不接 |
| 表单级工作流下拉 | **移除**；工作流只通过 composer 内 workflow token 选择（可多个） |
| 技能 / 工作流 / 收件人存储 | **真源仅 `extra_json`**（见 §2.5）；`skill_code` / `workflow_code` / `dingtalk_recipients_json` 新写入一律 `null`，历史一次迁移抬进 segments |

### 2.2 执行等价于自然对话

```mermaid
flowchart LR
  Save[TaskCreateModal 保存] --> Bake[buildComposerGatewayPayload]
  Bake --> DB[(SQLite: prompt + extra_json)]
  Bake --> Persist[附件复制到任务专属目录]
  Cron[cron 触发] --> Exec[executor]
  Exec --> Read[读 extra.composerAttachments 持久路径]
  Read --> Media[重建 media 数组]
  Media --> Send[adapter.sendMessageWithMedia]
```

定时任务执行发出的消息与自然对话完全一致：文件真实挂载、技能内联、工作流、钉钉提及。

### 2.3 收件人进 segments

```mermaid
flowchart LR
  subgraph 保存
    Composer[composer @mention token] --> Segments[extra.composerSegments mention segment]
    Composer --> Prompt[prompt 含 @displayName 文本]
  end
  subgraph 执行
    ReadExtra[executor 读 extra.composerSegments] --> Mentions[提取 DingTalkMention]
    Mentions --> SysAppend[buildSystemPromptAppend 指定即必发块]
    Prompt --> Engine[引擎 message]
    SysAppend --> Engine
  end
```

收件人完全在 composer @mention token，取消独立 `dingtalkRecipients` 列，prompt 保持干净。

### 2.4 云端同步

我的任务页新增「同步到云端」/「从云端拉取」按钮，将本地 SQLite 任务（含 composer 完整状态）备份/恢复到 memory-center 云端镜像存储。

### 2.5 extra 真源收敛（技能 / 工作流 / 收件人）

> **决策（2026-08-14）**：多技能、多工作流与收件人一样，完整状态只存在 `extra_json`；单值列不再承担业务语义。与 `dingtalk_recipients_json` 迁移同批完成。

**问题**：`skill_code` / `workflow_code` 是单值列，无法表达 composer 里多个 skill / workflow token；Modal 又保留表单级工作流下拉，与 composer 双通道。卡片「工作流」标签读列也会漏掉「只在 segments 里」的任务。

**约定**

| 项 | 决策 |
|----|------|
| 真源 | 只认 `extra.composerSegments`（+ `composerAttachments`） |
| Modal | **去掉**表单级工作流下拉；工作流仅通过 composer workflow token 插入（可多个） |
| 卡片标签 | 遍历 `extra.composerSegments`：存在 `type === 'workflow'` / `'skill'` 则展示对应标签（可多个） |
| 新写入 | `skill_code` / `workflow_code` / `dingtalk_recipients_json` **一律写 `null`**；NL / Modal / Host align 停写这三列 |
| 执行 / 编辑回填 | 只读 `prompt` + `extra`；不再依赖三列（历史降级仅保留到迁移完成前） |

**历史迁移（与收件人同批、一次跑完）**

扫描全量 `schedule_tasks`，对每个任务：

1. **收件人**：`dingtalk_recipients_json` 或 prompt 内收件人块 → `composerSegments` mention；剥离 prompt 块；列清空为 `null`
2. **技能**：若列有 `skill_code` 且 segments 中尚无对应 `type:'skill'` → 补 skill segment（slug=列值；title 能解析则带上）
3. **工作流**：若列有 `workflow_code` 且 segments 中尚无对应 `type:'workflow'` → 补 workflow segment（id=列值；name 缺省用 id）
4. 写回 `extra_json`（+ 必要时干净 `prompt`）；三列置 `null`
5. marker 防重跑；支持 `dryRun`

迁移后：多技能 / 多工作流只存在于 segments；列不再被 UI / 执行 / NL 依赖。SQLite **不删列**（避免大迁移与云端表对齐成本），语义上视为废弃兼容字段。

---

## 三、阶段一：现有代码缺陷整理（准备阶段）

**目标**：把 ChatInput 抽离后散落的缺陷收口，为阶段二任务开发扫清障碍。不引入新功能，只修缺陷 + Task 假可用附件降级。完成后提交推送。

### 1.1 收敛共享泄漏

`src/components/input-composer/use-workflow-picker-controller.ts`：清除 pending workflow 改为可选回调注入。Task 不传回调则不清 Chat store，避免 Task 选工作流误碰 Chat store。

### 1.2 收敛双 skill 坐标

`src/hooks/dispatch-chat-send.ts` / `src/stores/chat/send-actions.ts`：发送链路同时传 `skillMeta`（旧单字段）+ `skillMetas`（新数组），下游 `canSend` / bake 两套判断。统一为 `skillMetas`，`skillMeta` 仅做 deprecated 兼容派生。

> 注：`CHAT_EDIT_DRAFT_EVENT` 双通道（ChatMessage event + ChatInput prop）是 **Chat 专属**缺陷，Task 编辑回填走受控 `value`/`initialMentions` props，不走 event，不影响 Task。本阶段只收敛 skill 坐标，editDraft 双通道留待 Chat 专项。

### 1.3 偏移逻辑收敛

`src/lib/dingtalk-mention-composer.ts`：`serializeMentionEditor` / `findPlainTextBoundary` / `resolveTrimmedSkillOffset` 偏移已对齐（`0de30f22`），补单测锁住「file+skill+mention+text」混合序列偏移一致性。

### 1.4 移动 TaskInstructionComposer 到 MyTask 目录

`src/components/task/TaskInstructionComposer.tsx` 是 MyTask 专用装配组件，从 `src/components/task/` 移到 `src/pages/MyTask/components/`，并更新所有 import 路径。

### 1.5 Task 假可用附件降级

`TaskInstructionComposer` 已 `enableAttachments=true`，但 `TaskCreateModal.handleSubmit` 不读 attachments → 用户能选文件但保存丢失。

阶段一先把 `enableAttachments` 默认值改 `false`（TaskCreateModal 显式传 `enableAttachments={false}`），避免误导。阶段二再开并补齐保存路径。

### 1.6 提交推送

阶段一完成后提交推送，作为阶段二起点。

### 1.7 历史数据迁移：列 / prompt 块 → extra.composerSegments

**背景**：收件人、技能、工作流均改为 **extra 真源**（见 §2.5）后，历史任务可能仍只有列或 prompt 块。新 executor / 卡片 / 编辑回填期望从 `extra.composerSegments` 读取。需**一次性**迁移（与去掉 Modal 工作流下拉、停写三列同一交付）。

**迁移脚本**：扩展现有收件人 lift（[`liftDingTalkRecipientsFromPrompts`](../electron/scheduled-tasks/scheduled-task-service.ts) / [`lift-scheduled-task-dingtalk-recipients.ts`](../electron/scripts/lift-scheduled-task-dingtalk-recipients.ts)），或合并为统一 `lift-scheduled-task-composer-columns`：

- 扫描全量任务，对每个任务：
  1. **收件人**：从 `dingtalk_recipients_json` 或 prompt 内收件人块解析 → mention segment；剥离 prompt 块
  2. **技能**：`skill_code` 有值且 segments 无对应 skill → 补 skill segment
  3. **工作流**：`workflow_code` 有值且 segments 无对应 workflow → 补 workflow segment
  4. 写回 `extra_json` +（必要时）干净 `prompt`；三列均置 `null`
- marker 文件防重跑；支持 `dryRun`；启动时自动跑一次（或手动触发）

**钉钉提示词内容变更**：不需要改历史数据。`SCHEDULED_TASK_DINGTALK_RULES` / `DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK` 是执行期 `buildSystemPromptAppend` 动态拼接，不存进 prompt，改文本后所有任务下次执行自动用新内容。

---

## 四、阶段二：任务模块开发

**目标**：Task Composer 对齐 Chat 完整能力；保存完整 composer 状态到 SQLite（**extra 真源**，停写 skill/workflow/收件人列）；去掉 Modal 表单工作流下拉；执行器重建 media；NL 路径对齐；合并历史列→segments 迁移；云端同步另见阶段三。

### 2.1 TaskInstructionComposer 升级

对齐 `src/pages/Chat/ChatInput.tsx` 附件接线：

- `useInputComposerCore({ inlineAttachments: true, submitMode: 'newline', ... })`
- `useComposerAttachSource({ onPickLocal: pickFiles, onConfirmDataCenter: stageDataCenterFiles })`
- Toolbar `onAttach={attachSource.openAttachMenu}` + `attachButtonRef`
- 挂载 `ComposerAttachMenu` + `DataCenterFilePickerModal`（portal，避免 Modal 裁切）
- `chips={null}`；去掉 `AttachmentChips` 顶部区
- 强化 `onSnapshotChange`（带 attachments 引用），供 Modal 保存使用

### 2.2 TaskCreateModal 保存 bake（extra 真源）

**背景**：收件人已取消列双写；技能 / 工作流同样改为只进 `extra.composerSegments`（§2.5），并**移除**表单级工作流下拉。

**保存（创建+编辑同一 `handleSubmit`）：**

- 从 composer 取 `segments` + `attachments` + `plainText`
- 调用 `src/lib/composer-gateway-text.ts` 的 `buildComposerGatewayPayload`（复用 Chat 的 `resolveSkillPrompt`）
- `prompt` = `gatewayText`（技能 defaultPrompt 内联 + 文件占位符 + `@displayName` 文本 + 正文）—— 不再 `prepareDingTalkAgentTurnMessage` 包装
- `extra.composerSegments` = `persistedSegments`（含 file/skill/workflow/mention/text；可多个 skill / workflow）
- `extra.composerAttachments` = `[{ fileName, mimeType, persistentPath, provenance }]`
- **不写** `dingtalkRecipients` / `skillCode` / `workflowCode`（落库为 `null`）

**移除**：

- Modal 不再调 `prepareDingTalkAgentTurnMessage`
- Modal **去掉**表单级工作流下拉（`selectedWorkflow` / 锁框逻辑）；工作流只靠 composer token
- `src/pages/MyTask/index.tsx` 不再传 `dingtalkRecipients` / 依赖列回填工作流

**卡片**：`TaskCard` 工作流 / 技能标签改为遍历 `task.extra.composerSegments`，不再读 `task.workflowCode` / `task.skillCode`。

### 2.3 附件持久化

保存时把 ready 附件复制到任务专属持久目录：

- 路径：`~/.stoclaw/scheduled-tasks/{taskId}/attachments/{attachmentId}-{fileName}`
- `extra.composerAttachments[].persistentPath` 存此路径
- 编辑保存时：对比新旧附件集，删除不再引用的持久文件，新增的复制
- 本地附件 + 数据中心附件都复制（数据中心附件也下载到本地持久目录，保证 cron 触发时可用）

> **SQLite 字段**：`prompt` + `extra_json`（`composerSegments` + `composerAttachments`）即为业务真源。`skill_code` / `workflow_code` / `dingtalk_recipients_json` **保留列但不写、不读**（历史迁移后恒为 `null`）；**不新增列**，也不强删列（与云端同结构对齐成本更低）。

### 2.4 执行器改造（核心，含收件人从 segments 还原）

`electron/scheduled-tasks/scheduled-task-executor.ts` + `electron/services/chat-send-service.ts`：

- `MainChatSendInput` 增加 `media?: Array<{ filePath, mimeType, fileName }>`
- executor 读 `task.extra.composerAttachments`，过滤 `persistentPath` 仍存在的文件，构建 media 数组
- executor 改用 `adapter.sendMessageWithMedia`（有 media 时）/ `adapter.sendMessage`（无 media 时）
- `electron/engines/types.ts` `EngineSendWithMediaParams` 已有 media 字段，adapter 已支持（`openclaw-adapter` / `claude-adapter` 均已实现 `sendMessageWithMedia`）
- `runMainChatSend` 透传 media 到 dispatch

**钉钉收件人还原（关键变更）：**

- `shared/dingtalk-send/scheduled-task-dingtalk-lift.ts` 的 `resolveScheduledTaskDingTalkRecipients` 改 **extra 优先**降级链：
  1. `extra.composerSegments` 的 mention segment → 提取 `DingTalkMention[]`
  2. `task.dingtalkRecipients` 列（历史兼容）
  3. `task.prompt` 内收件人 JSON 块解析（最老历史降级）
- `electron/scheduled-tasks/scheduled-task-service.ts` 的 `buildSystemPromptAppend` 从 extra 提取的 mentions 构造"指定即必发"块（不再依赖 prompt 内块）
- `message = task.prompt`（干净，含 `@displayName` 文本，引擎能看到 @ 谁，但收件人规则由 systemPromptAppend 注入）

### 2.5 编辑回填

`src/pages/MyTask/components/TaskCreateModal.tsx` 编辑模式（`job` 有值）：

- 有 `extra.composerSegments` 时：走 segments 重建（对齐 Chat edit draft 的 `persistedSegmentsToComposer` 路径），mention / skill / file / workflow token 从 segment 还原
- 用 `extra.composerAttachments` 的 `persistentPath` 重建附件 token（文件仍存在则正常展示，不存在则 error chip）
- **不**从 `workflowCode` 列预填表单下拉（下拉已移除）
- 无 `extra.composerSegments` 的历史任务：迁移前可短暂降级；迁移后应已有 segments

### 2.6 NL 自然创建路径对齐

OpenClaw / Claude 的 create 工具：

- 仍可接收 `recipients` / `skills` / `workflowCode` 等参数（便于模型传结构化字段），但 Host **只写入** `extra.composerSegments`（+ attachments），**不写** `dingtalk_recipients_json` / `skill_code` / `workflow_code`
- prompt 保持干净；多技能 / 多工作流全部进 segments（不要压成单值列）
- 可用会话用户消息回填漏传字段（见 `scheduled-task-nl-hints`），回填目标同样是 extra，不是列
- 历史任务（已有列）由迁移脚本抬进 segments 后，降级链可收敛为仅读 extra

### 2.7 客户端测试

阶段二客户端开发完成后，进行全面测试：

- 创建 Task：插文件 + 多技能 + 多工作流 + @钉钉 → 保存 → 检查 DB（prompt 干净 / 三列为 null / extra 含全部 segments + composerAttachments）
- Modal：**无**表单工作流下拉；仅 composer token 可选工作流
- 卡片：有 workflow/skill segment 时显示标签（不依赖列）
- 编辑 Task：回填 segments + 附件 token 一致；迁移后历史任务可回填
- 定时触发：cron 到点执行 → media / 技能 / 钉钉 systemPromptAppend / 干净 prompt
- NL 创建：结构化字段进 extra，三列 null
- 历史迁移：dryRun + 实跑后列清空、segments 齐全

**测试通过后进入阶段三。**

---

## 五、阶段三：云端同步（仅计划，待客户端测试完毕后开发）

> **本阶段仅制定计划，暂不编码。等阶段二客户端任务全部测试完毕后，再进行开发。**
>
> **策略真源（2026-08-17）**：历史归属认领、登录后首次上云检测、手动拉取、日常「先远程后本地 await」等产品策略，见 [`docs/定时任务云端同步与历史归属.md`](./定时任务云端同步与历史归属.md)。下文 §3.1–3.3 仍描述 memory-center 表结构与路由骨架；冲突/触发时机以策略文档为准。

### 3.1 云端 schema（memory-center）

[memory-center](../../memory-center) 新建一张与本地 `schedule_tasks` **同结构**的表（不复用现有知多星 `scheduled_tasks` 表，字段模型不同），加 `owner_user_id` 区分账号：

- alembic 迁移：新建 `schedule_tasks_cloud` 表
  - 与本地 [`schedule_tasks`](../electron/db/migrations/0011-schedule-tasks.ts) 字段一一对应：
    - `id` TEXT PK, `owner_user_id` TEXT NOT NULL（索引）, `name`, `enabled` INT, `cron_expr`, `engine_type`, `prompt`, `agent_id`
    - `workflow_code`, `skill_code`, `dingtalk_recipients_json`（与本地一致：保留列但业务真源在 `extra_json`；云端同步原样镜像，可为 null）
    - `model`, `provider`, `account_id`, `workspace_path`
    - `my_artifact_folder_path`, `shared_artifact_folder_path`, `permission_profile`, `timeout_sec`
    - `retry_policy_json`, `failure_policy_json`, `extra_json`（存 composerSegments + composerAttachments）
    - `next_run_at`, `last_scheduled_for`, `last_recovered_at`, `cron_expr_snapshot`
    - `created_at`, `updated_at`, `deleted_at`, `version`, `created_by`, `updated_by`
  - 唯一约束：`(owner_user_id, id)`（同账号下 id 唯一）
  - 索引：`owner_user_id`（按账号列出）
- [`schemas/scheduled_task.py`](../../memory-center/src/schemas/scheduled_task.py) 新增：
  - `ScheduleTaskCloudUpsertRequest`：与本地 `ScheduleTask` 同构 + `owner_user_id`
  - `ScheduleTaskCloudResponse`：云端表所有字段
  - `ScheduleTaskCloudListResponse`：`items: list[ScheduleTaskCloudResponse]`

### 3.2 云端路由（memory-center）

`memory-center/src/api/claw_api/v1/scheduled_tasks.py` 新增同步路由（或新文件 `schedule_tasks_cloud.py`）：

- `POST /scheduled-tasks/cloud/batch-upsert`：批量 upsert（一键同步全量，按 `owner_user_id` + `id` 匹配）
- `GET /scheduled-tasks/cloud/list`：列出当前用户所有云端任务
- `POST /scheduled-tasks/cloud/delete`：按 `id` 逻辑删除
- 鉴权复用 `resolve_scheduled_task_owner_user_id`
- service 层新建 `ScheduleTaskCloudService`（`repositories/schedule_task_cloud_repository.py`）
- upsert 语义：`owner_user_id` + `id` 存在则更新（`version` 冲突提示），不存在则插入

### 3.3 客户端同步 UI

`src/pages/MyTask/index.tsx`（或 `TaskToolbar`）新增按钮：

- 「同步到云端」：读本地 SQLite 全量任务 → POST `/scheduled-tasks/cloud/batch-upsert` → 提示成功/失败数（**手动兜底**；正常首次上云见策略文档登录后检测）
- 「从云端拉取」：GET `/scheduled-tasks/cloud/list` → 本地 upsert（按 `id` + `version` 合并；**仅此入口自动恢复，登录后不自动 pull**）
  - **显隐**：进入「我的任务」时调 Host `sync-status`；仅当存在「云端比本地新」（缺本地 id 或云端 version 更大）时显示按钮，详见 [`定时任务云端同步与历史归属.md`](./定时任务云端同步与历史归属.md) §5.3
- host-api 调用经 `electron/api/routes/scheduled-tasks.ts` 代理到 memory-center（需在 `electron/main/ipc/host-api-proxy.ts` 增加路由透传）
- 同步状态：loading / 成功 toast / 失败明细
- 拉取时附件持久目录重建：若 `extra.composerAttachments[].persistentPath` 文件不存在，标记 error chip（不阻塞任务保存）

另见策略文档：登录后归属认领 + 首次上云检测（后台、不挡进首页）；日常 CRUD 先远程后本地 await。

### 2.10 测试与文档

**单测：**

- 阶段一：偏移一致性（file+skill+mention+text 混合）/ skill 坐标统一 / workflow picker 不泄漏
- 阶段二：
  - `TaskInstructionComposer` 附件菜单回调冒烟
  - Modal 保存 payload：prompt 干净 / 三列为 null / extra.composerSegments（含多 skill·workflow·mention）/ extra.composerAttachments
  - Modal **无**表单工作流下拉
  - TaskCard 标签：遍历 segments，不读列
  - executor 重建 media：有/无附件 / 持久路径失效
  - executor 钉钉收件人还原：extra 优先（迁移后可去掉列/prompt 降级或仅测兼容）
  - NL 工具写 extra，不写三列
  - 编辑回填：segments 重建 / 迁移后历史任务
  - 合并迁移脚本：收件人 + skill_code + workflow_code → segments；dryRun / 实跑 / marker

**文档：**

- `docs/Composer附件-上传菜单与数据中心选文件.md`：勾选 Task 四源菜单；注明执行期 media 重建
- [`docs/定时任务云端同步与历史归属.md`](./定时任务云端同步与历史归属.md)：归属认领 / 首次上云检测 / 手动拉取 / 日常双写 / version 与账号隔离（阶段三策略真源）
- 更新 NL 工具说明：收件人写 extra.composerSegments

---

## 六、关键文件

**阶段一**

- `src/components/input-composer/use-workflow-picker-controller.ts`
- `src/hooks/dispatch-chat-send.ts`
- `src/stores/chat/send-actions.ts`
- `src/lib/dingtalk-mention-composer.ts`
- `src/components/task/TaskInstructionComposer.tsx` → 移到 `src/pages/MyTask/components/`
- `src/pages/MyTask/components/TaskCreateModal.tsx`

**阶段二 — 客户端 Composer / 保存 / 执行**

- `src/pages/MyTask/components/TaskInstructionComposer.tsx`（阶段一已移动）
- `src/pages/MyTask/components/TaskCreateModal.tsx`
- `src/pages/MyTask/index.tsx`
- `src/lib/composer-gateway-text.ts`
- `electron/scheduled-tasks/scheduled-task-executor.ts`
- `electron/scheduled-tasks/scheduled-task-service.ts`
- `electron/services/chat-send-service.ts`
- `shared/dingtalk-send/scheduled-task-dingtalk-lift.ts`

**阶段二 — NL 自然创建**

- `sto-plugin/openclaw/sto-scheduled-task-tool/index.ts`
- `sto-plugin/openclaw/sto-scheduled-task-tool/host-api-client.ts`
- `sto-plugin/claude/claude-scheduled-task-tool/tools.ts`
- `electron/scheduled-tasks/scheduled-task-nl-create.ts`
- `electron/scheduled-tasks/scheduled-task-nl-hints.ts`

**阶段二 — extra 真源 / 合并迁移**

- `src/pages/MyTask/components/TaskCreateModal.tsx`（去工作流下拉）
- `src/pages/MyTask/components/TaskCard.tsx`（标签读 segments）
- `electron/scheduled-tasks/scheduled-task-service.ts`（create 停写三列）
- `electron/scripts/lift-scheduled-task-dingtalk-recipients.ts`（扩展或合并为列→segments）
- `shared/dingtalk-send/scheduled-task-dingtalk-lift.ts`

**阶段二 — 客户端同步**

- `src/pages/MyTask/index.tsx`
- `electron/api/routes/scheduled-tasks.ts`
- `electron/main/ipc/host-api-proxy.ts`

**阶段二 — 云端 memory-center**

- `memory-center/src/api/claw_api/v1/scheduled_tasks.py`（新增 cloud 路由）
- `memory-center/src/schemas/scheduled_task.py`（新增 cloud schema）
- `memory-center/alembic/versions/`（新建 `schedule_tasks_cloud` 表迁移）
- `memory-center/src/repositories/schedule_task_cloud_repository.py`（新建）
