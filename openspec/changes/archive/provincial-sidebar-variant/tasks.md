## 1. 规范与文档

- [x] 1.1 对照 `### Requirement: 省区布局下侧栏可见性 MUST 由集中模块解析`：实现 `src/lib/sidebar-layout.ts` 并在 `Sidebar` 中消费可见性表。
- [x] 1.2 对照 `### Requirement: 省区布局下壳层强调 MUST 与 STO 主题宪法一致`：确认省区分支未引入新的主色或选中态样式路径。
- [x] 1.3 在 `README.md` 记录默认省区侧栏与 `VITE_STOCLAW_SIDEBAR_LAYOUT=full` 行为（与 spec 中环境开关一致）。

## 2. 国际化与类型

- [x] 2.1 为紧凑账户入口补充 `common:sidebar.compactAccountMenu`（中 / 英 / 日）。
- [x] 2.2 在 `src/vite-env.d.ts` 声明 `VITE_STOCLAW_SIDEBAR_LAYOUT` 可选键。

## 3. 验证

- [x] 3.0 新增 `tests/unit/sidebar-layout.test.ts`：`getSidebarLayoutVariant`（默认省区 / `full`）与 `getSidebarVisibility` 断言。
- [x] 3.1 运行 `pnpm run typecheck` 通过。
- [ ] 3.2 手动：未设 env 时为省区侧栏；设 `full` 时为完整导航；任务列表与历史分桶在省区下仍可用，紧凑菜单可打开设置并登出。

## 4. 后续（未排期）

- [ ] 4.1 将 `useAuthStore` 或远端角色与 `getSidebarVisibility` 合并，替代或叠加 `VITE_STOCLAW_SIDEBAR_LAYOUT`。
- [ ] 4.2 若产品要求省区包禁止直达 `/chat` 等路由，增加路由守卫（另起 OpenSpec 变更）。
