## Why

展开侧边栏中「项目 / 任务 / 最近」分区标题样式不一致、吸顶层级不连续，任务组只能单开，批量展开/收起缺失；底部账号依赖齿轮触发菜单，与已确认设计稿（MasterGo 底部热区调整）不一致。需要在不改动持久化、接口与通信的前提下，统一分区交互并完成三级吸顶。

## What Changes

- 展开态底部账号整块信息区成为设置菜单热区，移除齿轮；问号按钮保持独立并互斥。
- 项目 / 任务 / 最近共用分区标题交互与样式，并形成三级 sticky 栈。
- 项目与任务支持一级组多开，以及「展开全部分组 / 收起全部分组」（按是否全部展开决定下一次批量操作；不恢复历史快照）。
- 滚动越过阈值时连续自动收起上级模块，不清除组展开集合。
- 项目空态、层级竖线、一级 chevron 与菜单项对齐已确认设计；移除项目菜单中重复的「在项目中新建对话」。
- 可见交互遵循 `docs/sto-design.md` 语义 token，并覆盖 light / dark 的 default、hover、focus、selected / open 态。

## Capabilities

### New Capabilities

- `sidebar-section-interactions`: 侧栏分区标题共享交互、三级吸顶、任务多开、批量展开/收起、底部账号热区与项目层级/空态视觉。

### Modified Capabilities

- `sidebar-project-session-navigation`: 不重新定义排序与双击行内重命名；本变更引用并保持其行为不变。

## Impact

- `src/components/layout/Sidebar.tsx` 及项目相关 layout 组件、侧栏滚动 Hook、`src/lib/surfaces.ts`、三语 `common.json`、定向单元测试。
- 不涉及 API、IPC、Gateway、Main 新能力、Zustand 全局持久化 store、依赖或工程配置。
- README 仅在行为被文档描述时更新；默认评估后可不改。
