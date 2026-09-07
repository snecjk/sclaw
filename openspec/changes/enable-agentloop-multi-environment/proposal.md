## Why

SClaw 当前仅在 `pnpm dev` 启动时通过 Vite 钩子加载 AgentLoop 探针，测试、预发和生产安装包缺少等效初始化链路，导致各环境的 Claude Agent 调用链覆盖不一致。需要建立独立于开发启动钩子的统一初始化能力，并按环境配置不同的 AgentLoop 应用名称。

## What Changes

- 为 Electron 主进程增加统一的 AgentLoop 初始化入口，在 Claude Agent SDK 首次加载前注册探针。
- development、test、staging、production 均加载 AgentLoop，并分别使用与 `.env.<mode>` 对应的应用名称。
- `.env.development.local` 继续作为 development 的本地覆盖，不创建独立的第五个应用。
- 将本地 Console exporter、调试日志和会话内容上报开关与基础接入配置分开管理。
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
- 构建期或运行时交付 AgentLoop License 前，需要确认桌面安装包中的凭证分发策略及生产会话内容上报合规要求。
