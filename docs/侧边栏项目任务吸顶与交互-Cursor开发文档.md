# 侧边栏项目 / 任务 / 最近吸顶与交互 · Cursor Auto 开发文档

> 适用工作区：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 执行模型：Cursor Auto
>
> 风险等级：Tier 2（中风险）
>
> 本文是已经过人工确认的实施方案。Cursor 应先完成规则、代码和设计稿读取，再按本文顺序实施；不要重新发散产品范围。

## 0. Cursor 执行方式

### 0.1 开始前必须读取

按顺序完整读取：

1. 根目录 `AGENTS.md`。
2. `.cursor/rules/README.md`。
3. `.cursor/rules/00-workflow-and-risk.mdc`。
4. `.cursor/rules/05-engineering-guardrails.mdc`。
5. `.cursor/rules/01-code-rules.mdc`。
6. `.cursor/rules/02-styles.mdc`。
7. `openspec/config.yaml`。
8. 本文“当前代码事实”列出的源码。
9. 现有相关 OpenSpec：
   - `openspec/changes/sort-projects-and-double-click-rename-sessions/`
   - `openspec/changes/sidebar-recent-message-groups/`

先执行 `git status --short`，保留用户已有改动。不得覆盖、回退或格式化与本任务无关的文件。

### 0.2 MasterGo MCP 是视觉事实来源

用户会在 Cursor 中提供 MasterGo MCP。开始写样式前，必须通过 MCP 读取以下设计稿及目标图层：

```text
https://mastergo.com/goto/UDhZu73k?page_id=39:06193&layer_id=39:14883&file=195806630222772
```

需要重点核对：

- 项目、任务、最近标题的高度、内边距、文字色和 chevron。
- 标题 hover、focus、展开/收起状态。
- 项目标题右侧两个操作按钮的顺序、尺寸、间距和图标。
- 任务标题右侧批量收起/恢复按钮。
- 项目一级行、二级会话、层级竖线、选中态和 hover 操作。
- 无项目空态。
- 底部账号整块热区、菜单弹出位置和问号按钮间距。

视觉优先级：

```text
本开发文档中的已确认产品决策
> MasterGo MCP 精确视觉数据
> 当前已验收的侧边栏实现
> .cursor/rules/02-styles.mdc
> docs/sto-design.md 中不冲突的共享建议
```

补充规则：

- 不把 MasterGo 访问令牌、Cookie 或其他凭据写入代码、文档、日志或测试。
- 若 MCP 与本文的功能决策冲突，以本文为准；MCP 只决定视觉还原细节。
- 若 MCP 暂时不可用，可用以下本地截图辅助理解，但不要凭截图猜测无法辨认的像素值：
  - `/Users/tiancanyang/Desktop/区域 1.png`
  - `/Users/tiancanyang/Desktop/1.png`
  - `/Users/tiancanyang/Desktop/切图 2.png`
  - `/Users/tiancanyang/Desktop/3.png`

### 0.3 执行节奏

- 这是 T2：先分析真实代码，再做 OpenSpec，然后按独立任务实现。
- 下文方案已由用户确认；只要实际代码没有出现冲突，不需要重新等待方案审批。
- 一次只完成一个开发任务。每个任务完成后立即执行定向测试、检查 diff，再进入下一项。
- 触发 `00-workflow-and-risk.mdc` 的 Stop Rules 时停止，不要继续堆叠条件分支。
- 不创建分支、不提交、不推送，除非用户后续明确要求。
- 不执行构建或打包。本任务不涉及工程配置。
- React 19 新增代码不要默认增加 `useCallback`、`useMemo` 或 `React.memo`；只有规则允许的引用稳定性或高成本计算场景才使用。
- 条件样式使用现有 `cn()`，图标使用 Lucide 或项目已有资产，不引入第二套组件、图标或状态方案。

## 1. 目标与边界

本次统一完成以下侧边栏改造：

1. 底部账号区域去掉展开态齿轮图标，账号信息整块成为设置菜单热区。
2. “项目”标题与“任务 / 最近”共用标题样式、hover 和点击热区。
3. 项目、任务、最近形成三级连续吸顶。
4. 项目和任务增加“展开全部分组 / 收起全部分组”能力。
5. 任务组从单开改为允许多开。
6. 项目列表补齐空态、一级 chevron、二级层级线和设计稿中的 hover/选中样式。
7. 项目菜单移除重复的“在项目中新建对话”。
8. 保持现有新建项目、项目内新建会话、行内重命名、会话置顶等业务流程。

