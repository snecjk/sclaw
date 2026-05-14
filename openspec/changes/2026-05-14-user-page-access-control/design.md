## Context

- SSO 用户对象 `SsoUserInfo` 已由 Main 写入 Renderer，其中 **`userName`** 为与策略系统对齐的编码（示例：`"1205314"`），见 `electron/utils/sso-service.ts` 映射。
- 策略接口返回体顶层含 **`data`：数组**；每条含 **`userCode`**（可与 `jobnumber` 不同）、`userName`（展示姓名）等。授权判定 **仅比较** SSO 的 `userName` 与列表项的 **`userCode`**（产品已确认）。
- 仓库规则：Renderer 通过 `host-api` 访问后端；跨域策略域名应由 **Main `proxyAwareFetch` 或等价** 发起，避免 CORS 与凭证分散。

## Goals / Non-goals（首切片）

- **Goals**
  - 实现 **`crmWeekReportSurfaceAllowed`**（布尔）：SSO `userName` ∈ `data[].userCode`；**策略请求失败、超时或响应不合法时该布尔 SHALL 为 false**（fail-closed）。
  - **首页双态**：允许 → 现有 Hero + SummaryCards + Assistant；不允许 → Hero + Assistant（无 SummaryCards）。
  - **`/tasks/*`**：与布尔一致（不允许则不得停留于任务详情页）。
  - **policyHost** **仅**由编译时 **`VITE_APP_ENV`** 决定（见下表）；**已定稿**，不得随 `ssoEnvironment` 变化。实现为单一映射函数（Main 侧），禁止在 Renderer 硬编码散落 URL。
- **Non-goals（首切片）**
  - 不实现全站任意页面的 RBAC 矩阵（留待后续扩展 `auth-page-access-control`）。
  - 不在此切片强制改 Sidebar（除非产品补充）；提案中已标为后续与 `navigation-sidebar-provincial-variant` 合并。

## Decision：策略 API 形态与 Host 映射

**完整 URL 模式**：

`https://{policyHost}/sto-policy/api/v1/base/getReportAuthUserIgnoreLogin?reportType=POLICY_CRM_WEEK_REPORT`

**`policyHost` 与 `VITE_APP_ENV`（`shared/env-config.ts` 使用的编译时环境）对应关系**（**已定稿**）：

| `VITE_APP_ENV` | `policyHost` |
|----------------|--------------|
| `development` | `zc-test.sto.cn` |
| `test` | `zc-test.sto.cn` |
| `staging`（预发） | `pre-zc.sto.cn` |
| `production` | `zc.sto.cn` |

- **Rationale**：与「本地/测试 / 预发 / 生产」发布链路一致；策略域与 SSO 用户中心域名不同，**不得**用 `SSO_ENVIRONMENTS` 或 `ssoEnvironment` 推导 `policyHost`，以免错环境。
- **Alternative（已否决）**：按 `useAuthStore.ssoEnvironment` 映射 — 同一 dev 构建下用户可切换 SSO 环境，易导致策略请求打到错误 tier。若未来业务强制要求跟 SSO 环境走，须 **新开变更** 并在 spec 中写冲突规则与降级行为。

## Decision：比对规则

- 从 `GET` 响应解析 `data`；若非数组则视为无白名单（`allowed = false`）。
- 对 `data` 中每一项读取 **`userCode`**（字符串）；与 SSO **`userName`** 做 **严格相等**比较；实现可选用 `String(...).trim()` 去除首尾空白，**须在 normative spec 中固定**，避免前后端隐性不一致。
- **Rationale**：产品已用截图约定字段；不引入 `jobnumber` 以免与 `userCode` 语义混淆。

## Decision：授权态存放与刷新

- Main 完成 HTTP 后将 **规范化布尔** +（可选）原始条数或 etag 返回 Renderer；Renderer 存入 **auth 并列字段或 zustand slice**（`crmWeekReportSurfaceAllowed`、`crmWeekReportAuthStatus: 'idle' | 'loading' | 'ok' | 'error'`）。
- **刷新时机**：`init` 且已认证、`login` 成功之后各拉取一次；**logout** 清空。
- **Rationale**：与 SSO 会话同源；避免未登录频繁打策略接口。

## Decision：接口失败策略（已定稿）

- **fail-closed**：网络错误、超时、非 2xx HTTP、或 JSON 结构无法解析出合法 `data` 时，**一律**令 `crmWeekReportSurfaceAllowed === false`，与「不在白名单」相同：**原首页** + **不可停留于 `/tasks/*`**。
- **Alternative（已否决）**：fail-open（接口故障时仍展示 CRM 表面）— 未授权暴露面过大，本变更不采用。
- **Mitigation**：Main 侧记录请求结果（脱敏 URL、HTTP status、错误摘要），便于运维区分「全量不可用」与「个人未命中」。

## Decision：首页与路由 UX

- **首页**：条件渲染 `HomeSummaryCards`，不另开新路由名，避免 SEO/深链无意义（Electron 内也无此需求）。
- **`/tasks/*`**：`allowed === false` 时 **`Navigate` 至 `/` replace**（或等价），与「无任务列表」一致；不强制 toast（减少干扰），可选 i18n 一句说明留作后续。

## Decision：与 `docs/sto-design.md`

- 本切片以布局切换为主，**不新增**大面积警示色块；若后续增加「无权限说明」文案，使用 **中性灰阶文本 + 可选 Warning 语义**，不在 design 中引入新主色。

## Risks

- **[Risk]** 策略服务不可用 → 全员看不到 CRM 表面 → **Mitigation**：监控 + 上文失败策略；必要时后续加「运维开关」跳过校验（另变更）。
- **[Risk]** `userName` / `userCode` 大小写或前导零不一致 → **Mitigation**：规范在 spec 中写明是否大小写敏感（默认 **敏感**，与 `===` 一致）。
- **[Risk]** 列表过大影响响应 → **Mitigation**：客户端仅遍历数组 O(n)；若 n 过大由策略侧分页或接口另议（非首切片）。

## Next Steps

1. ~~在 `specs/auth-page-access-control/spec.md` 中写 **SHALL** 与 **#### Scenario:**~~（已完成）
2. ~~撰写 `tasks.md`（与 spec 中 `### Requirement:` 标题对齐）~~（已完成；实现时逐项勾选 checkbox）
3. 按 `tasks.md` 实现代码与 README 环境说明（若需要）
