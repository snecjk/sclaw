## Why

SClaw 当前仅在 `pnpm dev` 启动时通过 Vite 钩子加载 AgentLoop 探针，测试、预发和生产安装包缺少等效初始化链路，导致各环境的 Claude Agent 调用链覆盖不一致。需要建立独立于开发启动钩子的统一初始化能力，并按环境配置不同的 AgentLoop 应用名称。

## What Changes

- 为 Electron 主进程增加统一的 AgentLoop 初始化入口，在 Claude Agent SDK 首次加载前注册探针。
- development、test、staging、production 均加载 AgentLoop，并按
  `SClaw-<Agent框架名>-<环境名>` 使用应用名称；当前 Claude Agent SDK 的
  development 对应 `dev`、test/staging 对应 `test`、production 对应 `online`。
- 四个 `.env.<mode>` 文件共用同一套 License、Region、Workspace 和运行策略，仅应用名称随 mode 变化。
- 探针初始化失败时记录脱敏日志并降级，不阻断 SClaw Agent 主流程。
- 保持 OpenClaw Gateway 在本次范围之外。

## Capabilities

### New Capabilities

- `agentloop-observability`: 定义 Electron 主进程在多环境下加载 AgentLoop、选择环境应用名称、处理配置异常并保护敏感信息的行为。

### Modified Capabilities

无。

## Impact

- 影响 Electron 主进程启动链路、Vite 环境变量加载、各环境配置文件及构建流水线。
- 继续依赖 `@loongsuite/cms_node_sdk`，并保持 `@anthropic-ai/claude-agent-sdk` 的 CommonJS `require()` 加载方式。
- 不新增业务接口、数据库或持久化数据，不直接改动渲染进程和 OpenClaw Gateway。
- AgentLoop License 作为仅遥测写入、允许客户端分发的接入凭证随 mode 配置和安装包交付；会话内容上报需遵循既定合规要求。
