# hub

SClaw Hub 传输与绑定（**钉钉 + Mobile 共用**同一条 WS / refreshToken）。

## 文件

- `hub-api.ts` / `hub-client.ts` / `hub-config.ts` — Hub HTTP + WebSocket
- `binding-service.ts` — `channel_connections`（dingtalk / mobile，含 `sto-mobile` 存储别名）
- `startup.ts` — `ensureChannelRuntimesReady`（probe → 按需微信 Worker / Hub WS；sync 后取 token）
- `ingress.ts` / `delivery.ts` / `inbound-media.ts` — 入站 → facade、流式出站、媒体物化
- `routes.ts` — Host API `/api/channels/hub/{dingtalk,mobile}/*`（原 `api/routes/channel-hub.ts`）

## 依赖

- 静态依赖 `../common/*`（session-facade / lifecycle / key / title / stream-content-kind）
- **不**静态回引 weixin；微信由 `startup` 动态 `import('../weixin/service')`
