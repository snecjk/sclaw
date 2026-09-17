# message-channel

IM 渠道子系统（Host 编排 + 各渠道传输）。

## 结构

| 目录 | 职责 |
| --- | --- |
| `common/` | session-facade / session-key / session-lifecycle / 标题 / stream kind |
| `hub/` | 钉钉 + Mobile 共用 Hub WS / HTTP / binding / ingress / delivery；`startup.ts` 运行时按需拉起 |
| `host/` | 渠道列表合并（`list.ts`） |
| `mobile/` | App 历史 RPC |
| `dingtalk/` | 说明目录（实现在 `hub/` + `common/`） |
| `weixin/` | 微信 Host Worker + iLink |

## 启动检测（按需拉起）

入口：`ensureChannelRuntimesReady`（别名 `ensureSclawHubConnected`）。触发：App 启动、登录/切号。

1. **probe**：一次读钉钉/Mobile 行；微信看本地 bot 凭证（可顺带迁移）。**不算最终 refreshToken**。
2. **微信**：有凭证才 `Worker.start`；无则不 fork。
3. **Hub**：`shouldAttempt` = 有 Hub baseUrl，且（Mobile `bound+enabled+token` **或** 钉钉 `bound+token`）。否则不进 Hub。
4. **sync** 钉钉远程绑定（可能 revoke 本机钉钉 token）。
5. **sync 之后**再 `resolveSharedHubRefreshToken` → 有 token 才 `hub.connect`。  
   `replaced` / `unbound` → 不 connect（与旧行为一致）。

硬约束：禁止用 sync 前缓存的 token 去 connect。  
收紧：`revoked` 行残留 token **不算**可用（不再 fallback 误连）。

列表 API **只读** WS/`isReady` 状态，不跑完整 ensure。

## 各渠道状态判断

| | 已绑定（本机） | 运行时在线 |
| --- | --- | --- |
| 钉钉 | DB `bind_status=bound`（可再对 remote device） | 共用 Hub WS `connected` |
| Mobile | DB `bound` 且 `enabled` | 同上一条 Hub WS |
| 微信 | 本地 bot token（或 DB bound） | Worker ready 且 monitor 在跑 |

钉钉/Mobile **一条** WS；微信 **独立** Worker。UI 圆点/副标题见 [`src/pages/Channels/README.md`](../../src/pages/Channels/README.md)。

## 解绑

| 动作 | 效果 |
| --- | --- |
| 解绑钉钉 | revoke 钉钉行；若 Mobile 未 bound → `disconnect` WS；否则保持 |
| 关 Mobile | revoke/disable Mobile 行；若钉钉未 bound → `disconnect`；否则保持 |
| 解绑微信 | 清凭证 / stop monitor / **`shutdown()` 销毁 Worker** |
| 远程抢绑钉钉 | `disconnectPermanently` + 清本机钉钉 bound |

归属在 `hub/routes` / 换绑处理，不在 ensure 里重复。

## 重新绑定

| 动作 | 效果 |
| --- | --- |
| 钉钉扫码 claim | 写 bound + token → **只** `hub.connect`（不整包 ensure） |
| 开 Mobile | register/enable → **只** `hub.connect` |
| 微信扫码成功 | 写凭证 → `applyLoginSuccess` / `start`（可先 `ensureReady` 预热） |

绑定成功路径不要回灌全量 `ensureChannelRuntimesReady`。

## 约定

- 钉钉与 Mobile 共用一条 Hub WS / refreshToken；传输在 `hub/`。
- 微信出站不走 Hub `delivery`（typing + commit）。
- Host API：`hub/routes` → `/api/channels/hub/*`；`weixin/routes` → `/api/channels/wechat/*`；`host/list` 供 channels 列表。
- 新开会话：[`common/session-new-flow.md`](./common/session-new-flow.md)
- 方案：[`docs/微信Worker按需拉起方案.md`](../../docs/微信Worker按需拉起方案.md)、[`docs/微信渠道-Host-Worker技术方案.md`](../../docs/微信渠道-Host-Worker技术方案.md)
