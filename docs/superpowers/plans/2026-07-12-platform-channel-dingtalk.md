# 平台 Channel Plane（钉钉 V1）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
>
> **规格：** `sto-claw/docs/superpowers/specs/2026-07-11-platform-channel-design.md`

**目标：** 组织共用一个钉钉机器人，经 `sto-wisdom-star` Hub 按用户路由到在线 StoClaw，本机走 SessionFacade 双引擎执行并以流式回钉钉。

**架构：** Hub 持证收 Stream → `robotCode` 判 sclaw → 用户匹配 → 按用户队列 → WS 推桌面；桌面 HubClient 入站 → SessionFacade → 页面对话链 → 增量回 Hub → `DingCardService.streamUpdate`。

**技术栈：** Java（wisdom-star-conversation）+ Redis + MySQL；Electron/TS（StoClaw）+ 本机 SQLite（node:sqlite + Kysely）。

**仓库：**
- Hub：`/Users/wenpeng/IdeaProjects/shentongneiwai/sto-wisdom-star`
- Desktop：`sto-claw`（本仓）

**总原则：** Hub 与桌面可并行脚手架，但 **E2E 验收顺序** 为 P0 → P1 → P2 → P3。`robotCode` 创建机器人后再填实值。

---

## 文件结构（锁定边界）

### Hub（sto-wisdom-star / wisdom-star-conversation）

| 文件/模块 | 职责 |
|-----------|------|
| DDL / migration：`sclaw_device_bind` | 用户↔设备↔refreshToken |
| Redis：`sclaw:bind:*`、在线登记 | bindToken / ticket / 在线态 |
| `SclawBindService` | 出码、H5 确认、发 ticket、解绑、后绑覆盖 |
| `SclawWsGateway` | WS 鉴权（ticket / refreshToken）、在线表、推送入站 |
| `SclawUserQueue` | 按 `dingTalkUserId`（或 device）排队投递 |
| `SclawRouteService` | senderStaffId → 绑定 → 在线 → 入队或短提示 |
| 修改：`RobotMsgCallbackListener` | 去重后按 `robotCode` 分支，sclaw 不进 `ChatEntrance` |
| 回程：对接 `DingCardService.streamUpdate` | 收桌面 delta / done |
| H5 页（免登） | 扫码确认页，拿 userid 写 Redis confirmed |
| Host HTTP API | 出码、轮询、解绑（供桌面调） |

### Desktop（sto-claw）

| 文件 | 职责 |
|------|------|
| `electron/db/migrations/0002-channel-plane.ts` | `channel_connections` 单表 |
| `electron/channels/hub-client.ts` | WS 注册、收路由消息、回程 delta |
| `electron/channels/binding-service.ts` | 本机 Agent 绑定；默认 Claude+main；策略 C |
| `electron/channels/session-facade.ts` | 双引擎 → `getAdapter` |
| `electron/channels/session-key.ts` | `agent:{id}:dingtalk:{peerId}` |
| `electron/channels/ingress.ts` / `delivery.ts` | Hub→Facade；结果→Hub |
| `electron/channels/logging.ts` | `channelTraceId` |
| Host API（main） | 出码/轮询/解绑/选脑/状态 |
| Channels UI | Hub 状态 + 扫码绑定 + 选脑；去掉用户填 AK/SK |
| 修改：`channels` 相关路由 | 钉钉不走 `ensureDingTalkPluginInstalled` / 不写 openclaw 钉钉配置 |

---

## 阶段总览

| 阶段 | 产出 | 可独立验收 |
|------|------|------------|
| **P0** Hub 骨架 | 表 + Redis + Listener 分支占位 + 未绑定短提示 | 发消息到 sclaw 机器人 → 提示扫码（不依赖桌面） |
| **P1** 扫码 + WS | 出码/H5/ticket/refreshToken + 桌面连上 | 扫码后 Hub 见在线；离线提示 |
| **P2** 入站执行 | 队列 → WS 推 → Facade → 终态或流式回钉钉 | 钉钉私聊能通一轮对话 |
| **P3** 流式 + UI 打磨 | 增量 `streamUpdate` + Binding UI + API 分流 | 规格 §10 验收清单全绿 |
| **P4**（并行/可后） | 创建个人助理机器人 → 填 `robotCode` | 配置落地 |

建议人力：Hub 与 Desktop 各 1 人可从 P0/P1 脚手架并行；合流点在 P1 末（协议对齐）与 P2。

---

## 任务 0：开工前对齐

- [ ] 规格标「已评审」（产品/研发确认）
- [ ] 约定 Hub↔Desktop WS/HTTP 消息草案（可先写进本计划附录或规格 §6.2.1）：`inbound` / `delta` / `done` / `error`、字段含 `channelTraceId`、`peerId`、`dingTalkUserId`
- [ ] `robotCode`：配置占位（环境变量/配置项），创建机器人后补值（P4）
- [ ] 确认测试环境钉钉应用与回调仍指向智慧星现有 Listener

---

## 任务 1（P0）：Hub 表与 Listener 分支

**仓库：** sto-wisdom-star

- [ ] 建表 `sclaw_device_bind`（规格 §6.9）
- [ ] Redis key 约定落地（bind / online）
- [ ] 在 `RobotMsgCallbackListener.execute` 去重后插入分支：`robotCode` 匹配 sclaw → 走新服务；否则原 `ChatEntrance`
- [ ] sclaw 分支：查绑定；无绑定/离线 → `DingCardService` 短提示「请打开 StoClaw 扫码绑定」；**不**调用 `ChatEntrance`
- [ ] 单测/本地：mock 消息进 Listener，断言不进 ChatEntrance、有短回复
- [ ] Commit：`feat(sclaw): listener branch and device bind table`