### 1.1 明确不做

- 不改变新建项目弹窗。
- 不实现设计稿中的项目重命名弹窗；继续使用现有行内编辑。
- 不改变项目内新建会话的草稿创建时机。
- 不改变项目会话选中态的现有字重。
- 不修改会话置顶、未读、运行中、失败状态的数据来源和优先级。
- 不改变项目排序规则。
- 不增加持久化；所有新增展开状态保持组件生命周期内状态。
- 不新增 API、IPC、Gateway 请求、Main 进程能力或 Zustand 全局 store。
- 不修改依赖、lockfile、构建配置、构建脚本、CI/CD。
- 不顺手重构整个 `Sidebar.tsx`。

## 2. 当前代码事实

Cursor 必须以真实代码为准，不按本文中的示意名称虚构项目结构。

| 文件 | 当前职责与问题 |
| --- | --- |
| `src/components/layout/Sidebar.tsx` | 任务/最近标题、任务组单开状态、任务自动收起 Hook 接入、最近列表和底部账号菜单都在这里 |
| `src/components/layout/sidebar-projects-section.tsx` | 项目标题、项目展开映射、项目会话、新建/重命名/删除逻辑；项目标题尚未复用任务标题结构 |
| `src/components/layout/sidebar-project-row-trailing.tsx` | 项目行的新建会话按钮和更多菜单；菜单中存在重复的新建会话项 |
| `src/components/layout/sidebar-project-session-row.tsx` | 项目会话行、选中态和行内编辑 |
| `src/components/layout/sidebar-project-session-row-trailing.tsx` | 项目会话尾部状态及菜单 |
| `src/hooks/use-sidebar-task-scroll-collapse.ts` | 仅处理“最近到达任务标题”时自动收起任务 |
| `src/lib/surfaces.ts` | 侧边栏标题、sticky、行样式等共享 surface |
| `src/styles/globals.css` | `--sto-sidebar-section-sticky-h: 30px` 和侧边栏主题 token |
| `src/components/layout/SidebarSupportQrTooltip.tsx` | 底部问号按钮和二维码弹层 |
| `src/i18n/locales/{zh,en,ja}/common.json` | 侧边栏用户可见文案 |

已确认的现状：

- 项目使用 `expandedProjectIds: Record<string, boolean>`，已经允许多个项目同时展开。
- 任务使用 `expandedTaskGroupKey: string | null`，当前只能展开一个任务组。
- 项目模块当前不吸顶。
- 任务标题当前 `top-0`，最近标题当前位于任务标题下方。
- 当前滚动 Hook 只自动收起任务，不处理项目。
- 手动重新展开任务时，现有实现可能直接滚回容器顶部；加入项目吸顶后需要改成按分区锚点揭示内容。
- 展开侧边栏时，账号文字区域不是菜单 trigger，齿轮才是 trigger。
- full/provincial 的收起态仍需要保留现有紧凑设置入口。

## 3. OpenSpec 前置任务（不是第一个代码任务）

代码修改前创建：

```text
openspec/changes/sidebar-section-sticky-interactions/proposal.md
openspec/changes/sidebar-section-sticky-interactions/design.md
openspec/changes/sidebar-section-sticky-interactions/tasks.md
openspec/changes/sidebar-section-sticky-interactions/specs/sidebar-section-interactions/spec.md
```

要求：

- Change ID：`sidebar-section-sticky-interactions`。
- New Capability：`sidebar-section-interactions`。
- proposal 明确 New Capabilities / Modified Capabilities，并说明不涉及接口、持久化和通信。
- design 的每个关键决策都写 rationale 和至少一个 alternative。
- risks 使用 `[Risk] → Mitigation` 格式。
- spec 的每个 Requirement 使用 SHALL/MUST，并至少包含一个 `#### Scenario:`。
- UI requirement 必须覆盖浅色和暗色主题的 default、hover、focus、selected 等适用状态。
- tasks 按编号分组，每项引用对应 Requirement 名称。
- 引用现有 `sidebar-project-session-navigation` 行为，不重新定义或破坏项目排序、双击行内重命名。

OpenSpec 应至少包含这些 Requirement：

1. `Expanded account area opens account menu`
2. `Sidebar section headers share interaction styling`
3. `Project task and recent headers form a sticky stack`
4. `Project and task groups support expand all and collapse all`
5. `Task groups support independent expansion`
6. `Project hierarchy and empty state follow the approved design`
7. `Existing project and session workflows remain unchanged`

