## 1. 环境配置与引擎注册

- [ ] 1.1 扩展 AgentLoop 构建配置模型，解析 `AGENTLOOP_ENABLED`、`AGENTLOOP_ENABLED_ENGINES`、`AGENTLOOP_APP_NAME_TEMPLATE` 和 `AGENTLOOP_CAPTURE_CONTENT`，并通过单元测试覆盖四种 Vite mode、进程环境优先级和非法值降级
- [ ] 1.2 将 development/test/staging/production 到 dev/test/test/online 的映射集中到单一配置模块，并通过测试验证 Claude、Pi 应用名及大小写完全一致
- [ ] 1.3 新增受校验的 AgentLoop 引擎注册表，声明 Claude 与 Pi 的 framework、process、默认策略和策略 allowlist，并通过注册重复、非法名称和非法组合测试
- [ ] 1.4 更新五个 `.env` 文件的 AgentLoop 配置，确保 `.env.example` 仅含无效占位符，并通过凭证扫描与配置快照测试

## 2. 通用 AgentLoop Runtime

- [ ] 2.1 定义 `AgentLoopEngineConfig`、runtime handle 和策略接口，并通过类型测试验证 `native-auto`、`semantic-events`、`disabled` 三种策略完整覆盖
- [ ] 2.2 实现策略工厂，根据环境启用列表和引擎 allowlist 创建策略，并通过测试验证未知引擎、未启用引擎和非法策略均安全降级
- [ ] 2.3 实现组合式 `bootstrapAgentRuntime` 模板流程，保证 AgentLoop 初始化早于 runtime loader，且通过顺序、幂等和 loader 异常测试
- [ ] 2.4 实现显式 AgentLoop SDK 生命周期管理和限定超时的 flush/shutdown，并通过初始化失败、重复关闭和关闭超时测试验证 fail-open

## 3. Claude 迁移

- [ ] 3.1 将 Claude 注册为 main process 的 `native-auto` 引擎，并通过测试验证生成 dev/test/online 应用名
- [ ] 3.2 将现有 Claude 主进程引导迁移到通用 Bootstrap，移除重复应用名映射且保持 Claude SDK 延迟加载，并通过 AgentLoop bootstrap 顺序测试
- [ ] 3.3 确保旧副作用注册与新 runtime 不会在同一进程重复启动，并通过探针初始化计数和单会话 Span 去重测试
- [ ] 3.4 执行 Claude development 冒烟会话，确认 `claude_agent` Span、应用名、会话可用性和异常降级行为均无回归

## 4. 标准遥测事件与语义策略

- [ ] 4.1 定义独立的 `AgentTelemetryEvent` 协议，覆盖 Agent、LLM、Tool、usage、失败和中止事件，并通过编解码与必填字段测试
- [ ] 4.2 实现 `semantic-events` Span 管理器，以 engine/session/run 和调用标识关联父子 Span，并通过成功、失败、中止、乱序和重复事件测试
- [ ] 4.3 实现内容采集策略，在默认关闭时剔除 Prompt、响应和工具正文，在显式开启时执行长度限制与脱敏，并通过敏感数据测试
- [ ] 4.4 为未结束 Span 实现进程退出收敛处理，并通过异常退出测试验证所有活动 Span 被标记并结束

## 5. Pi Utility Process 接入

- [ ] 5.1 将 Pi Worker 拆分为轻量 Bootstrap 与动态加载的 worker main，并通过模块加载顺序测试验证 AgentLoop 早于 Pi SDK
- [ ] 5.2 扩展 Pi launcher，为子进程生成并传入 Pi 专用 AgentLoop 环境，且通过测试验证不会继承 Claude `ARMS_APP_NAME`
- [ ] 5.3 将 Pi AgentSession 生命周期、模型、工具、Token、失败和中止事件适配为 `AgentTelemetryEvent`，并通过事件映射测试覆盖主要路径
- [ ] 5.4 将 AgentLoop flush/shutdown 接入 Pi `runtime.shutdown`，并通过正常退出、超时和强制退出测试验证不会阻断进程关闭
- [ ] 5.5 执行 Pi development 冒烟会话，确认数据进入 `SClaw-Pi_Agent_SDK-dev` 且形成 Agent 根 Span及可用的 LLM、Tool 子 Span

## 6. 灰度、兼容与文档

- [ ] 6.1 使用 `AGENTLOOP_ENABLED_ENGINES` 实现按环境灰度，验证移除 `pi` 后 Pi 功能正常但不产生 Pi AgentLoop 数据
- [ ] 6.2 更新 AgentLoop 接入说明和新增 Agent 指南，说明环境配置、注册定义、策略选择、安全默认值与回滚方式，并通过文档中的示例配置解析测试
- [ ] 6.3 更新系统分析文档与 OpenSpec 实现状态，确认术语、配置键和应用名与最终代码一致

## 7. 综合验证

- [ ] 7.1 运行 AgentLoop、Claude、Pi、主进程启动和 Utility Process 相关自动化测试，确认测试全部通过
- [ ] 7.2 分别验证 development、test、staging、production 构建配置，确认 Claude 与 Pi 只进入各自预期的 dev/test/online 应用
- [ ] 7.3 执行类型检查和构建检查，并验证构建产物可解析 AgentLoop、Claude 和 Pi 所需运行时依赖
- [ ] 7.4 执行 License、日志及遥测内容扫描，确认构建日志不输出凭证且默认不采集会话正文
