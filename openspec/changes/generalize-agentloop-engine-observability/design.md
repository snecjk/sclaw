## Context

现有 `enable-agentloop-multi-environment` 通过轻量主进程入口在 Claude Agent SDK 加载前注册 `@loongsuite/cms_node_sdk`，应用名在构建期和运行时均为 Claude 固定映射。Pi Agent SDK 由 Electron Utility Process 延迟加载，主进程探针不会跨进程生效，且当前 CMS instrumentations 没有 Pi Agent 原生实现。

当前项目已有 Agent 引擎描述、EngineAdapter 和 `NormalizedEngineEvent`，但后者面向聊天状态，缺少完整的 Agent/LLM/Tool 遥测语义。设计需保留多环境构建配置、License 脱敏交付及 fail-open 行为。

## Goals / Non-Goals

**Goals:**

- 让 `.env.<mode>` 成为环境开关、灰度、安全策略和应用名模板的唯一配置来源。
- 让 Agent 注册定义成为框架名、运行进程和默认插桩策略的唯一结构来源。
- 复用同一 Bootstrap 生命周期支持 Electron 主进程和 Utility Process。
- 为没有原生 instrumentation 的 Pi 和后续引擎提供标准事件埋点。

**Non-Goals:**

- 不允许通过 `.env` 改变 Agent 实际运行进程或选择未经注册允许的插桩策略。
- 不为 OpenClaw Gateway、渲染进程或构建工具进程初始化 AgentLoop。
- 不新增 AgentLoop 管理界面、数据库表或外部业务接口。
- 不实现对任意未知 Agent SDK 事件格式的自动识别。

## Decisions

### 1. 环境策略与引擎结构分离

`.env.development/.test/.staging/.production` 保存 `AGENTLOOP_ENABLED`、`AGENTLOOP_ENABLED_ENGINES`、`AGENTLOOP_APP_NAME_TEMPLATE`、内容采集和 ARMS 接入参数；`.env.example` 只保存占位说明。Agent 注册表保存 `framework`、`process`、默认策略和允许策略。

应用名由模板和 Vite mode 派生：development=`dev`、test/staging=`test`、production=`online`。不再分别维护构建期和运行时的 Claude 应用名常量。

选择该方案是为了让运维配置控制灰度而不改变结构能力。替代方案是把全部 Agent 定义编码进 `.env`，但会造成多环境重复、字符串解析脆弱和非法组合难以校验。

### 2. 使用注册表和策略工厂组织差异

主进程维护 `AgentLoopEngineDefinition` 注册表，策略工厂根据定义创建：

- `native-auto`：在 Agent SDK 加载前启用 CMS 原生 instrumentation，Claude 使用该策略。
- `semantic-events`：持有 AgentLoop tracer，并根据 `AgentTelemetryEvent` 管理 Span，Pi 使用该策略。
- `disabled`：空实现，用于未启用、配置异常或安全降级。

环境配置仅决定是否启用；策略覆盖必须经过注册表 allowlist 校验。替代方案是在每个 EngineAdapter 内直接初始化 AgentLoop，但会重复配置、关闭和异常处理。

### 3. 使用组合式模板流程统一进程生命周期

通用 `bootstrapAgentRuntime` 固定执行：解析配置、解析引擎定义、生成应用名、初始化策略、动态加载 Agent runtime、注册关闭处理。返回显式 runtime handle，负责 tracer 获取、flush 和 shutdown。

采用组合式函数而非抽象基类，以便 Electron 主进程与 Utility Process 注入不同的 runtime loader，同时保持模板方法的固定顺序。

### 4. 每个执行进程只绑定一个 AgentLoop 应用

AgentLoop 服务名称在 SDK 初始化时成为进程级资源属性，因此不得在同一进程内通过修改 `ARMS_APP_NAME` 动态切换。Claude 保持在主进程并使用 Claude 应用；Pi Worker 启动时由 launcher 显式覆盖为 Pi 应用。

Pi 入口拆为轻量 bootstrap 和动态加载的 worker main，保证 AgentLoop 先于 Pi SDK 及其网络依赖加载。父进程从构建产物读取共享 License、Region、Workspace，仅向目标子进程传入所需环境变量。

替代方案是在主进程根据 Pi 事件生成 Span，但无法在要求独立应用名时可靠使用 Pi 服务资源。

### 5. 为语义埋点定义独立事件协议

新增 `AgentTelemetryEvent`，与 UI 使用的 `NormalizedEngineEvent` 分离。公共上下文至少包含 `engineType`、`agentId`、`sessionKey`、`runId`、`provider`、`model`、时间和事件标识；事件覆盖 Agent turn、LLM、Tool、usage、失败和中止。

`semantic-events` 策略以 `engineType + sessionKey + runId` 关联根 Span，以 tool/LLM 调用标识关联子 Span，并对重复事件幂等。内容字段在事件源处受采集策略控制，默认不进入事件。

替代方案是解析聊天消息生成 Span，但聊天协议缺少工具开始、模型和稳定调用标识，容易产生错误关联。

### 6. 显式管理 AgentLoop SDK 而非仅依赖副作用注册

通用层显式持有 AgentLoop SDK/runtime handle，使 `semantic-events` 能获取 tracer，并让主进程和 Pi Worker 在退出前统一刷新。Claude 的 `native-auto` 仍启用 `claude_agent` instrumentation，且保持初始化早于 Claude SDK 加载。

迁移期间必须确保旧的副作用注册与新 runtime 不会同时启动；每个进程由单一 Bootstrap 所有。

### 7. 安全降级与关闭超时

配置解析、SDK 初始化、事件处理和上报均 fail-open。关闭流程采用限定超时：先结束活动 Span，再尝试 flush/shutdown，超时后允许应用退出。日志只包含引擎、阶段和固定错误分类，不输出 License、Prompt 或工具正文。

## Risks / Trade-offs

- [Pi 标准事件与 AgentLoop 语义不完全一致] → 建立事件契约和映射测试，无法确认的字段不推断。
- [Claude 自动 Span 与通用 Span 重复] → 注册表限制单一根 Span 策略，并增加重复 Span 冒烟检查。
- [Pi 强制退出导致队列未刷新] → 将 AgentLoop shutdown 纳入 Worker 正常退出协议并设置短超时。
- [新增配置导致多环境漂移] → 对四个 mode 执行同一 schema 校验，只允许启用列表和明确的安全策略差异。
- [显式 SDK 初始化改变现有 Claude 行为] → 分阶段迁移并保留旧初始化的快速回滚开关。

## Migration Plan

1. 在不改变 Claude 行为的前提下引入通用配置解析、注册表、策略接口和 disabled 实现。
2. 将 Claude 初始化迁移到通用 Bootstrap，验证原生 `claude_agent` Span、应用名和 fail-open。
3. 增加标准遥测事件协议和 Pi 事件适配器，在 development 中启用 Pi AgentLoop。
4. 验证 Pi 独立应用名、Agent/LLM/Tool Span、异常结束和退出刷新。
5. 通过 `AGENTLOOP_ENABLED_ENGINES` 依次在 test、staging、production 灰度。
6. 回滚时从启用列表移除目标引擎；若通用 Bootstrap 本身异常，则恢复旧 Claude 入口并禁用 Pi AgentLoop。
