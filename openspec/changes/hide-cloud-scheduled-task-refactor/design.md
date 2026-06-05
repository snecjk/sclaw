## Context

StoClaw 当前并行维护两套定时任务页面：

- **旧版 `/cron`**：基于本地 OpenClaw Gateway RPC (`cron.list`/`cron.add` 等)，使用 glass 拟态风格（`glassNestedCard`、`glassSectionSurface`），单文件大组件（755 行），内含预设按钮+自定义 Cron 输入的创建对话框、2 列卡片网格、顶部统计面板。Sidebar 标签为「定时任务（旧）」，生产环境隐藏。
- **新版 `/scheduled-tasks`**：基于 STO Cloud Task API，采用现代简洁风格（标准 border/shadow，`rounded-xl` 卡片），拆分为 `TaskHero`、`TaskCard`、`TaskCreateModal`（含可视化 `SchedulePicker`）、`TaskEmptyState` 等子组件，支持搜索、排序、3 列网格、推荐模板空状态。

本期产品策略明确：不上线新版云端定时任务，但要求旧版页面 UI/UX 达到新版水准，同时隐藏云端入口以避免用户困惑。

## Goals / Non-Goals

**Goals：**
- 隐藏 Sidebar 中 `/scheduled-tasks` 云端定时任务导航入口
- 将 `/cron` 设为唯一的用户可见定时任务主入口，Sidebar 标签改为「定时任务」
- 旧版 Cron 页面 UI 全面升级：布局、搜索排序、卡片样式、创建对话框、空状态、错误提示均参照新版 `/scheduled-tasks`
- 所有可见 UI 元素对齐 `docs/sto-design.md` STO 主题宪法（Brand/Grey/语义化 token）

**Non-Goals：**
- 不上线新版云端定时任务业务功能；`/scheduled-tasks` 页面代码保留但不对用户暴露
- 不改变底层执行机制（仍通过 Gateway RPC 操作本地 cron 任务）
- 不修改 `electron/api/routes/cron.ts` 的 API 契约
- 不引入云端任务的数据模型（`ScheduledTask`）到旧版页面

## Decisions

### 1. 组件拆分：将旧版单文件大组件拆分为多个子组件
旧版 `src/pages/Cron/index.tsx` 为 755 行的单文件，内联了 `TaskDialog`、`CronJobCard` 以及统计面板、空状态等逻辑。新版已验证组件拆分模式的可维护性。

- **Rationale**：搜索、排序、推荐模板等新功能的加入会让单文件更加臃肿；拆分后便于单元测试和后续迭代。
- **Alternative considered**：保持单文件，仅修改样式 — **Rejected**，文件复杂度已过高，新增功能会进一步恶化。
- **方案**：在 `src/pages/Cron/components/` 下创建 `CronTaskHero`、`CronTaskCard`、`CronTaskCreateModal`、`CronTaskEmptyState`、`CronSchedulePicker` 等子组件，参照新版实现但适配本地 Cron 数据模型。

### 2. 组件复用：以新版组件为模板，在旧版页面下重新实现适配版本
新版 `/scheduled-tasks/components/` 中的组件与旧版数据模型（`CronJob` vs `ScheduledTask`）和 API 行为存在差异，无法直接复用。

- **Rationale**：新版组件已绑定了 Cloud Task API 的特定行为（如 409/422 错误解析、`isCloud` 标识、`async_started` 触发结果等），直接复用会引入大量条件分支。
- **Alternative considered**：将通用组件提取到 `src/components/scheduled-task/` 共享层 — **Deferred**，本期优先保证旧版页面独立可用，共享提取可在后续两版并行上线时统一处理。
- **方案**：以新版组件为视觉和交互参考，在 `src/pages/Cron/components/` 下独立实现适配旧版 Gateway API 的版本，保持接口命名一致（`onToggle`、`onEdit`、`onDelete`、`onTrigger` 等），降低未来合并成本。

### 3. 样式体系迁移：从 glass 拟态迁移到标准 border/shadow 体系
旧版大量使用 `glassNestedCard`、`glassSectionSurface` 等 glass 拟态工具类，与新版和 `docs/sto-design.md` 的规范不一致。

- **Rationale**：`docs/sto-design.md` 定义了基于 Brand/Grey 的标准 token 体系（Brand-6 `#FF6F00`、Grey-1～10 等），未定义 glass token；统一风格可减少技术债。
- **Alternative considered**：保留 glass 风格作为旧版特色 — **Rejected**，与新版视觉差异过大，违背「参照新版」的产品要求。
- **方案**：全面移除 glass 工具类引用，改用 `rounded-xl border border-border bg-background shadow-sm` 等标准 shadcn/ui 风格，主操作按钮使用 `bg-primary text-primary-foreground`（映射到 Brand-6）。

### 4. SchedulePicker 适配：可视化调度选择器对接 Gateway Cron 字符串
新版 `SchedulePicker` 输出 `ScheduleValue`（`frequency` + `time` + `weekDays` + `monthDay`），通过 `scheduleValueToCron` 转换为 cron 字符串。旧版 Gateway 使用标准 5 字段 cron 表达式，同时支持 `kind: "cron"`、`kind: "every"`、`kind: "at"` 的 `CronSchedule` 对象。

