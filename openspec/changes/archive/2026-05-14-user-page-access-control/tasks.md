## 1. Main 与 host-api

- [x] 1.1 对照 `### Requirement: Policy API host MUST be selected solely from compile-time VITE_APP_ENV`：在 Main 侧实现 `VITE_APP_ENV` → `policyHost` 单一映射（`development`/`test` → `zc-test.sto.cn`，`staging` → `pre-zc.sto.cn`，`production` → `zc.sto.cn`），且 MUST NOT 使用 `ssoEnvironment` 推导该 Host。
- [x] 1.2 对照 `### Requirement: CRM whitelist retrieval MUST go through Main and host-api`：Main 注册 HTTP 代理（或既有 host 路由扩展），对 `GET …/sto-policy/api/v1/base/getReportAuthUserIgnoreLogin?reportType=POLICY_CRM_WEEK_REPORT` 发起请求；`src/lib/host-api.ts` 暴露 Renderer 可调用的路径；页面/组件 MUST NOT 新增直连 `window.electron.ipcRenderer.invoke`，MUST NOT 从 Renderer 对 `*.sto.cn` 发起裸 `fetch`。
- [x] 1.3 对照 `### Requirement: crmWeekReportSurfaceAllowed MUST be computed with trim equality and fail-closed semantics`：在 Main（或共享纯函数 + Main 调用）解析响应 `data` 数组，对 SSO `userName` 与各条 `userCode` 在 **trim 后** 做 **大小写敏感** 严格相等；非数组、缺字段、非 2xx、超时、网络错误 MUST 产出 `allowed === false`。

## 2. Renderer 状态与生命周期

- [x] 2.1 对照 `### Requirement: CRM policy authorization MUST load and clear with the SSO session lifecycle`：在 `useAuthStore`（或并列 slice）中维护 `crmWeekReportSurfaceAllowed` 与加载/错误态；于 `init` 已认证与 `login` 成功后拉取策略结果；于 `logout` 清空布尔与相关状态。
- [x] 2.2 对照 `### Requirement: Home MUST show the CRM task summary surface only when crmWeekReportSurfaceAllowed is true`：`Home` 仅在 `crmWeekReportSurfaceAllowed === true` 时渲染 `HomeSummaryCards`；为 `false` 或加载未完成且按 spec 应视为未授权时 MUST NOT 展示该表面（与 fail-closed 一致，见 spec 场景）。
- [x] 2.3 对照 `### Requirement: Task detail paths under /tasks MUST redirect unallowed users to home`：`/tasks/*` 在 `crmWeekReportSurfaceAllowed === false` 时 MUST `Navigate` 至 `/` 且 `replace`（或等价），用户不得停留在任务详情页。

## 3. 测试与质量

- [x] 3.1 对照 `### Requirement: crmWeekReportSurfaceAllowed MUST be computed with trim equality and fail-closed semantics`：新增单元测试覆盖 trim 相等、无命中、非数组 `data`、HTTP 失败与超时语义（若比对逻辑在共享模块则直接测该模块）。
- [x] 3.2 对照 `### Requirement: Policy API host MUST be selected solely from compile-time VITE_APP_ENV`：为 Host 映射表增加单元测试（各 `VITE_APP_ENV` 期望值）。
- [x] 3.3 运行 `pnpm run typecheck` 与 `pnpm test`（相关用例）通过。

## 4. 文档

- [x] 4.1 若对外行为或环境依赖有变化：审阅并更新 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 中与 CRM 白名单或策略域相关的说明（与 `openspec/config.yaml` 文档同步规则一致）。

## 5. 通信与后续（本切片默认不涉及）

- [ ] 5.1 若实现中改动了 Gateway 事件、runtime 收发或传输回退：按 `openspec/config.yaml` 运行 `pnpm run comms:replay` 与 `pnpm run comms:compare`。
- [ ] 5.2（后续变更）对照 `navigation-sidebar-provincial-variant`：将 `crmWeekReportSurfaceAllowed` 并入侧栏可见性（本切片 tasks 不强制完成）。