---

## 任务 2（P0→P1）：Hub 扫码 Bind + Ticket

**仓库：** sto-wisdom-star

- [ ] `POST` 出码：生成 `bindToken`，Redis pending，返回二维码内容（URL 含 bindToken）
- [ ] H5：钉钉内免登拿 userid，确认后 Redis `confirmed`，可领一次性 `ticket`
- [ ] 桌面轮询/领取 ticket → 换 `refreshToken`，UPSERT `sclaw_device_bind`（后绑覆盖）
- [ ] 解绑 API：`status=revoked` 或删行
- [ ] 单测：出码→确认→领 ticket→覆盖绑定
- [ ] Commit：`feat(sclaw): bind token h5 and ticket`

---

## 任务 3（P1）：Hub WS 网关 + 按用户队列

**仓库：** sto-wisdom-star

- [ ] WS：ticket 首连 / `refreshToken` 重连鉴权；登记 `device_id` 在线
- [ ] `SclawUserQueue`：同 `dingTalkUserId`（或 peer 维度按规格：同 peer 排队）串行投递
- [ ] 入站路径：绑定且在线 → 入队 → WS push `inbound`（含 `peerId=conversationId`、`channelTraceId`）
- [ ] 回程入口（可先 stub）：收 `delta`/`done` → `streamUpdate`
- [ ] Commit：`feat(sclaw): ws gateway and per-user queue`

---

## 任务 4（P1）：Desktop 本机表 + HubClient 骨架

**仓库：** sto-claw

- [ ] migration `0002-channel-plane.ts`：`channel_connections`（`UNIQUE(channel_type, account_id)`，`account_id=default`）
- [ ] `hub-client.ts`：连 Hub、ticket/`refreshToken`、心跳、收 `inbound`（先 log）
- [ ] Host API：出码、轮询状态、解绑、连接状态（对照旧 Channels，先列清单再实现）
- [ ] main 启动：登录态就绪后尝试 `refreshToken` 重连
- [ ] Commit：`feat(channels): channel_connections and hub client skeleton`

---

## 任务 5（P1）：Desktop 扫码 UI

**仓库：** sto-claw

- [x] Channels 钉钉区：扫码绑定 / 已绑定展示 / 解绑；**移除**用户填 Stream AK/SK
- [ ] 联调任务 2+3：扫码 → WS 在线 → Hub 侧可见
- [ ] Commit：`feat(channels): dingtalk hub bind ui`

---

## 任务 6（P2）：SessionFacade + 入站执行

**仓库：** sto-claw

- [x] `binding-service`：默认 Claude + main；可改 OpenClaw；后绑覆盖只改身份/凭证、选脑不变
- [x] `session-key` + `session-facade`：走 `getAdapter` 页面对话链（禁止 OC 钉钉插件入站）
- [x] `ingress`：Hub `inbound` → Facade；`delivery`：产出 → Hub
- [x] 同 peer 排队（本机侧与 Hub 队列二选一为主、另一侧防重；规格以 Hub 排队为准时本机串行消费即可）
- [x] 先打通 **终态一次回** 或粗粒度多帧（仅用于联通；P3 再真正流式）
- [ ] Commit：`feat(channels): session facade ingress path`

---

## 任务 7（P2）：E2E 一轮对话

- [ ] 钉钉私聊 sclaw 机器人 → Hub 路由 → 桌面执行 → 钉钉可见回复
- [ ] 未绑定 / 离线提示回归
- [ ] 日志带 `channelTraceId`
- [ ] Commit（两端）：`feat(sclaw): e2e one-shot reply`

---

## 任务 8（P3）：必须流式回钉钉

- [ ] 桌面：页面对话链增量 → Hub `delta`；结束 → `done`
- [ ] Hub：对齐 `DingCardService.streamUpdate(..., false/true)`
- [ ] 禁止仅终态一次回作为正式路径
- [ ] 验收：钉钉卡片可见中间态
- [ ] Commit：`feat(sclaw): streaming reply via ding card`

---

## 任务 9（P3）：API 分流与回归

- [ ] 钉钉平台通道不写 `openclaw.json` channels.dingtalk、不 `ensureDingTalkPluginInstalled`
- [ ] dws 代发、未迁移 Gateway 频道无回归
- [ ] Binding UI：先引擎后 Agent
- [ ] 对照规格 §10 逐条勾选
- [ ] Commit：`chore(channels): api split and v1 acceptance`

---

## 任务 10（P4）：机器人创建与配置

- [ ] 创建 StoClaw 个人助理钉钉机器人
- [ ] 填实 `robotCode`（智慧星配置 + 规格文档同步）
- [ ] 预发/生产开关与回调校验

---

## 明确不做（本计划外）

- 微信 Transport、企业 App 完整产品
- 统一 Conversation 仓库、侧栏来源标签
- 本机自持 AK/SK、better-sqlite3 / 独立 channel-plane.db
- 频道使用统计流水（可选后期，Hub 事件表）

---

## 建议排期（粗估）

| 阶段 | 粗估 |
|------|------|
| P0 | 1～2 天 |
| P1 | 3～5 天（含协议联调） |
| P2 | 3～5 天 |
| P3 | 2～3 天 |
| P4 | 依赖机器人申请，可与 P1～P2 并行推进申请 |

---

## 下一步（人）

1. 规格改为「已评审」  
2. 按任务 0 对齐 WS/HTTP 草案  
3. Hub 开任务 1；Desktop 开任务 4 脚手架（可并行）  