- **Rationale**：可视化选择器用户体验显著优于预设按钮+原始 cron 输入。
- **Alternative considered**：保留旧版预设按钮 — **Rejected**，不符合「参照新版交互」的要求。
- **方案**：将新版的 `SchedulePicker`、`scheduleValueToCron`、`cronToScheduleValue` 逻辑复制到旧版组件目录，输出标准 5 字段 cron 字符串提交给 Gateway。对于「仅一次」(`frequency: 'once'`) 模式，转换为 `kind: "at"` 的 `CronSchedule` 对象（Gateway 已支持）；若 Gateway 不支持，则 fallback 为 cron 字符串并辅以提示。

### 5. 错误处理增强：增加字段级校验和友好错误提示
旧版错误处理仅为 `toast.error(String(err))`，新版针对 Cloud API 实现了 409（名称冲突）、422（字段校验）的解析和友好提示。

- **Rationale**：Gateway 返回的错误同样可能包含名称冲突或字段校验失败，提升错误提示质量可改善用户体验。
- **Alternative considered**：保持旧版简单错误处理 — **Rejected**，创建/编辑任务时的失败原因不明确，用户无法自助修正。
- **方案**：在 `CronTaskCreateModal` 的 `handleSubmit` 中增加字段级前端校验（名称非空、消息非空、schedule 有效），并在 API 调用失败时解析错误响应中的关键词（如 `already exists`、`required` 等），展示对应的中文友好提示。

### 6. 导航调整：最小侵入性隐藏云端入口
- **Rationale**：完全删除 `/scheduled-tasks` 路由和相关代码会增加后续上线成本；仅注释导航入口可在下一期快速恢复。
- **Alternative considered**：删除 `/scheduled-tasks` 路由和组件 — **Rejected**，产品明确说「这一期先不上」，暗示后续会重新上线。
- **方案**：在 `Sidebar.tsx` 的 `primaryNav` 数组中移除/注释 `/scheduled-tasks` 条目；将 `/cron` 条目的标签从 `${t('common:sidebar.cronTasks')}(旧)` 改为 `t('common:sidebar.cronTasks')`；移除 `/cron` 的 `import.meta.env.PROD` 隐藏条件（或改为始终显示）。

## Risks / Trade-offs

- **[Risk]** 旧版页面大型 UI 重构可能引入功能回归（如 Gateway 未连接时的降级处理、任务开关状态同步）。
  → **Mitigation**：保持现有 `useCronStore` 的所有 action 调用不变，仅重构 UI 渲染层；在重构完成后运行 `pnpm test` 和 `pnpm run test:e2e` 验证关键路径。

- **[Risk]** `CronJob` 类型与新版 `ScheduledTask` 的字段差异可能导致适配层遗漏 edge case（如 `lastRun` 结构、`schedule` 为对象而非字符串）。
  → **Mitigation**：在 `CronTaskCard` 中保留旧版 `parseCronSchedule` 的健壮性处理，对 `schedule` 同时支持字符串和对象格式；新增 Vitest 单元测试覆盖类型转换函数。

- **[Risk]** Gateway 对 `kind: "at"`（一次性执行）的支持情况不明确，可能导致 SchedulePicker 的「仅一次」模式无法正常工作。
  → **Mitigation**：实现前通过 `electron/api/routes/cron.ts` 和 Gateway 文档确认支持情况；若不支持，在 UI 中暂时禁用「仅一次」选项，留待后续支持。

- **[Risk]** 新版组件的交互模式（如 `MoreHorizontal` 下拉菜单替代 hover 显示操作按钮）对旧版用户来说需要适应。
  → **Mitigation**：交互模式已在新版中经过用户验证，直接对齐即可；旧版用户本就是在使用一个「旧」页面，升级后体验只会改善。

## Migration Plan

1. **Phase 1 — 导航调整**：修改 `Sidebar.tsx`，隐藏 `/scheduled-tasks`，调整 `/cron` 标签和可见性。
2. **Phase 2 — 组件创建**：在 `src/pages/Cron/components/` 下创建新版风格的子组件（Hero、Card、Modal、EmptyState、SchedulePicker）。
3. **Phase 3 — 页面重构**：重写 `src/pages/Cron/index.tsx`，使用新组件，移除 glass 样式，接入搜索/排序/过滤状态。
4. **Phase 4 — 验证**：运行 `pnpm run lint`、`pnpm run typecheck`、`pnpm test` 确保无回归；手动验证创建/编辑/删除/开关/触发/搜索/排序/空状态等完整流程。

## Open Questions

- Gateway 是否完整支持 `kind: "at"`（一次性调度）？若不支持，SchedulePicker 是否需要暂时隐藏「仅一次」选项？
- 旧版页面的统计面板（总任务数/活跃/暂停/失败 4 个卡片）在新版中没有对应元素，是否保留还是移除以完全对齐新版？