OpenSpec 自检通过后再进入下面的开发任务。

## 4. 目标交互模型

### 4.1 三级 sticky

| 标题 | sticky top | 层级 |
| --- | --- | --- |
| 项目 | `0` | 最高 |
| 任务 | `1 × --sto-sidebar-section-sticky-h` | 项目下方 |
| 最近 | `2 × --sto-sidebar-section-sticky-h` | 任务下方 |

实现约束：

- 三个标题都使用实底 `--sto-sidebar-bg`，下方列表文字不能透出。
- sticky top 从同一个高度 token 计算，不在不同组件散落 `30px`、`60px`。
- z-index 必须形成明确顺序，但只覆盖侧边栏滚动内容，不压过 DropdownMenu、Tooltip 和底部固定区域。
- 只有一个中部纵向滚动容器，不增加嵌套滚动条。

滚动自动收起：

- “任务”到达项目 sticky 标题下沿时，如果项目模块打开，则自动关闭项目模块。
- “最近”到达任务 sticky 标题下沿时，如果任务模块打开，则自动关闭任务模块。
- 自动关闭模块只改变模块 `open`，不得清空其一级分组展开集合。
- 每次滚动越过阈值只触发一次；不得在 scroll handler 中高频无条件 setState。
- 手动重新展开处于吸顶位置的项目/任务时，应滚动到刚好能看见该模块内容的合适位置，不要一律把整个容器跳到 `scrollTop = 0`。
- 手动展开后复用现有“暂缓下一次自动收起”思路，避免同一帧立刻又被关闭。

### 4.2 两种展开状态必须分离

| 状态 | 作用 | 是否影响其他状态 |
| --- | --- | --- |
| 模块 `open` | 显示/隐藏整个项目或任务区内容 | 不清除组展开集合 |
| 一级组展开 map | 控制单个项目/任务组的二级内容 | 多组可以同时为 true |

### 4.3 批量展开与收起

项目和任务分别维护自己的展开 map，不能共用状态。不保存「上一次展开了哪些组」。

硬性行为：

1. 所有可展开组都已展开时，右侧按钮执行「收起全部分组」。
2. 只要存在未展开组（全部收起或部分展开），右侧按钮执行「展开全部分组」。
3. 部分展开时点击必须把剩余分组全部展开，不得收起已展开的组。
4. 收起后一级项目/任务组仍显示，只隐藏二级内容。
5. 用户单独展开/收起一个组时，其他组保持不变。
6. 模块整体收起时不显示批量按钮，且不清空组展开 map。
7. 无一级列表内容或不存在可展开二级内容时不显示批量按钮。

Tooltip/i18n 语义：

```text
展开全部分组
收起全部分组
```

三种语言都必须增加对应 key；图标按钮同时提供可读 `aria-label`。图标表达即将执行的操作（全部展开时显示折叠 icon，否则显示展开 icon）。

## 5. 开发任务

### 开发任务 1：底部账号热区调整（第一个实际代码任务）

先完成并独立验证这一项，不要同时开始标题或 sticky 改造。

目标：

- 展开侧边栏中移除齿轮图标。
- 将账号名称/公司信息的整个左侧区域包入 `DropdownMenuTrigger asChild`。
- 整块账号信息区域支持 default、hover、focus-visible 和 `data-[state=open]` 状态。
- hover/open 灰底、圆角、尺寸和间距按 MasterGo MCP。
- 菜单内容、顺序、跳转、语言、主题和退出逻辑全部保持现状。
- `SidebarSupportQrTooltip` 继续作为右侧独立按钮。
- 账号菜单打开时关闭二维码；二维码打开时关闭账号菜单，保留现有互斥关系。
- full/provincial 的收起态继续保留可用的紧凑设置入口，不因删除展开态齿轮而失去入口。

实现注意：

- 不用 `<div onClick>` 模拟按钮。
- 不把问号按钮包进账号 trigger。
- 如果 `SIDEBAR_ACCOUNT_SETTINGS_TRIGGER_CLASS` 仍被收起态复用，只删除展开态无用分支，不要直接误删共享常量。

完成后验证：

- 点击账号文字任意位置都能开菜单。
- 点击问号只开二维码。
- 两个弹层不会同时打开。
- 展开态没有齿轮图标。
- 收起态仍能进入设置菜单。
- light/dark 下 hover、open、focus 均可读。

### 开发任务 2：提取统一侧边栏分区标题

将 `Sidebar.tsx` 内部的 `SidebarCollapsibleSectionLabel` 提取为侧边栏 layout 私有共享组件，供项目、任务、最近使用。

