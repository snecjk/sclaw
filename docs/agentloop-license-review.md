# AgentLoop License 凭证分发安全审查

本文档记录 OpenSpec change `enable-agentloop-multi-environment` 任务 1.3 的验证结果：AgentLoop License 的权限范围、分发属性与凭证泄露扫描。

## 背景

依据 `design.md` 决策 2：License 在构建期注入安装包（`dist-electron/main/agentloop.config.json`），可能被从桌面安装包中提取。因此设计要求：

> 将 License 视为**仅具备遥测写入权限、允许客户端分发且可轮换**的接入凭证；实施时必须验证其权限范围，**不得使用具备控制台管理或数据读取权限的凭证**。

## License 用途与权限范围

AgentLoop / ARMS `ARMS_LICENSE_KEY` 通过 `@loongsuite/cms_node_sdk` 使用，其唯一用途是：

- 作为 OTLP 上报的接入凭证，向 AgentLoop 服务端**写入** trace / span / metrics 遥测数据。

它不用于：

- 登录 AgentLoop / ARMS 控制台；
- 读取、查询或导出任何遥测数据；
- 管理应用、工作区或其他资源。

## 验证清单

| # | 验证项 | 结论 | 说明 |
| --- | --- | --- | --- |
| 1 | License 仅具备遥测写入权限 | ✅ 符合 | 该凭证形态（`<appId>@<token>`）为 AgentLoop SDK 上报接入凭证，作用域为数据写入，不开放控制台管理或数据读取接口。 |
| 2 | 允许客户端分发 | ✅ 符合 | 属桌面端遥测 SDK 的标准接入方式，凭证随安装包分发是预期用法。 |
| 3 | 可轮换 | ⚠️ 需运维确认 | 轮换需在 AgentLoop 接入中心重新签发并更新 `.env.*.local` / CI 密钥后重发版。请在发布流程中记录轮换入口。 |
| 4 | 非控制台管理 / 数据读取凭证 | ✅ 符合 | 未使用具备控制台管理或数据导出权限的凭证。 |
| 5 | 仓库不含真实凭证 | ✅ 已扫描 | 见下方扫描结果。 |
| 6 | 构建产物 / 日志不含明文凭证 | ✅ 已验证 | License 经 `agentloop.config.json` 注入，不进 Vite define / 源码 / 构建日志；见下。 |

## 凭证泄露扫描结果（2026-09-07）

对仓库执行了真实 License 值与凭证形态扫描：

```
真实值扫描（排除 node_modules/dist/release 等产物目录）：
  仅 .env.development.local 命中 —— 该文件被 .gitignore 覆盖（*.local），属预期。

git 已跟踪文件扫描（git grep）：
  修复前：.env.example 注释中曾含真实 License 与真实 Workspace —— 已移除并替换为无效占位符。
  修复后：无任何已跟踪文件含真实 License。
```

`.gitignore` 覆盖确认：

- `.env.development.local` → 命中 `*.local` ✅
- `dist-electron/main/agentloop.config.json`（含 License 的构建产物）→ 命中 `dist-electron` ✅
- `dist/`、`release/` → 已忽略 ✅

## 构建期凭证流向（任务 1.2 实现）

- License 由 `resolveAgentLoopBuildConfig` 解析（CI 进程环境变量优先，`.env.<mode>.local` 次之）。
- License **只**写入 `dist-electron/main/agentloop.config.json`（构建产物，已被 gitignore）。
- License **不进入** Vite `define`，因此不会被静态替换进 `dist-electron/main/index.js` 或渲染层 `dist/`。
- 已验证：`grep` 主进程 bundle 与渲染层产物均无 License 明文；构建日志仅输出脱敏告警（不含配置值）。
- 非敏感字段（`ARMS_APP_NAME`、`ARMS_REGION_ID`、`ARMS_WORKSPACE`、可选开关）才经 `define` 注入主进程 bundle。

## 残留风险与建议

1. **安装包可提取 License**：符合"可分发"前提，但意味着任何拿到安装包的人都可向本应用名下写入遥测数据。依赖服务端按应用名 + License 做写入侧限流与异常数据清洗。
2. **轮换流程未固化**：建议在发布 runbook 中补充 License 轮换步骤（重新签发 → 更新 CI 密钥 → 重发版）。
3. **历史泄露**：`.env.example` 曾提交真实 License。若该提交已推送远端，建议在 AgentLoop 接入中心轮换该 License 并作废旧值。
