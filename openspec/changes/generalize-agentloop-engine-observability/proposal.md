## Why

现有 AgentLoop 初始化和应用名称与 Claude Agent SDK 强绑定，Pi Agent 运行在独立 Utility Process 中且没有 CMS 原生插桩。需要建立按环境配置、按引擎注册的通用接入机制，降低后续新增 Agent 引擎的重复开发成本。

## What Changes

- 由 `.env.development`、`.env.test`、`.env.staging`、`.env.production` 统一控制 AgentLoop 开关、启用引擎、应用名模板和内容采集策略，`.env.example` 仅提供无效占位符。
- 增加 Agent 引擎 AgentLoop 注册定义，声明框架名、运行进程和默认插桩策略。
- 增加通用 AgentLoop Bootstrap，按固定流程完成配置校验、SDK 初始化、Agent SDK 延迟加载、退出刷新和安全降级。
- 支持 `native-auto`、`semantic-events`、`disabled` 三种策略；Claude 沿用原生自动插桩，Pi 使用标准遥测事件生成 Agent、LLM 和 Tool Span。
- 在 Pi Utility Process 内使用独立应用名初始化 AgentLoop，避免继承 Claude 应用名。
- 支持通过 `AGENTLOOP_ENABLED_ENGINES` 按环境灰度启用或回滚，不改变 Agent 主流程。

## Capabilities

### New Capabilities

- `agentloop-engine-observability`: 定义多 Agent 引擎的环境配置、应用命名、策略选择、进程隔离、标准遥测事件和异常降级行为。

### Modified Capabilities

无。

## Impact

- 影响 AgentLoop 构建配置、Electron 主进程引导、Agent 引擎注册、Pi Utility Process 启停和相关自动化测试。
- 新增内部 `AgentLoopEngineConfig`、策略接口和 `AgentTelemetryEvent`，不新增外部业务接口或数据库表。
- 依赖现有 `enable-agentloop-multi-environment` 变更提供的多环境配置、License 打包和 Claude 初始化基础。
- OpenClaw Gateway、渲染进程及业务会话数据不在本次范围内。