建议文件名：

```text
src/components/layout/sidebar-collapsible-section-label.tsx
```

组件至少支持：

- `open`
- `onToggle`
- `label`
- `toggleAriaLabel`
- `shellRef`
- `stickyTopClass`
- `className`
- 独立的右侧 actions slot

结构要求：

- 主 toggle button 占满右侧 actions 以外的剩余宽度。
- 项目、任务、最近文字和 chevron 使用同一套 `sidebarSectionLabelClass` / `sidebarSectionChevronClass`。
- 主 toggle 覆盖整行 hover 灰底、圆角和 focus-visible。
- 右侧 actions 不得嵌套在主 button 内，也不得触发主 `onToggle`。
- 不新建全局通用 UI 原件；该组件仅服务侧边栏 layout。

完成后先把三个标题切换到共享组件，但暂时不要在同一步实现滚动自动收起。

### 开发任务 3：项目区域视觉与菜单

在 `sidebar-projects-section.tsx` 和相关行组件中完成：

#### 项目标题

- 使用开发任务 2 的共享标题。
- 标题样式、文字色、chevron 色和点击热区与任务/最近完全一致。
- 右侧 actions 顺序按 MCP：批量收起/恢复按钮在前，新建项目按钮在后。
- 新建项目按钮保持现有弹窗和业务处理。

#### 无项目空态

- 使用设计稿文件夹图标和“暂无项目”。
- 空态不显示批量收起/恢复按钮。
- 仍显示新建项目按钮。
- 文案走 zh/en/ja i18n。

#### 一级项目和二级会话

- 有二级内容的项目显示展开 chevron。
- chevron 的精确位置、旋转方式、hover 时与操作按钮的关系按 MCP。
- 项目点击继续控制当前项目展开，不关闭其他项目。
- 项目二级会话增加层级竖线，位置与 icon 中心按 MCP。
- 保持当前项目会话选中态 `font-medium`，不要调整字重。
- 继续保留文本截断、状态位、运行/失败/未读/置顶和 hover 菜单优先级。

#### 项目菜单

- 从 `sidebar-project-row-trailing.tsx` 的更多菜单中移除“在项目中新建对话”。
- 项目行 hover 时独立的新建会话按钮继续保留。
- 重命名继续调用现有行内编辑。
- 打开文件夹、删除及确认流程保持现状。

### 开发任务 4：任务多开与项目/任务批量展开收起

#### 任务组多开

将 `expandedTaskGroupKey: string | null` 改为可表达多个展开项的集合，优先沿用项目已使用的 `Record<string, boolean>` 模式。

必须同步改造：

- 普通任务组 `isOpen` 判断。
- 定时任务组 `isOpen` 判断。
- `handleTaskGroupToggle`。
- `handleTaskGroupExpand`。
- `focusTaskExecutionInSidebar`。
- 当前任务会话自动定位前的展开判断。

关键回归规则：

- 自动聚焦正在运行或当前任务时，只把目标 group 加入展开集合，不能关闭其他任务组。
- “展开全部”一级列表分页与任务组展开集合互不覆盖。

#### 批量展开/收起

项目和任务各自实现 4.3 的状态机。

实现可以留在所属 owner 组件中；不要为了共享少量逻辑新增 Zustand store。若为了可测试性抽纯函数，放在明确的 sidebar lib 文件中，不要建立通用状态框架。

### 开发任务 5：三级吸顶与连续自动收起

#### Sticky surface

在 `src/lib/surfaces.ts` 中把项目、任务、最近 sticky class 明确命名并统一计算：

- 项目：top 0。
- 任务：top 1 个标题高度。
- 最近：top 2 个标题高度。

保留 `sidebarSectionStickyShellClass` 的实底。修改现有导出前先搜索所有消费者；不要误改未接入侧边栏的历史常量。

#### 滚动 Hook

将 `use-sidebar-task-scroll-collapse.ts` 泛化为侧边栏分区滚动控制。可以重命名为：

```text
src/hooks/use-sidebar-section-scroll-collapse.ts
```

若重命名，删除旧文件前确认没有其他消费者。

Hook 建议管理：

- 中部滚动容器 ref。
- 项目标题 ref。
- 任务标题 ref。
- 项目→任务临界 sentinel/ref。
- 任务→最近临界 sentinel/ref。
- 项目、任务各自的 collapse callback。

技术约束：

