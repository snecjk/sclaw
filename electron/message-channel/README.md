# message-channel

IM 渠道子系统目录（Host 编排 + 各渠道传输实现）。

## 当前结构

| 目录 | 职责 |
| --- | --- |
| `common/` | 三渠道共用编排：`session-facade` / `session-key` / `session-lifecycle` / 标题 / stream kind |
| `hub/` | SClaw Hub（钉钉 + Mobile 共用 WS / HTTP / binding / ingress / delivery）+ Host API `routes.ts` |
| `host/` | Host API 列表合并：`list.ts`（OC 视图 + Hub 钉钉 + 微信 Host overlay） |
| `mobile/` | Mobile 特有：历史列表/详情 RPC（`history-facade`） |
| `dingtalk/` | 钉钉渠道说明（实现在 `hub/` + `common/`，无独立业务文件） |
| `weixin/` | 微信 Host Worker + iLink；`host-login.ts` / `routes.ts`（`/api/channels/wechat/*`） |

## 约定

- 钉钉与 Mobile **共用**同一条 Hub WS / refreshToken；传输层在 `hub/`，不要塞进 `dingtalk/`。
- 微信出站不复用 Hub `delivery`（typing + commit 走 weixin bridge）。
- Host API：`hub/routes.ts` → `/api/channels/hub/*`；`weixin/routes.ts` → `/api/channels/wechat/*`；`host/list.ts` 供 `electron/api/routes/channels.ts` 列表聚合（均由 `electron/api/server.ts` 注册）。
- 技术方案：[`docs/微信渠道-Host-Worker技术方案.md`](../../docs/微信渠道-Host-Worker技术方案.md)
- 迁移记录：[`docs/钉钉Hub与Mobile迁入message-channel计划.md`](../../docs/钉钉Hub与Mobile迁入message-channel计划.md)
