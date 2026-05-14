## Why

StoClaw 已具备 SSO 登录态（`useAuthStore`）与「未登录 / 未完成 setup」的路由守卫，但 **所有已登录用户仍可访问主壳下全部路由**；侧栏收窄目前由构建时 `VITE_STOCLAW_SIDEBAR_LAYOUT` 与 `getSidebarVisibility` 驱动，与 **具体登录用户** 无关。

**本变更首切片（已确认）**：CRM 周报相关能力仅对 **策略服务白名单** 内用户开放：通过 SSO 的 `userName` 与策略接口返回列表中的 `userCode` 比对；命中则展示 **当前首页（含任务列表卡片）** 并允许使用任务详情路径；未命中则展示 **原首页内容**（无任务列表卡片区域），并应对深链 `/tasks/*` 做一致限制。后续可将同一模式扩展到其它页面与侧栏（见 `design.md`）。

## What Changes（首切片范围）

- **权限数据**：**SSO + 独立 HTTP 接口**（已定稿）。SSO 用户信息沿用现有字段 **`user.userName`**（工号类编码，与策略侧 `userCode` 对齐）。
- **白名单接口**（路径与参数已定）：
  - `GET https://{policyHost}/sto-policy/api/v1/base/getReportAuthUserIgnoreLogin?reportType=POLICY_CRM_WEEK_REPORT`
  - `{policyHost}` **仅**按编译时 **`VITE_APP_ENV`** 取值（见 `design.md` 映射表），**已定稿：不得**按 `useAuthStore` 的 `ssoEnvironment` 或其它运行时 SSO 切换推导策略域（避免同一构建下错连预发/生产策略）。
- **判定**：当且仅当存在 `response.data` 数组中某一元素的 **`userCode`** 与当前登录用户的 **`userName`** 字符串相等（实现阶段可对两端做规范化如 `trim`，须在 spec 中写死）时，`crmWeekReportSurfaceAllowed === true`。
- **接口失败或超时（已定稿）**：**fail-closed**——`crmWeekReportSurfaceAllowed` 视为 **`false`**（与「不在白名单」一致）：**原首页**（无任务列表卡片）+ **不可进入 `/tasks/*`**（须重定向或等价拒绝）。
- **首页**：`true` → 保留现有 `HomeHero` + **`HomeSummaryCards`（任务列表入口）** + `HomeAssistant`；`false` → **`HomeHero` + `HomeAssistant` 仅**（不渲染任务列表卡片区域），即「原首页内容」。
- **任务详情路由**：与首页白名单一致——`false` 时用户访问 `/tasks/*` 应被重定向或等价拒绝（具体句式在 spec 中 SHALL），避免仅藏卡片仍可通过 URL 进入。
- **传输**：Renderer **不得**直连 `https://*.sto.cn/...`；须经 **`host-api` / Main 代理**（与仓库 Renderer/Main 边界规则一致）。

## Capabilities

### New Capabilities

- `auth-page-access-control`：首切片落地 **CRM 周报策略白名单**（SSO `userName` × 接口 `userCode`）、布尔型壳内授权状态、**接口失败/超时 fail-closed**、首页双态、与 `/tasks/*` 一致的路由行为；策略 Host 按 `VITE_APP_ENV` 映射。

### Modified Capabilities

- `navigation-sidebar-provincial-variant`（后续 PR）：若侧栏需隐藏「任务/数据」入口与本授权对齐，则在 `getSidebarVisibility` 或导航数据源中 **合并** `crmWeekReportSurfaceAllowed`；**首切片可不改侧栏**，仅首页 + 任务路由即可满足已确认需求。

### Related（内容依赖，非本变更重命名）

- `home-task-list-surface`：任务卡片与 `/tasks/*` 为授权用户可见路径；未授权用户回退到无该表面的首页。

## Impact（实现阶段）

- `electron/`：注册 host 路由代理策略 GET（或复用既有 fetch 辅助）、按 `VITE_APP_ENV`（或 Main 已知 app env）解析 `policyHost`。
- `src/lib/host-api.ts`：暴露供 Renderer 调用的拉取/刷新白名单结果（具体路径在实现时命名）。
- `src/stores/auth.ts` 或专用 store：`crmWeekReportSurfaceAllowed`、加载/错误态、在 `init` 登录成功后触发拉取。
- `src/pages/Home/index.tsx`、`src/App.tsx`（或任务路由包装）：条件渲染与重定向。
- 本变更已含 `specs/auth-page-access-control/spec.md` 与 `tasks.md`；实现阶段完成后若对外行为或环境变量有说明则同步 `README*.md`。

## 已定稿（补充）

- **策略 Host**：与 **`VITE_APP_ENV`（编译时）** 绑定；与 SSO 登录所选环境 **解耦**（产品已确认）。
- **策略接口失败 / 超时 / 非 2xx / 响应无法解析**：**fail-closed**，`crmWeekReportSurfaceAllowed === false`，表现与未命中白名单相同（原首页 + 不可进 `/tasks/*`）。