- scroll listener 使用 passive。
- 使用 `requestAnimationFrame` 合并同一帧检测。
- cleanup 必须取消 listener 和 RAF。
- 阈值使用容器和标题的真实 `getBoundingClientRect()`，并累加前置 sticky 高度。
- 不通过连续新增多个相似 `if` 修补现有 Hook；如果旧 Hook 职责已不匹配，按局部重构处理。

#### 手动重新展开

项目和任务各自维护“本次手动展开需要揭示内容”和“抑制下一次自动收起”标记。

- 项目手动展开：显示项目内容并滚动到项目分区合适位置。
- 任务手动展开：在项目 sticky 存在时，只滚动到能够显示任务内容的位置，不无条件跳到整个滚动容器顶部。
- 模块恢复后，分组展开集合保持原值。

### 开发任务 6：i18n、主题与可访问性收口

至少核对并补齐三语：

- 项目模块展开/收起 aria-label。
- 收起全部分组。
- 展开全部分组。
- 暂无项目。
- 新增图标按钮的 tooltip/aria-label。

主题规则：

- 优先使用 `--sto-sidebar-*`、`background`、`foreground`、`muted`、`border`、`ring` 等语义 token。
- 不新增只适用于浅色的硬编码填充。
- MCP 明确存在主题差异且语义 token 无法表达时才增加范围明确的 `dark:` variant。
- 不因为本任务清理现有无关 hardcoded 颜色。

可访问性：

- 所有交互使用 button 语义。
- chevron 等装饰图标 `aria-hidden`。
- icon-only button 有 `aria-label`，并提供 Tooltip。
- 主标题 button 使用 `aria-expanded`。
- focus-visible 清晰，不能只靠颜色表达选中/错误状态。

### 开发任务 7：测试、Review 和文档检查

#### 建议增加的定向测试

可以按真实实现选择纯函数测试、Hook 测试或轻量组件测试，但必须覆盖以下行为：

| 测试范围 | 必测场景 |
| --- | --- |
| 任务展开集合 | 展开 A 后再展开 B，A/B 同时保持展开；关闭 A 不影响 B |
| 自动聚焦任务 | 加入目标任务组，不替换其他展开组 |
| 批量收起 | 全部已展开时点击，全部关闭二级内容 |
| 批量展开 | 存在未展开组（含部分展开）时点击，展开全部可展开组 |
| 模块收起 | 不清除组展开 map |
| 共享标题 | 主热区切换模块；右侧 action 不触发模块切换 |
| 项目空态 | 显示“暂无项目”和新建按钮，不显示批量按钮 |
| 底部账号 | 整块账号触发菜单；展开态齿轮不存在；问号按钮独立 |
| sticky 阈值 | 任务到达时关闭项目；最近到达时关闭任务；每次越界只触发一次 |

不要为测试引入新依赖。项目已有 Vitest、jsdom 和 Testing Library。

#### 每步验证命令

根据实际新增测试文件替换路径：

```bash
pnpm test -- tests/unit/<target-test>.test.ts
pnpm run typecheck
pnpm exec eslint <本步骤修改的 ts/tsx 文件>
```

注意：`pnpm run lint` 带 `--fix`，当前工作区存在用户改动时不要在每一步运行全仓自动修复。最终只有在确认不会污染无关文件时才运行全量 lint。

最终至少执行：

```bash
pnpm run typecheck
pnpm test
```

不需要运行 `comms:replay` / `comms:compare`，因为本任务不修改通信路径。

#### 手动视觉验收

必须在实际 Electron 页面核对：

1. full 展开侧边栏。
2. provincial 展开侧边栏。
3. 两种布局的收起态。
4. light / dark。
5. 常用窗口高度、较矮窗口和长项目/任务/最近列表。
6. 项目→任务→最近完整滚动过程。
7. 模块手动收起、自动收起、重新展开。
8. 分组多开、批量展开全部、收起全部、部分展开时展开剩余。
9. 项目 hover 操作、菜单、行内重命名、新建会话草稿、会话置顶。
10. 账号菜单和帮助二维码互斥。

#### README 与 rules

- 按项目要求检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需要更新。
- 如果只是侧边栏局部交互且 README 没有描述该行为，记录“已检查，无需更新”，不要为了完成任务强行改 README。
- 完成实际页面验证后，评估三级 sidebar sticky 和共享标题是否已经成为稳定复用规律；默认不要直接扩写 `.cursor/rules/02-styles.mdc`。只有确实需要沉淀且范围能限定为 sidebar 时才更新，并在最终报告说明依据。

