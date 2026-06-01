## Why

当前 Cron（定时任务）页面以技术导向的卡片列表呈现，创建表单使用 cron 表达式预设按钮，对非技术用户不够友好。设计团队提供了新版任务中心方案，采用更贴近业务语义的卡片布局、自然语言描述导向的创建流程，以及推荐任务快速 onboarding 机制。同时后端提供了独立的 STO Scheduled Tasks API，需以此为基础重建定时任务管理页面，并妥善处理用户历史本地任务。

## What Changes

- **新建页面替换现有 Cron 页面**：基于新的 `scheduled-tasks` 后端 API 新建定时任务中心页面，逐步替换现有 `/cron` 路由下的实现。
- **页面布局重构**：引入 Hero 区域（标题 + 描述 + 搜索 + 排序 + 新建按钮），替换现有的统计卡片头部。
- **任务卡片改版**：从现有的 2 列技术信息卡片改为信息更聚焦的卡片设计，包含任务标题（可点击编辑）、启用/暂停开关、详细任务描述、执行计划时间、"测试运行"按钮和折叠更多菜单（编辑/删除）。
- **创建/编辑弹窗改版**：
  - 新增"关联工作流"选择字段（后端接口会同步调整支持 `task_type: WORKFLOW`）。
  - "指令描述"从 3 行输入框扩展为 12 行大文本区域，支持自然语言描述。
  - 计划时间选择器从 cron 表达式预设按钮改为**频率联动选择器**（一次性/每天/工作日/每周/每月），根据频率动态展示日期选择器、星期多选或月内日期选择，配合独立时间选择器。
- **空状态 + 推荐任务**：无任务时展示插图引导 + 预制推荐任务卡片，支持一键快速添加，降低创建门槛。
- **删除确认弹窗**：独立的二次确认对话框。
- **历史本地任务迁移引导**：不自动同步本地 Gateway cron 任务到云端，首次进入页面时检测历史任务并提示迁移；迁移过程预填已有信息，但要求用户补全云端必填字段（网点、通知方式等）。

## Capabilities

### New Capabilities
- `cron-task-center-layout`：定时任务中心页面布局与交互，包括 Hero 区域、卡片网格、搜索排序、空状态、推荐任务引导、历史本地任务迁移提示。
- `cron-task-schedule-picker`：联动式计划时间选择组件，支持按频率（一次性/每天/工作日/每周/每月）动态切换子控件，并提供时间选择；前端负责将友好选择转换为标准 5 段 cron 表达式。
- `cron-task-migration`：本地 Gateway cron 历史任务的检测与半自动迁移引导，包括字段预填和必填项补全。

### Modified Capabilities
- `cron-cloud-task`：定时任务 CRUD 从原有的 Gateway RPC + Cloud Task API 迁移至 STO Scheduled Tasks API（`baseinfo-aimemory*.sto.cn`）；创建/编辑表单新增"关联工作流"字段、大文本指令输入区域，以及新的计划时间选择器交互。

## Impact

- **前端页面**：新建 `src/pages/ScheduledTasks/`（或类似）页面组件，最终替换 `/cron` 路由；现有 `src/pages/Cron/index.tsx` 逐步废弃。
- **类型定义**：需新建对接 `scheduled-tasks` API 的类型（如 `ScheduledTask`, `ScheduledTaskCreateInput` 等），与现有 `src/types/cron.ts` 中的 Gateway/Cloud 类型并存；`task_type` 将支持 `WORKFLOW`（后端接口调整中）。
- **状态管理**：`src/stores/cron.ts` 需新增或扩展以支持 `scheduled-tasks` API 的 CRUD、前端本地搜索过滤与排序；历史本地任务的检测状态单独管理。
- **API 接入**：需在 `src/lib/host-api.ts` 或 `src/lib/api-client.ts` 中封装对 `baseinfo-aimemory*.sto.cn` 的 HTTP 调用（Claw SSO 鉴权）。
- **组件复用**：可借鉴技能广场（`src/pages/Skills/index.tsx`）的搜索过滤、卡片网格、Switch 开关、Sheet 详情面板等已有模式。
- **主题样式**：需遵循 `docs/sto-design.md` 的 STO UI theme constitution 进行颜色、间距和玻璃拟态（glass） token 的适配。
- **国际化**：新增/改版的文案需要同步到翻译文件中。
- **过渡策略**：新旧页面需有灰度或版本过渡机制，确保用户历史本地任务在迁移前仍可查看。
