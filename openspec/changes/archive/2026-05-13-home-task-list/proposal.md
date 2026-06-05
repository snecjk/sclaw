## Why

归档设计稿要求首页三张数据概览卡与侧栏「任务列表」分组一一对应；用户从卡片或侧栏进入时，应打开该任务类型下**最新一条**业务数据视图（含标题、摘要、表格与底部助手区），而不是跳转到无关路由（如当前占位 `/chat`、`/models`）。本变更用 OpenSpec 固化该信息架构，并以可替换的静态/本地数据层为第一步，为后续接入真实报表接口留出边界。

## What Changes

- 引入稳定路由 `/tasks/:taskId`（`taskId` 为固定枚举键），同一 URL 表示「该任务的最新一条」语义。
- 侧栏在主导航与工作台分组之间渲染「任务列表」分组标题与三条文本链；其中「总部对账结果」保留设计稿中的红点提示占位。
- 首页三张概览卡分别跳转到与侧栏一致的三条 `taskId` 路由。
- 新增任务详情表面：顶栏返回首页、标题行、摘要与表格区（占位文案与结构对齐图二）、底部复用既有首页助手 composer 行为（仍走既有 chat 发送链路约束）。

## Capabilities

### New Capabilities

- `home-task-list-surface`：任务列表路由、最新数据详情页、与首页卡片/侧栏的键对齐及 i18n；数据层允许为本地 mock。

### Modified Capabilities

- `navigation-sidebar-sto-prototype`：将「任务列表」从占位分组落实为可导航的三条任务项（展开态）；折叠态可不展示该项列表（本变更在 design 中说明取舍）。
- `dashboard-sto-home-surface`：概览卡片的导航目标从占位路由改为对应 `/tasks/:taskId` 最新视图。

## Impact

- `src/App.tsx`、`src/pages/TaskDetail/*`、`src/components/layout/Sidebar.tsx`、`src/pages/Home/HomeSummaryCards.tsx`。
- 新增 `src/lib/sto-tasks.ts`（或等价模块）与 `src/i18n/locales/*/tasks.json`、`common.json` 侧栏键。
- `README.md` 中路由/页面说明一句（若已有「页面」枚举则追加）。
