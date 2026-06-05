## Purpose

定义 StoClaw 首切片 **CRM 周报策略白名单** 的规范性需求：策略 Host 与 `VITE_APP_ENV` 绑定、经 Main/host-api 拉取白名单、SSO `userName` 与 `userCode` 比对、`crmWeekReportSurfaceAllowed` 的 fail-closed 语义、首页与 `/tasks/*` 行为。实现 MUST 遵守 `openspec/changes/archive/2026-05-14-user-page-access-control/design.md` 与 `proposal.md`。

## Requirements

### Requirement: Policy API host MUST be selected solely from compile-time VITE_APP_ENV

系统 SHALL 仅根据编译时 **`VITE_APP_ENV`**（与 `shared/env-config.ts` / Vite `--mode` 一致）解析策略 API 的 **`policyHost`**，且 SHALL NOT 使用 `useAuthStore` 的 `ssoEnvironment` 或 `SSO_ENVIRONMENTS` 推导该 Host。

映射 SHALL 为：`development` → `zc-test.sto.cn`；`test` → `zc-test.sto.cn`；`staging` → `pre-zc.sto.cn`；`production` → `zc.sto.cn`。

完整请求路径 SHALL 为：`https://{policyHost}/sto-policy/api/v1/base/getReportAuthUserIgnoreLogin?reportType=POLICY_CRM_WEEK_REPORT`。

#### Scenario: Production build uses production policy host

- **WHEN** 应用以 `VITE_APP_ENV=production` 构建或运行
- **THEN** 策略请求所使用的 `policyHost` SHALL 为 `zc.sto.cn`

#### Scenario: Development build ignores SSO environment dropdown for policy host

- **WHEN** 应用以 `VITE_APP_ENV=development` 运行且用户在 UI 中选择非测试类 SSO 环境
- **THEN** 策略请求所使用的 `policyHost` SHALL 仍为 `zc-test.sto.cn`

### Requirement: CRM whitelist retrieval MUST go through Main and host-api

对策略白名单的 HTTP 访问 SHALL 在 **Electron Main** 进程（或经其注册的 host 路由）中发起；Renderer SHALL 仅通过 **`src/lib/host-api.ts`**（`hostApiFetch` 或项目规定的等价入口）获取规范化后的授权结果。

Renderer MUST NOT 使用 `fetch` 或其它方式直连 `https://*.sto.cn/sto-policy/...`；Renderer 页面与组件 MUST NOT 新增未经批准的 `window.electron.ipcRenderer.invoke` 调用。

#### Scenario: Renderer requests whitelist

- **WHEN** Renderer 需要刷新 CRM 白名单判定结果
- **THEN** 其 SHALL 调用 host-api 暴露的路径并由 Main 完成对外 HTTP
- **AND** MUST NOT 在 Renderer 内拼接 `policyHost` 并发起裸跨域请求

### Requirement: crmWeekReportSurfaceAllowed MUST be computed with trim equality and fail-closed semantics

令 `ssoCode` 为当前已认证用户 `SsoUserInfo.userName` 经 `String(...).trim()` 的结果。对响应体中数组 **`data`** 的每一项，令 `entryCode` 为该元素 **`userCode`** 经 `String(...).trim()` 的结果。若存在任一项满足 `ssoCode === entryCode`（**大小写敏感**），则 **`crmWeekReportSurfaceAllowed` SHALL 为 `true`**；否则 SHALL 为 `false`。

若出现以下任一情况，**`crmWeekReportSurfaceAllowed` SHALL 为 `false`**（fail-closed，与未命中白名单一致）：HTTP 非 2xx、请求超时或网络失败、JSON 无法解析、`data` 缺失或非数组、或任一 `userCode` 无法规范为字符串用于比对。

#### Scenario: Trimmed codes match

