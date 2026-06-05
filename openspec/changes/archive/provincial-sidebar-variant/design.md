## Context

主应用壳侧栏当前包含完整主导航（含对话、我的数据）、任务列表、工作台、对话列表标题 + 新对话、按时间分桶的会话列表、底部用户卡菜单。省区版本需保留与业务录屏一致的主干，其余先隐藏。

## Goals / Non-goals

- **Goals**：单一事实来源的可见性表；**默认省区侧栏**，完整导航由 `VITE_STOCLAW_SIDEBAR_LAYOUT=full` 显式开启；省区模式下选中态与品牌强调仍沿用既有 `docs/sto-design.md` 语义（Brand / 主操作 Token），不引入新主色。
- **Non-goals**：本次不实现服务端角色下发；不在此变更中删除 `/chat` 等路由；不改变会话分桶算法。

## Decision

1. **布局变体来源**：使用 `import.meta.env.VITE_STOCLAW_SIDEBAR_LAYOUT`；仅当值为 `full`（大小写不敏感）时启用完整导航；**未设置或其它值默认为省区** `provincial`。
   - **Rationale**：与现有 Vite 构建链一致；默认贴合省区交付，完整壳仅开发者或少数角色显式打开。
   - **Alternative**：持久化到 `electron-store` — 更灵活但需 Main/设置页配合，超出当前「先隐藏、后按角色」的第一步。

2. **可见性 API**：`getSidebarLayoutVariant()` + `getSidebarVisibility()` 返回结构化布尔字段，Sidebar 仅消费该表。
   - **Rationale**：后续把 `useAuthStore` 或远端策略 merge 进同一函数即可，无需散落 `if (provincial)`。
   - **Alternative**：巨型 JSON 配置 — 对当前少量开关过重。

3. **底部用户区**：省区模式下隐藏姓名 / ID / 企业标大卡，保留 **单图标** 触发同一 `DropdownMenu`（设置、语言、主题、登出）。
   - **Rationale**：完全移除底部会失去登出与设置入口；图标入口视觉与信息层级弱于原用户卡，仍满足「弱化资料区」。
   - **[Risk]** 用户不熟悉图标入口 → **Mitigation**：`aria-label` / `title` 使用 i18n「账户与设置」，与 README 说明。

4. **主题与无障碍**：不新增硬编码色；紧凑按钮沿用侧栏既有 hover / border Token（与 `sto-design` 一致）。

## Risks

- **[Risk]** 构建时默认省区，开发者忘记设 `full` 时看不到完整导航 → **Mitigation**：README 与 `vite-env` 注释标明 `VITE_STOCLAW_SIDEBAR_LAYOUT=full`。
- **[Risk]** 运行时无法切换 → **Mitigation**：设计已预留 `getSidebarVisibility` 合并角色；后续可改为 store 或 host-api 拉取。
