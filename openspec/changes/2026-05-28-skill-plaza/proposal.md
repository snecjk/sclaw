## Why

现有 Skills 页面（`src/pages/Skills/index.tsx`，1470 行）是一个面向开发者的管理工具，以表格 / Sheet 形式展示已安装技能并提供 ClawHub / STO 市场的 Tab 式安装入口。该形态与 STO 产品原型中"技能广场"的用户友好型市场门店形态存在显著差异：

- 缺少业务分类导航（经营管理 / 财务管理 / 异常监控 / 外部市场 / 办公）
- 缺少卡片式视觉展示（图标、描述、安装数、使用数、预计积分）
- 缺少"使用"直接跳转对话的能力
- 缺少工作流技能的详情弹窗（介绍、步骤、调度输出、数据概览）
- 缺少排序（热门 / 最近）与视图切换（宫格 / 条目）
- 缺少"已安装 / 官方 / 自建"三种标签区分

需将 `/skills` 路由替换为设计稿中的"技能广场"页面，同时兼容用户已安装的技能（本地 `~/.stoclaw/openclaw/skills/`、`lock.json`、`openclaw.json`）。

## What Changes

- **替换 Skills 页面**：用新的技能广场页面完全替换现有 `/skills` 路由的组件，包含两个 Tab（"技能广场" / "我的技能"）、分类导航、搜索、排序、视图切换、卡片网格 / 条目列表
- **新建后端 API**：在 Electron Main 进程新增一套技能广场专属 host-api 路由，统一从 STO 远端市场 + 本地安装目录 + lock.json 聚合数据，并管理分类
- **分类后端管理**：技能分类（经营管理 / 财务管理 / 异常监控 / 外部市场 / 办公）由后端完全管理，前端仅消费
- **技能详情弹窗**：支持点击卡片查看工作流介绍、步骤、调度与输出、数据概览
- **安装 / 删除流程**：从广场直接安装官方技能；"我的技能"中支持删除自建技能（确认弹窗）
- **兼容已安装技能**：读取现有 `~/.stoclaw/openclaw/skills/` 目录和 `lock.json`，将已安装技能正确映射到广场中的"已安装"状态
- **Toast 反馈**：安装成功、删除成功等操作反馈

## Capabilities

### New Capabilities

- `skills-plaza-marketplace`：技能广场主页面——Tab 切换、分类导航、搜索、排序、视图切换、卡片渲染、安装 / 使用 / 删除交互，以及驱动上述交互的 host-api 与 Zustand store
- `skills-plaza-detail`：技能详情弹窗——工作流介绍、步骤、调度与输出、数据概览、立即使用 CTA
- `skills-plaza-category`：后端完全管理的技能分类体系（分类定义、技能归属、分类计数）

### Modified Capabilities

- 现有 `skills-*` 路由（`/skills`）将指向新页面组件；侧栏导航入口保持不变
- 现有 `src/stores/skills.ts` 的核心逻辑（`fetchSkills` 四方合并、`installStoSkill`、`uninstallStoSkill`）将被复用或重构至新 store；旧页面特有的 Sheet 详情、API Key 编辑、环境变量管理等开发者功能**降级为后续高级设置入口**（不在本 change 范围）
- 现有 `electron/api/routes/skills.ts` 路由将新增广场专属端点

## Impact

- `src/pages/Skills/`：整体重写为技能广场页面组件（多文件拆分）
- `src/stores/skills.ts`：新增广场相关 state 与 actions 或拆分新 store
- `src/lib/host-api.ts`：新增广场数据拉取、分类、安装、删除等 API 方法
- `electron/api/routes/skills.ts`：新增 `/api/skill-plaza/*` 路由端点
- `electron/services/`：新增 `skill-plaza-service.ts` 聚合本地技能 + STO 市场 + 分类数据
- `src/i18n/locales/*/skills.json`：新增广场相关翻译键
- `src/components/skill-plaza/`：新增广场专属 UI 组件（卡片、分类导航、排序下拉、视图切换、详情弹窗、确认弹窗）
- 视觉对齐 `docs/sto-design.md`（Brand-6 `#FF6F00` 主色 / 强调、Grey-2/3 背景、Grey-8/10 文本层级、Success Green-6 已安装、Info Blue-6 官方、Brand-6 自建）

## Out of Scope

- 现有 Skills 页面的 API Key 编辑、环境变量管理、ClawHub 市场浏览等开发者功能（降级为后续"高级设置"入口）
- 技能在线编辑器 / 创建自建技能
- 技能版本升级 / 更新机制
- 跨设备技能同步
- 技能评价体系（评论 / 评分）
