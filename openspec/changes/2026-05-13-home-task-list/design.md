## Context

- 设计稿（用户提供的图一、图二）定义：首页卡片 ↔ 侧栏「任务列表」项 ↔ 详情页「最新一条」标题（日期 · 任务副标题）及报表型主文。
- 主题与强调色须遵循 `docs/sto-design.md`（Brand-6 用于主操作与链接强调；正文层级 Grey-9/Grey-10；浅表背景 White / Grey-1～3）。

## Goals / 非目标

- **Goals**：稳定 `taskId` 键；首页与侧栏共用同一路由；详情首屏可读、可返回首页；助手区复用 `HomeAssistant`（不新增 Gateway 直连）。
- **非目标**：不接真实总部对账/报表 API；不在折叠窄轨内完整复刻三条任务文字（避免可读性风险）；不实现多条历史版本切换（后续可加 ` /tasks/:id/:entryId`）。

## 决策

### 1) 路由形状：`/tasks/:taskId` 表示「最新一条」

- **Rationale**：与「点击即看最新」产品语义一致，URL 短且便于侧栏 `NavLink` 精确 `end` 匹配；后续若需历史列表可在 design 外增量加子路由。
- **Alternative considered**：`/tasks/:taskId/latest` — 冗余片段，对桌面端无额外收益。

### 2) 数据层：TypeScript 常量 + i18n 文案驱动首屏

- **Rationale**：零后端依赖即可验收 UI 与导航闭环；键与路由一一对应，替换为 fetch 时只换数据源模块。
- **Alternative considered**：内联在组件中的巨型 JSX — 难以维护与 i18n。

### 3) 侧栏任务项：展开态文本行 + 浅灰圆角选中底（Grey-2/Grey-3 意图）

- **Rationale**：对齐图二侧栏选中态（浅灰底 + 深色字），与主导航 Brand-6 选中区分：任务行是「工作项」而非一级 App 模块。
- **Alternative considered**：与主导航相同橙底选中 — 与设计稿侧栏任务行不一致。

### 4) 折叠态：本阶段不展示任务列表条目

- **Rationale**：72px 轨宽下图二的三条中文标题不可用红点与文字同时保证可读；避免与会话折叠列抢占垂直空间。
- **[Risk]** 折叠用户无法从侧栏进任务 → **Mitigation**：仍可从首页卡片进入；后续迭代可为折叠态提供图标或底部入口。

## Risks

- **[Risk]** `taskId` 与后端 eventual slug 不一致 → **Mitigation**：集中导出 `STO_TASK_IDS` 与路径工厂函数，文档在 spec 中固定三条键名。
- **[Risk]** 详情页表格仅静态，用户误以为实时 → **Mitigation**：文案或页脚小字标注「示例数据」可选；本 MVP 依赖设计占位阶段。
