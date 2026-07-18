## Why

项目列表按名称排序会使项目位置随重命名变化，不利于用户按创建顺序建立稳定认知；同时项目与会话的重命名交互不一致，会话只能通过菜单触发。

## What Changes

- 项目列表按创建时间升序展示，较早创建的项目在前。
- 项目内会话与“最近”会话均支持双击名称进入现有行内重命名状态。
- 保持项目草稿“新对话”不可重命名。
- 侧栏行内重命名输入框使用语义主题 Token，适配暗黑模式，避免硬编码白底。

## Capabilities

### New Capabilities
- `sidebar-project-session-navigation`: 定义侧栏项目排序及项目内/最近会话的重命名交互。

### Modified Capabilities

无。

## Impact

- 影响侧栏项目与会话渲染组件及其排序/交互逻辑。
- 不改变数据库、IPC、Host API 或依赖。
- 可见交互沿用现有 STO 主题 token 与行内编辑样式，遵循 `docs/sto-design.md`。
