## 1. 环境配置与构建注入

- [x] 1.1 在 `.env.development`、`.env.test`、`.env.staging`、`.env.production` 中配置 `ARMS_APP_NAME`，并通过配置测试验证每个文件均显式提供非空应用名
- [x] 1.2 将相同的 License、Region、Workspace 及运行策略写入四个 `.env.<mode>` 并纳入 Vite 主进程配置解析，通过单元测试验证按 mode 加载且应用名保持隔离
- [x] 1.3 检查 AgentLoop License 仅具备可分发的遥测写入权限并记录验证结果，确认构建日志不会输出完整凭证

## 2. 主进程统一初始化

- [x] 2.1 实现 AgentLoop 必填配置校验、进程内幂等和脱敏日志模块，并通过单元测试覆盖完整配置、缺失应用名、缺失 License、自定义名称及重复初始化
- [x] 2.2 增加 Electron 主进程引导入口，在注册 CMS 探针后动态加载现有主进程入口，并通过顺序测试验证 CMS 注册早于 Claude Agent SDK 首次加载
- [x] 2.3 将 `@loongsuite/cms_node_sdk/register` 保持为运行时外部依赖并调整打包配置，通过安装包内容检查验证 SDK 及其依赖可被解析
- [x] 2.4 移除 Vite `onstart` 中仅用于 AgentLoop 的 `NODE_OPTIONS` 注入，同时保留现有 Electron 启动环境处理，并通过 development 启动测试验证未向 Vite 或前置脚本注入探针

## 3. 安全与环境策略

- [x] 3.1 透传当前 mode 文件显式配置的 Console exporter、日志级别和会话内容事件开关，并通过测试验证四环境配置一致
- [x] 3.2 对探针加载和初始化异常实现 fail-open，使用缺失模块或模拟异常测试验证 SClaw 主进程和 Claude Agent 仍可继续启动
- [x] 3.3 更新 `.env.example` 和接入说明，使用无效占位符说明四个 mode 文件的配置方式，并确认日志与说明文档不输出完整凭证

## 4. 多环境验证

- [x] 4.1 分别执行 development、test、staging、production 的配置或构建验证，确认每种 mode 只使用对应的 AgentLoop 应用名称
- [ ] 4.2 在 development 发起 Claude Agent 冒烟会话，确认 AgentLoop 收到 `claude_agent` span 且应用名与 `.env.development` 一致
- [ ] 4.3 对 test、staging、production 安装包执行启动与上报冒烟验证，确认调用链应用名分别与对应 `.env.<mode>` 一致且探针异常不会阻断应用
- [ ] 4.4 运行类型检查和相关自动化测试，确认 Electron 主进程启动、Claude 会话及现有构建流程无回归
