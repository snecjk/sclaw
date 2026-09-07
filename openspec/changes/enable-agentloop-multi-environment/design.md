## Context

当前 `vite.config.ts` 通过 `loadEnv(mode, process.cwd(), '')` 读取环境文件，但 AgentLoop 只在 vite-plugin-electron 的 `onstart` 回调中通过 `NODE_OPTIONS=-r @loongsuite/cms_node_sdk/register` 注入。该路径能覆盖 `pnpm dev`，不能覆盖打包后的 Electron 应用；同时，打包 Electron 对 `NODE_OPTIONS --require` 存在限制。

Claude Agent SDK 已通过 `claude-agent-sdk-loader.ts` 使用 CommonJS `require()` 延迟加载，这是 CMS 探针自动插桩的必要条件。主进程构建采用单文件输出，设计必须明确保证探针注册早于 Claude SDK 的首次运行时加载。

## Goals / Non-Goals

**Goals:**

- 为四种 Vite mode 建立相同的主进程初始化链路。
- 使用 `sto-claw-<mode>` 映射隔离四个 AgentLoop 应用。
- 在开发和安装包中保证探针注册顺序一致。
- 缺少配置或探针异常时安全降级，并避免泄露 License。

**Non-Goals:**

- 不为 OpenClaw Gateway、渲染进程或构建工具注入探针。
- 不新增 AgentLoop 管理界面、业务接口或本地配置存储。
- 不改变 Claude Agent SDK 的会话业务逻辑。

## Decisions

### 1. 使用独立的 Electron 主进程引导入口

增加轻量引导入口作为 vite-plugin-electron 的 main entry。引导入口先装载构建环境对应的 AgentLoop 配置，再通过 CommonJS `require()` 注册 `@loongsuite/cms_node_sdk/register`，最后动态加载现有 `electron/main/index.ts`。

该顺序避免依赖 ES Module 静态导入排序，也避免在打包应用中使用受限的 `NODE_OPTIONS --require`。现有主进程入口继续负责 Electron 生命周期和业务初始化。

替代方案是在 `electron/main/index.ts` 顶部增加副作用 import；该方式容易受静态依赖求值和打包排序影响，不能清晰证明探针一定先于全部业务模块，因此不采用。

### 2. 构建时解析环境配置，运行时只消费已解析结果

Vite 按当前 mode 读取 `.env.<mode>`；development 额外接受 `.env.development.local` 的本地覆盖。构建配置将 AgentLoop 必要字段注入主进程引导入口，使安装包运行时不依赖仓库中的 `.env` 文件。

非敏感的应用名在各 mode 文件中维护。License 等接入参数由本地忽略文件或 CI/CD 密钥变量提供，禁止写入提交记录。由于构建期注入的值可能从桌面安装包中提取，本设计将 License 视为仅具备遥测写入权限、允许客户端分发且可轮换的接入凭证；实施时必须验证其权限范围，不得使用具备控制台管理或数据读取权限的凭证。

替代方案是把 `.env` 文件作为安装包资源分发；该方案同样暴露凭证且增加运行时文件查找与篡改风险，因此不采用。

### 3. 固定环境与应用名称映射

应用名称映射为：

| Vite mode | AgentLoop 应用名称 |
| --- | --- |
| `development` | `sto-claw-development` |
| `test` | `sto-claw-test` |
| `staging` | `sto-claw-staging` |
| `production` | `sto-claw-production` |

`.env.development.local` 只覆盖 development 参数，不参与环境枚举。初始化时校验配置中的应用名与当前 mode 一致，防止测试数据误上报到生产应用。

替代方案是仅依赖自由填写的 `ARMS_APP_NAME`；其灵活性更高，但容易因复制配置造成环境串流，因此采用固定映射校验。

### 4. 初始化失败采用 fail-open

引导入口捕获配置校验和探针注册异常，输出不包含配置值的结构化告警，然后继续加载现有主进程入口。可观测能力不得成为桌面 Agent 的可用性依赖。

初始化模块使用进程级状态防止重复注册。Console exporter、日志级别和会话内容事件开关仅透传当前环境显式提供的值，不设置跨环境默认开启值。

替代方案是初始化失败即退出应用；虽然更容易暴露部署错误，但会让遥测故障中断用户工作，因此不采用。

### 5. 保留现有 Claude SDK Loader

`claude-agent-sdk-loader.ts` 的 CommonJS `require()` 和缓存行为保持不变。自动化验证应确认主进程引导入口先完成 CMS 注册，随后 loader 才首次解析 Claude SDK。

## Risks / Trade-offs

- [构建期 License 可被提取] → 上线前由安全方确认分发属性，使用最小权限凭证并具备轮换能力；不满足条件时切换到运行时受控配置方案。
- [错误 mode 或应用名导致环境串流] → 使用固定映射校验，并为四种 mode 增加构建测试。
- [引导入口异步加载改变启动时序] → 保持入口轻量，并回归单实例、窗口创建和主进程初始化流程。
- [SDK 升级改变 register 行为] → 固定兼容版本，增加探针加载与 `claude_agent` span 冒烟验证。
- [会话内容造成隐私风险] → 默认不主动开启内容事件，按环境显式配置并经合规确认。

## Migration Plan

1. 增加四环境应用名和构建期配置解析，但先保持现有 development 链路可回退。
2. 引入主进程引导入口及 fail-open 初始化，验证 development 的现有调用链不回退。
3. 分别构建 test、staging、production 安装包，验证上报进入对应 AgentLoop 应用。
4. 验证新入口稳定后，移除 Vite `onstart` 中仅用于 AgentLoop 的 `NODE_OPTIONS` 注入，保留其他启动环境处理。
5. 回滚时恢复原 main entry 并关闭各 mode 的构建期 AgentLoop 配置；该操作不改变 Claude Agent 业务数据。

## Open Questions

- test、staging、production 的 Region、Workspace 和 License 具体取值由发布环境配置决定，不影响初始化结构。
- production 的会话内容事件开关保持默认关闭，后续获得合规确认后可通过环境配置启用。