- **WHEN** SSO `userName` 为 `" 1205314 "` 且 `data` 中存在 `userCode` 为 `"1205314\n"`
- **THEN** 规范化 trim 后相等且 `crmWeekReportSurfaceAllowed` SHALL 为 `true`

#### Scenario: Case mismatch does not grant

- **WHEN** SSO `userName` 经 trim 后为 `"abc"` 且唯一条目的 `userCode` 经 trim 后为 `"ABC"`
- **THEN** `crmWeekReportSurfaceAllowed` SHALL 为 `false`

#### Scenario: HTTP error is fail-closed

- **WHEN** Main 收到策略接口 HTTP 500 或超时
- **THEN** `crmWeekReportSurfaceAllowed` SHALL 为 `false`

### Requirement: CRM policy authorization MUST load and clear with the SSO session lifecycle

系统 SHALL 在用户 **已通过 SSO 认证** 且 `auth` 初始化或 **登录成功** 后触发策略白名单拉取，并将结果写入 Renderer 可读的授权状态（含 `crmWeekReportSurfaceAllowed`）。

用户 **登出** 后，系统 SHALL 清除 `crmWeekReportSurfaceAllowed` 及与该次策略拉取相关的缓存态，使其不泄漏至下一会话。

在 **一次成功拉取完成且比对为 `true`** 之前，用于首页与任务路由的 **`crmWeekReportSurfaceAllowed` SHALL 视为 `false`**（不得在未确认前展示 CRM 任务摘要表面或允许停留于 `/tasks/*`）。

#### Scenario: Logout clears authorization

- **WHEN** 用户执行登出
- **THEN** `crmWeekReportSurfaceAllowed` SHALL 为 `false`（或等价未授权哨兵值）且不得保留上一用户的白名单结果

#### Scenario: Fetch after login

- **WHEN** 用户完成 SSO 登录成功
- **THEN** 系统 SHALL 在随后发起策略白名单拉取并更新 `crmWeekReportSurfaceAllowed`

### Requirement: Home MUST show the CRM task summary surface only when crmWeekReportSurfaceAllowed is true

首页（`/`）SHALL 在 `crmWeekReportSurfaceAllowed === true` 时渲染 **`HomeSummaryCards`**（CRM 任务列表卡片区域）；SHALL 在 `crmWeekReportSurfaceAllowed === false` 时不渲染该区域，并 SHALL 仍渲染 `HomeHero` 与 `HomeAssistant`（「原首页」骨架）。

本需求不改变 `docs/sto-design.md` 下既有组件的主路径色与中性文本层级；仅控制区块是否存在。

#### Scenario: Allowed user sees task cards

- **WHEN** `crmWeekReportSurfaceAllowed` 为 `true` 且用户位于首页
- **THEN** 页面 SHALL 展示 `HomeSummaryCards`

#### Scenario: Disallowed user does not see task cards

- **WHEN** `crmWeekReportSurfaceAllowed` 为 `false` 且用户位于首页
- **THEN** 页面 SHALL NOT 渲染 `HomeSummaryCards`

### Requirement: Task detail paths under /tasks MUST redirect unallowed users to home

当 `crmWeekReportSurfaceAllowed === false` 时，用户访问 **`/tasks` 下任意路径** SHALL 被立即重定向至 **`/`** 且使用 **`replace` 语义**（或路由库等价物），用户 SHALL NOT 停留在任务详情内容区。

#### Scenario: Deep link denied

- **WHEN** `crmWeekReportSurfaceAllowed` 为 `false` 且用户导航至 `/tasks/hq-reconciliation/latest-entry-id`
- **THEN** 应用 SHALL 将路由替换为 `/` 且不保留任务页在历史栈顶作为可返回页（replace 语义）

#### Scenario: Allowed user can open task detail

- **WHEN** `crmWeekReportSurfaceAllowed` 为 `true` 且用户导航至合法任务路径
- **THEN** 应用 SHALL NOT 因本需求将该请求重定向到 `/`
