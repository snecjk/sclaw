## Why

当前 StoClaw 同时维护两个定时任务页面：旧版本地 Cron 页面（`/cron`）和新版云端 Scheduled Tasks 页面（`/scheduled-tasks`）。由于本期产品计划暂缓上线新版云端定时任务，需要以旧版页面为主入口，并将其 UI/UX 全面升级至新版水准，避免用户面对两套不同体验的定时任务界面，同时减少维护两套并行实现的成本。

## What Changes

- **隐藏云端定时任务导航入口**：注释/移除 Sidebar 中 `/scheduled-tasks` 路由的可见入口，云端定时任务功能保留在代码中但不对外暴露
- **导航标签调整**：Sidebar 中旧版 `/cron` 入口标签从「定时任务（旧）」改为「定时任务」；原「定时任务」改为「定时任务（云）」（云端入口隐藏后此标签不再显示，但保留代码中的标识）
- **旧版 Cron 页面 UI 全面升级**：参照新版 `/scheduled-tasks` 的样式和交互，对 `/cron` 页面进行全面改造：
  - 页面布局：采用新版 `max-w-7xl` 全高弹性布局，替换现有 `max-w-5xl` 居中布局
  - 顶部操作区（TaskHero）：新增任务搜索框、排序下拉（按创建时间升/降序、名称 A-Z/Z-A）、新建定时任务按钮及任务数量提示
  - 卡片网格：从 2 列玻璃拟态卡片改为 3 列响应式圆角卡片网格（`TaskCard` 风格），支持内联开关切换、立即运行按钮、更多操作下拉菜单（编辑/删除）
  - 创建/编辑对话框：将现有预设按钮+原始 Cron 表达式输入替换为可视化 `SchedulePicker`（按天/按周/按月/仅一次 + 时间选择器）
  - 空状态：从简单图标+描述升级为带推荐任务模板卡片（客户成本分析、每日总部对账结果、每日异常客户监控）的空状态页面
  - 搜索与排序：支持按名称/描述搜索任务；支持多维度排序
- **样式对齐**：所有可见元素遵循 `docs/sto-design.md` 的 STO 主题宪法（Brand/Grey/语义化 token 体系），去除玻璃拟态旧风格
- **后台反馈增强**：参照新版错误处理，增加名称冲突（409）、字段校验（422）等场景的用户提示

## Capabilities

### New Capabilities
- `cron-local-task-ui-refactor`: 旧版本地定时任务页面 UI/UX 全面升级。涵盖页面布局、搜索排序、卡片网格、创建/编辑对话框、空状态推荐模板、可视化 SchedulePicker、错误提示增强等用户可见的交互改进。

### Modified Capabilities
- `cron-cloud-task`: 导航与入口策略调整。云端定时任务页面入口在 Sidebar 中隐藏；旧版 Cron 页面成为唯一的用户可见定时任务主入口；统一任务列表在可见层暂时仅展示本地任务（云端任务数据接口保留，为后续上线做准备）。

## Impact

- **受影响的页面**：`src/pages/Cron/index.tsx` 及所有旧版 Cron 子组件
- **新增的页面/组件**：新版风格的 Cron 子组件（搜索栏、排序器、卡片、对话框、SchedulePicker、空状态等）
- **导航/路由**：`src/components/layout/Sidebar.tsx` 中的路由项调整；`src/App.tsx` 路由表保持不变
- **状态管理**：`src/stores/cron.ts` 可能需要扩展以支持搜索过滤和排序状态
- **类型定义**：`src/types/cron.ts` 可能需要补充新交互所需的类型
- **后端 API**：不改变现有 `electron/api/routes/cron.ts` 的 Gateway RPC 调用方式
- **云端功能**：`/scheduled-tasks` 相关代码（store、service、route、组件）保留但不在导航中暴露
- **主题规范**：所有新增/修改的 UI 元素须对齐 `docs/sto-design.md`
