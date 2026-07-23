# StoClaw 钉钉 Hub 开发任务（V1 · 广播投递）

> 日期：2026-07-12  
> 定案：下行 **Redis Pub/Sub 广播**；无独立 Gateway；先服务端 WS，再客户端  
> Hub：`sto-wisdom-star` · Desktop：`sto-claw`

**已有可复用：**
- 绑定 API / 表 / Listener sclaw 分支 / HTTP reply 刷卡（前期已落）
- Redis 发布订阅骨架：`RedisMsgPublisher` + `SpringRedissonConfig.listenerContainer`
- **本迭代：追加 sclaw 推送 topic + 真正的 WS 服务端（替换/并行于临时 SSE）**

---

## 总顺序

```text
S1 WS 服务端会话
 → S2 Redis 广播 topic（发布 + 全 Pod 消费）
 → S3 入站链路串起来（Listener → 发卡 → publish）
 → S4 上行回程（WS 或沿用 HTTP reply）
 → —— 服务端可联调 ——
 → C1～C4 客户端
```

---

## 阶段 S：服务端（本周优先）

### S1. WebSocket 服务端 【当前】

- [x] `pom` 增加 `spring-boot-starter-websocket`（web / conversation 模块）
- [x] `SclawWebSocketConfig`：注册 `/ws/sclaw`
- [x] `SclawWebSocketHandler` + Handshake（refreshToken）
- [x] `SclawWsSessionRegistry`：本机 map + Redis online/conn
- [x] 同 device 新连接踢旧连接
- [ ] 验收：用 wscat/脚本带 refreshToken 连上，Hub 日志见 online

### S2. Redis 广播 topic（追加消费频道）

- [x] 配置项：`redis.sclawPushTopic`（默认 `sclaw_push_topic`）
- [x] `SpringRedissonConfig.listenerContainer` **追加** `ChannelTopic(sclawPushTopic)`
- [x] `SclawPushRedisMsgListener#onMessage`：本机有该 deviceId 的 WS 才 send
- [x] 入站侧：`SclawPushPublisher`（本机直推优先，否则 publish）
- [ ] 验收：跨 Pod / 本机自测推送

### S3. 钉钉入站串 WS 广播

- [x] `SclawDingInboundService`：未绑定/离线短提示；在线 → 发卡 + publish
- [x] 去掉临时 SSE（`/device/stream`）
- [x] SSO 放行 `/ws/**`
- [ ] 验收：调试回调 → WS 客户端收到 inbound

### S4. 上行回程

- [x] V1a：`POST /api/m/sclaw/reply/stream`
- [x] V1b：WS `delta` / `done` → `SclawReplyService`
- [ ] 验收：模拟 delta → 钉钉卡片 streamUpdate

### S5. 服务端联调清单

- [ ] 扫码 create → H5 confirm → claim → WS 连接
- [ ] 心跳 / 断线重连（refreshToken）
- [ ] 离线发钉钉有短提示
- [x] 文档：`docs/sclaw/README.md` 更新为 WS + 广播 topic

---

## 阶段 C：客户端（服务端 S1～S4 可联调后）

### C1. HubClient（WS）

- [x] `electron/channels/hub-client.ts`：连 Hub WS、refreshToken、心跳、断线退避重连
- [x] 收 `inbound` 事件（`emit('inbound')`；Facade 后续接）
- [x] Hub Base URL / Host API / migration / 启动重连

### C2. 绑定与本机存储

- [x] `channel_connections` migration
- [x] Host API：create/poll/claim/unbind/status（调 `/api/m/sclaw/**`）
- [ ] 扫码 UI（去掉用户填 AK/SK）

### C3. 执行与回程

- [ ] SessionFacade → `getAdapter` 页面对话链
- [ ] 流式 delta/done → HTTP reply 或 WS 上行
- [ ] 同 peer 本机串行（配合 Hub）

### C4. 验收

- [ ] 钉钉私聊 → 桌面执行 → 流式回钉钉
- [ ] 对照规格 §10

---

## Topic / 协议草案（实现锁定）

**Redis channel：** `${redis.sclawPushTopic:sclaw_push_topic}`

**广播 payload（JSON）：**
```json
{
  "type": "inbound",
  "deviceId": "...",
  "channelTraceId": "...",
  "chatUid": "...",
  "robotCode": "...",
  "dingUserId": "...",
  "peerId": "...",
  "group": false,
  "text": "...",
  "senderNick": "..."
}
```

**WS 服务端 → 客户端：** 同上 `inbound`；可加 `connected` / `ping`  
**客户端 → 服务端（若走 WS 上行）：** `{ "type":"delta"|"done", "chatUid", "content" }`

---

## 明确不做（本迭代）

- 独立 Gateway、定点 mailbox  
- 微信 / App  
- `robotCode` 实值（配置占位，机器人创建后补）

---

## 进度

| 任务 | 状态 |
|------|------|
| S1 WS 服务端 | **代码完成，待联调验收** |
| S2 Redis topic | **代码完成，待联调验收** |
| S3 入站串联 | **代码完成，待联调验收** |
| S4 上行 | **代码完成，待联调验收** |
| C1～C4 | 服务端可联调后 |

