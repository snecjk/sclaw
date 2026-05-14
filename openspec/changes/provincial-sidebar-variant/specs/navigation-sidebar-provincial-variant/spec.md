## 新增需求

### Requirement: 省区布局下侧栏可见性 MUST 由集中模块解析

系统 MUST 通过 `getSidebarLayoutVariant` 与 `getSidebarVisibility`（或后续与之等价的单一入口）解析当前侧栏布局变体及模块可见性；渲染侧栏的组件 MUST 仅依据该可见性表隐藏或展示模块，而不得在 JSX 中散落硬编码的「省区」字符串判断作为唯一来源。

#### Scenario: 默认省区布局

- **WHEN** 未设置 `VITE_STOCLAW_SIDEBAR_LAYOUT` 或设置为除 `full` 以外的值（含 `provincial`、`province` 或空）
- **THEN** 侧栏 MUST 在主导航中展示首页、定时任务、技能广场
- **AND** MUST NOT 在主导航中展示对话与我的数据入口
- **AND** MUST NOT 展示工作台分组及其下智能体、频道、订阅链接
- **AND** MUST NOT 展示「对话列表」分组标题与「新对话」主按钮（含折叠态下的等效加号入口）
- **AND** MUST 继续展示「任务列表」分组及其下 STO 任务子链
- **AND** MUST 继续展示按时间分桶的历史会话列表
- **AND** MUST NOT 展示大号用户资料卡
- **AND** MUST 提供紧凑账户入口以打开与原用户卡相同的账户菜单（设置、语言、主题、登出），且该菜单所触发的行为 MUST 仍走既有 store / 导航路径，不得新增未经批准的 `window.electron.ipcRenderer.invoke` 直连

#### Scenario: 完整布局（显式开启）

- **WHEN** `VITE_STOCLAW_SIDEBAR_LAYOUT` 设置为 `full`（大小写不敏感）
- **THEN** 侧栏 MUST 展示全套模块（主导航含对话与我的数据、工作台分组、对话列表标题与新对话、完整用户资料卡）

### Requirement: 省区布局下壳层强调 MUST 与 STO 主题宪法一致

系统在省区布局下 MUST 继续使用既有侧栏选中态与品牌强调样式（与 `docs/sto-design.md` 中 Brand / 主路径语义一致），不得为省区单独引入新的产品主色路径。

#### Scenario: 主导航选中态

- **WHEN** 用户在省区布局下选中某一保留的主导航项
- **THEN** 该项的视觉强调 MUST 与完整布局下同一组件的选中态一致（同一 Token / 类名策略）
