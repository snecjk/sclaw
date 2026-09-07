## Purpose

为 SClaw Electron 主进程提供跨 development、test、staging、production 的一致 AgentLoop 可观测能力，同时按环境隔离应用数据并保证探针异常不影响 Agent 核心功能。

## ADDED Requirements

### Requirement: 所有应用环境均加载 AgentLoop
系统 SHALL 在 development、test、staging、production 四种应用环境启动 Electron 主进程时尝试初始化 AgentLoop，不得仅依赖开发服务启动钩子。

#### Scenario: 开发环境启动
- **WHEN** 使用 development 模式启动应用且 AgentLoop 必填配置完整
- **THEN** Electron 主进程完成 AgentLoop 初始化

#### Scenario: 安装包环境启动
- **WHEN** 使用 test、staging 或 production 模式构建的安装包启动且 AgentLoop 必填配置完整
- **THEN** Electron 主进程完成 AgentLoop 初始化

### Requirement: AgentLoop 应用名称按环境隔离
系统 SHALL 根据构建环境使用固定的 AgentLoop 应用名称：development 使用 `sto-claw-development`，test 使用 `sto-claw-test`，staging 使用 `sto-claw-staging`，production 使用 `sto-claw-production`。

#### Scenario: 各环境选择对应应用名称
- **WHEN** 任一受支持环境初始化 AgentLoop
- **THEN** 上报服务名称与该环境约定的 AgentLoop 应用名称一致

#### Scenario: 按 mode 文件加载配置
- **WHEN** 构建过程加载任一 `.env.<mode>` 文件
- **THEN** 系统使用该 mode 对应的应用名称，并加载该文件中的 AgentLoop 接入参数

### Requirement: 探针先于 Claude Agent SDK 生效
系统 MUST 在首次运行时加载 Claude Agent SDK 前完成 AgentLoop 探针注册，并 SHALL 保持 Claude Agent SDK 可被自动插桩的加载方式。

#### Scenario: 首次发起 Claude Agent 会话
- **WHEN** AgentLoop 配置完整且用户首次发起 Claude Agent 会话
- **THEN** AgentLoop 能够接收到该会话产生的 `claude_agent` 调用链数据

### Requirement: 配置异常时安全降级
系统 SHALL 在 License 缺失、配置无效或探针加载失败时记录脱敏诊断信息并继续启动 SClaw，不得因可观测能力异常阻断 Agent 主流程。

#### Scenario: License 缺失
- **WHEN** 当前环境没有可用的 AgentLoop License
- **THEN** 系统跳过探针初始化、记录不含凭证值的告警并继续启动

#### Scenario: 探针模块加载失败
- **WHEN** AgentLoop 探针模块无法加载或初始化抛出异常
- **THEN** 系统记录脱敏错误并继续启动，Claude Agent 功能仍可使用

### Requirement: 环境运行策略显式配置
系统 SHALL 按当前 `.env.<mode>` 中的显式配置启用 Console exporter、调试日志和会话内容事件上报，不得从其他 mode 文件读取运行策略。

#### Scenario: 生产环境显式配置运行策略
- **WHEN** production 配置显式启用 Console exporter、调试日志和会话内容事件
- **THEN** production 探针按配置启用这些能力

#### Scenario: 会话内容上报未授权
- **WHEN** 当前环境未显式启用会话内容事件上报
- **THEN** 系统不主动启用会话内容事件采集

### Requirement: 探针作用域限制在 Electron 主进程
系统 SHALL 将本次 AgentLoop 初始化限制在 Electron 主进程，不得将探针隐式注入 Vite、构建脚本、渲染进程或 OpenClaw Gateway。

#### Scenario: 启动开发与构建工具
- **WHEN** 执行开发前置脚本或构建脚本
- **THEN** 这些工具进程不因本次改造而预加载 AgentLoop 探针

#### Scenario: 启动 OpenClaw Gateway
- **WHEN** Electron 主进程启动独立的 OpenClaw Gateway
- **THEN** Gateway 不因本次改造而自动加载 AgentLoop 探针