## 6. 预计文件范围

实际实现前先以 `rg` 搜索结果为准。预计只涉及：

```text
openspec/changes/sidebar-section-sticky-interactions/**
src/components/layout/Sidebar.tsx
src/components/layout/sidebar-collapsible-section-label.tsx       # 建议新增
src/components/layout/sidebar-projects-section.tsx
src/components/layout/sidebar-project-row-trailing.tsx
src/components/layout/sidebar-project-session-row.tsx             # 仅设计需要时
src/components/layout/sidebar-project-session-row-trailing.tsx    # 仅设计需要时
src/components/layout/SidebarSupportQrTooltip.tsx                  # 仅间距/热区需要时
src/hooks/use-sidebar-section-scroll-collapse.ts                   # 建议由旧 Hook 泛化
src/hooks/use-sidebar-task-scroll-collapse.ts                      # 可能删除/替换
src/lib/surfaces.ts
src/styles/globals.css                                             # 只有 token/结构变量确有需要时
src/i18n/locales/zh/common.json
src/i18n/locales/en/common.json
src/i18n/locales/ja/common.json
tests/unit/<sidebar-targeted-tests>.test.ts(x)
```

超出以上范围前必须解释原因。不得顺手修改 store、API、Main、构建或发布文件。

## 7. 风险与停止条件

| 风险 | 应对 |
| --- | --- |
| 三级 sticky 出现穿透或错层 | 使用统一高度 token、实底和明确层级；在长列表与矮窗口验证 |
| 自动收起导致滚动跳动 | 用分区锚点定位；每段独立 suppress 标记；不要无条件滚到 0 |
| 任务多开破坏运行任务自动定位 | 自动聚焦改为向集合追加，并增加回归测试 |
| 模块 open 与组展开状态互相覆盖 | 两种状态分离，不在 toggle module 时重置 map |
| hover 操作点击后误切换项目 | actions 独立于主 button，核对事件传播 |
| 账号菜单与二维码同时出现 | 保留现有互斥状态并测试 |
| 代码继续堆在大型 Sidebar.tsx | 只提取有明确侧边栏语义的标题/Hook；不要进行全文件重构 |
| 与现有未归档 OpenSpec 重叠 | 引用既有行为，不重写排序和双击重命名规格 |

出现以下任一情况立即停止并向用户报告：

- 设计稿 MCP 与本文明确交互冲突。
- 实际代码中项目/任务状态来源与本文描述不同。
- 为实现 sticky 连续新增多组无法解释的条件分支。
- 同一滚动问题连续修正 3 次仍失败。
- 需要新增持久化、全局 store、IPC、接口或修改工程配置。
- 定向测试或 typecheck 出现无法解释的新回归。

## 8. 最终交付报告格式

Cursor 完成后按以下结构报告，不要只说“已完成”：

```markdown
## 完成内容
- 按开发任务列出实际完成项

## 文件变更
| 文件 | 变更说明 |

## 与 MasterGo 的核对
| 区域 | 核对结果 | 使用的 token / 尺寸 |

## 测试结果
| 命令或手动场景 | 结果 |

## 保持不变的行为
- 新建项目弹窗
- 项目/会话行内重命名
- 项目内新建会话草稿
- 选中项目会话字重
- 会话状态和置顶规则
- 收起态紧凑设置入口

## 文档检查
- README 是否需要更新
- 02-styles 是否需要沉淀

## 未解决或需要人工验收
- 如无，明确写“无”
```

交付前最后执行 `git diff --check` 和 `git status --short`，确认没有修改任务外文件，也不要替用户提交代码。

## 9. 交给 Cursor Auto 的启动提示词

用户可以在 Cursor 中引用本文并发送：

```text
请完整读取 @docs/侧边栏项目任务吸顶与交互-Cursor开发文档.md，并严格按文档执行。

你当前使用 Auto 模型：不要凭印象直接改代码。先完成文档 0.1 的规则/代码预检，
再通过我提供的 MasterGo MCP 读取目标图层，然后创建并自检 OpenSpec。

方案已经人工确认，不需要重新输出一套方案。OpenSpec 完成后直接按开发任务顺序实施：
第一个实际代码任务必须是“底部账号热区调整”。每个开发任务完成后运行定向测试、
检查 diff，再继续下一项。遇到文档列出的 Stop Rules 才暂停并报告。

不要修改任务范围外文件，不要安装依赖，不要修改工程配置，不要提交或推送。
最终按文档第 8 节格式汇报结果。
```
