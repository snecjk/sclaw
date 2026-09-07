# AgentLoop / ARMS 接入说明

本文说明 SClaw Electron 主进程接入阿里云 ARMS AgentLoop 可观测能力的配置方式、
环境隔离策略与安全约束。实现见 OpenSpec change `enable-agentloop-multi-environment`。

## 概述

- 探针：`@loongsuite/cms_node_sdk/register`，在 Electron 主进程引导入口
  （`electron/main/index.ts` → `agentloop-init.ts`）中以 CommonJS `require()` 注册，
  早于 Claude Agent SDK 的首次运行时加载，从而自动插桩 `claude_agent` 调用链。
- development、test、staging、production 四种环境使用**同一条初始化链路**，
  不依赖 Vite 开发启动钩子，也不使用打包应用中受限的 `NODE_OPTIONS --require`。
- 探针初始化失败一律 **fail-open**：记录脱敏告警并继续启动，不影响 SClaw 与
  Claude Agent 功能。

## 环境与应用名固定映射

| Vite mode | AgentLoop 应用名称 |
| --- | --- |
| `development` | `SClaw-Claude_Agent_SDK-dev` |
| `test` | `SClaw-Claude_Agent_SDK-test` |
| `staging` | `SClaw-Claude_Agent_SDK-test` |
| `production` | `SClaw-Claude_Agent_SDK-online` |

- 应用名按构建 mode 固定映射并写入 `.env.<mode>`，**勿改**；
  初始化时校验应用名属于固定映射，防止配置复制导致的环境串流。
- 应用命名规则为 `SClaw-<Agent框架名>-<环境名>`。框架名使用
  `Claude_Agent_SDK` 或 `Pi_Agent_SDK`；环境名使用 `dev`、`test` 或
  `online`。当前接入 Claude Agent SDK，staging 归入测试环境。
- 四个 mode 文件共用同一套 AgentLoop 接入参数。

## 配置项清单

| 配置项 | 敏感级别 | 交付方式 | 说明 |
| --- | --- | --- | --- |
| `ARMS_APP_NAME` | 非敏感 | `.env.<mode>` 固定映射 → Vite define | 四个 mode 分别使用独立名称 |
| `ARMS_LICENSE_KEY` | **敏感** | `.env.<mode>` → 构建期配置文件 | 必填；四个 mode 共用；`ARMS_LICENSE` 仅作历史回退；`auto` 无效 |
| `ARMS_REGION_ID` | 非敏感 | `.env.<mode>` → Vite define | 四个 mode 共用 |
| `ARMS_WORKSPACE` | 非敏感 | `.env.<mode>` → Vite define | 四个 mode 共用 |
| `ARMS_ENABLE_CONSOLE_EXPORTER` | 非敏感 | `.env.<mode>` → Vite define | 当前四个 mode 均开启控制台 span 输出 |
| `OTEL_LOG_LEVEL` | 非敏感 | `.env.<mode>` → Vite define | 当前四个 mode 均设置为 `debug` |
| `OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT` | 非敏感 | `.env.<mode>` → Vite define | 当前四个 mode 均开启会话内容上报，需遵循内容合规要求 |

运行策略由当前 mode 文件显式声明。目前四个环境均开启 Console Exporter、debug
日志和会话消息上报；生产发布前需确认日志量、内容上报与合规要求。

## Mode 配置

配置分别维护在 `.env.development`、`.env.test`、`.env.staging` 和
`.env.production` 中。连接信息相同，应用名按 mode 区分：

```ini
ARMS_LICENSE_KEY=your_agentloop_license_key
ARMS_APP_NAME=SClaw-<Claude_Agent_SDK|Pi_Agent_SDK>-<dev|test|online>
ARMS_REGION_ID=cn-shanghai
ARMS_WORKSPACE=your_agentloop_workspace
ARMS_ENABLE_CONSOLE_EXPORTER=true
OTEL_LOG_LEVEL=debug
OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT=true
```

## 加载规则

| 命令 | 加载文件 | AgentLoop 应用名 |
| --- | --- | --- |
| `pnpm dev` | `.env.development` | `SClaw-Claude_Agent_SDK-dev` |
| `pnpm package:test` | `.env.test` | `SClaw-Claude_Agent_SDK-test` |
| `pnpm package:staging` | `.env.staging` | `SClaw-Claude_Agent_SDK-test` |
| `pnpm package` | `.env.production` | `SClaw-Claude_Agent_SDK-online` |

若构建进程显式设置同名环境变量，Vite 会优先使用进程环境变量；常规构建以
对应的 `.env.<mode>` 为准。

构建期将非敏感字段经 Vite define 打进主进程 bundle，License 单独写入
`agentloop.config.json`（不进入 define、源码或构建日志）。安装包运行时不依赖
仓库中的 `.env` 文件。

## License 权限要求

License 会随桌面安装包分发、可被提取，因此必须是**仅具备遥测写入权限**、
允许客户端分发且可轮换的接入凭证，不得使用具备控制台管理或数据读取权限的凭证。
权限验证记录见 `docs/agentloop-license-review.md`。

## 运行行为与排障

- 启动日志特征：
  - 成功：`[AgentLoop] 探针已注册（应用环境=<env>）`，随后
    `[CMS][INFO] NodeSDK initialized ... service=SClaw-Claude_Agent_SDK-<env>`
  - 降级：`[AgentLoop] ... 跳过探针初始化` 或 `探针注册失败，已降级继续启动`
    （缺应用名 / 缺 License / 应用名串流 / 探针模块缺失等，均为脱敏固定文案，
    日志不会出现 License 或完整配置值）。
- 探针异常不会阻断应用：fail-open 后业务入口照常加载（集成测试
  `tests/integration/agentloop-fail-open.test.ts` 覆盖真实缺失模块场景）。

## 凭证扫描记录（task 3.3）

- 四个 mode 文件按当前发布要求保存同一套 AgentLoop 接入参数。
- `.env.example` 与本文示例仅使用无效占位符。
- 接入凭证进入 Git 后会保留在提交历史中，轮换时需同步更新四个 mode 文件。
