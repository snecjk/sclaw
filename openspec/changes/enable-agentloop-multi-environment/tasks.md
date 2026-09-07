## 1. 环境配置与构建注入

- [x] 1.1 在 `.env.development`、`.env.test`、`.env.staging`、`.env.production` 中配置对应的非敏感 `ARMS_APP_NAME`，并通过配置测试验证名称分别为 `sto-claw-development`、`sto-claw-test`、`sto-claw-staging`、`sto-claw-production`
- [x] 1.2 将 License、Region、Workspace 及可选运行策略纳入 Vite 主进程配置解析，保持本地忽略文件和 CI 密钥优先级，并通过单元测试验证四种 mode 与 development local override
- [x] 1.3 检查 AgentLoop License 仅具备可分发的遥测写入权限并记录验证结果，确认仓库和构建日志均不包含完整凭证

## 2. 主进程统一初始化

- [ ] 2.1 实现 AgentLoop 配置校验、固定应用名映射、进程内幂等和脱敏日志模块，并通过单元测试覆盖完整配置、缺失 License、名称不匹配及重复初始化
- [ ] 2.2 增加 Electron 主进程引导入口，在注册 CMS 探针后动态加载现有主进程入口，并通过顺序测试验证 CMS 注册早于 Claude Agent SDK 首次加载
- [ ] 2.3 将 `@loongsuite/cms_node_sdk/register` 保持为运行时外部依赖并调整打包配置，通过安装包内容检查验证 SDK 及其依赖可被解析
- [ ] 2.4 移除 Vite `onstart` 中仅用于 AgentLoop 的 `NODE_OPTIONS` 注入，同时保留现有 Electron 启动环境处理，并通过 development 启动测试验证未向 Vite 或前置脚本注入探针

## 3. 安全与环境策略

- [ ] 3.1 仅透传当前环境显式配置的 Console exporter、日志级别和会话内容事件开关，并通过测试验证 production 未配置时不会自动启用
- [ ] 3.2 对探针加载和初始化异常实现 fail-open，使用缺失模块或模拟异常测试验证 SClaw 主进程和 Claude Agent 仍可继续启动
- [ ] 3.3 更新 `.env.example` 和接入说明，使用无效占位符说明本地与 CI 配置方式，并通过凭证扫描确认文档未包含真实 License

## 4. 多环境验证

- [ ] 4.1 分别执行 development、test、staging、production 的配置或构建验证，确认每种 mode 只使用对应的 AgentLoop 应用名称
- [ ] 4.2 在 development 发起 Claude Agent 冒烟会话，确认 AgentLoop 收到 `claude_agent` span 且应用名为 `sto-claw-development`
- [ ] 4.3 对 test、staging、production 安装包执行启动与上报冒烟验证，确认调用链分别进入对应 AgentLoop 应用且探针异常不会阻断应用
- [ ] 4.4 运行类型检查和相关自动化测试，确认 Electron 主进程启动、Claude 会话及现有构建流程无回归
