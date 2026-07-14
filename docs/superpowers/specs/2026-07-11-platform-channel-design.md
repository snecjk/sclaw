# 平台 Channel Plane 设计（钉钉样板 + 临时会话桥接）

> 状态：待评审（Hub=`sto-wisdom-star`；扫码=**自建码+H5免登**；WS 时序 B；流式回钉钉；本机单表）
> 日期：2026-07-11  
> 文档：`sto-claw/docs/superpowers/specs/2026-07-11-platform-channel-design.md`  
> 相关：双引擎 / Conversation 平台（同事负责，尚未开工）；现有 Claude/OpenClaw 页面对话链；本地 SQLite（`electron/db/`）

---

## 0. 一句话

为 **新频道**增加 **StoClaw 平台 Channel Plane**。钉钉 V1 形态：**组织共用一个钉钉机器人**（一套 AK/SK），由 **Channel Hub** 收 Stream，再按 **钉钉用户 → 在线本地 StoClaw** 路由；本机仍经 **SessionFacade 双引擎**接页面对话链执行并回程。  
**诚实边界：** 未迁移频道仍寄生 Gateway；本方案引入 Hub/路由，**不是**「每台电脑各自填 AK/SK 连 Stream」。

---

## 1. 背景与问题

### 1.1 现状

| 能力 | 今天归属 | 问题 |
|------|----------|------|
| 频道账号 / 凭证 | 多在 `openclaw.json` + OC 插件；UI 常 `gateway.rpc('channels.*')` | 频道管理寄生 Gateway；平台频道须独立存储 |
| 入站路由 | OC 插件 → Gateway → `event-dispatch` → 再进 adapter | Claude 难做一等入站 |
| 会话 | OC Gateway sessions + Claude `engine-sessions.json` 分叉 | 无统一 Conversation |
| 钉钉 | dws 代发为主；OC 钉钉插件未作平台通道 | 无法「统一机器人 → 按用户落到本人 StoClaw → 任选引擎」 |
| 绑定 | OC `openclaw.json` → `bindings[]` | 与 Gateway 路由耦合；不适合作平台 Binding |

现有主链路（未迁移频道）大致是：

```text
IM 入站 → OpenClaw Gateway（插件）→ WS → event-dispatch
  → GatewayManager → openclaw-adapter /（桌面侧再选）claude-adapter
```

### 1.2 「解耦引擎」在本方案里的真实含义

**不是**声称当前架构已与 Gateway 无关，也 **不是** V1 把所有频道搬离 Gateway。

| 说法 | 本方案实际指 |
|------|----------------|
| 解耦 | **新通道的入站/出站协议**不强制经 OC channel plugin + OC `bindings` 才能进 Claude |
| 仍耦合 | 桌面 Chat、未迁移频道、大量 `channels.*` RPC **仍深度绑定 Gateway** |
| V1 形态 | **统一钉钉机器人** → Channel Hub（Stream）→ **按用户路由** → 本地 StoClaw SessionFacade → `getAdapter` → 页面对话链 |

若把「解耦」理解成「全站消息只剩一条与 Gateway 无关的总线」，则当前目标 **做不到**，本文也不承诺。

### 1.3 目标

1. **钉钉统一机器人 + 用户路由**：一套 AK/SK 在 Hub；按钉钉用户落到对应在线 StoClaw。  
2. **本机执行仍走页面对话链**：SessionFacade 双引擎（默认 Claude，可选 OpenClaw）；不用 OC 频道插件入站/选脑。  
3. **绑定语义清晰**（本机）：Engine = Claude / OpenClaw；Agent = 引擎实例；先选引擎再选 Agent。  
4. **与未来统一会话兼容**：Facade 临时桥接现有桌面链，同事 Conversation 就绪后只换 Facade。  
5. **V1 可验收**：用户钉钉私聊/群内 @ 统一机器人 → 路由到本人在线 StoClaw → 回复回钉钉；侧栏普通对话。

### 1.4 非目标（本阶段不做）

- 统一 Conversation / SessionIndex 仓库（同事另做）  
- 把 WhatsApp/Telegram 等从 Gateway 迁到 Channel Plane  
- 重写 Channels Store 使其完全脱离 Gateway RPC（未迁移频道）  
- 频道会话空闲超时自动结束  
- 每台 StoClaw 各自配置钉钉 AK/SK 并本机直连 Stream（**已否决**；改为 Hub 统一持证）  
- 安装/依赖 OpenClaw 钉钉频道插件作为运行时入站  
- V1 实现微信 Transport  
- 侧栏来源标签 / 独立「频道会话」视图  
- 企业移动 App 完整产品（可与钉钉 Hub **复用路由思想**，但 App 本身仍见 §7.1）

---

## 2. 概念模型

```text
【组织侧 · 一套】
DingTalk Robot（统一 AK/SK）
  └─ Channel Hub
        ├─ DingTalkTransport（唯一点连 Stream）
        ├─ UserRoute（dingTalkUserId → stoUserId → device WS）
        └─ Delivery 回钉钉

【用户侧 · 多台】
StoClaw Desktop（在线注册）
  ├─ HubClient（WebSocket）
  ├─ 本机 Binding → Agent（隐含 Engine）
  └─ SessionFacade → 页面对话链 → 回程给 Hub
```

| 概念 | 含义 |
|------|------|
| **Engine** | `claude` \| `openclaw` |
| **Agent** | 某引擎下的本机实例（人格 / workspace） |
| **统一机器人** | 组织/产品级 **一套** 钉钉应用凭证；**不**每台桌面各配一套 Stream |
| **Channel Hub** | 持证、连 Stream、按用户路由、回程发钉钉的中继（部署形态见 §6.1，可挂 memory-center 或独立服务） |
| **UserRoute** | `dingTalkUserId`（如 `senderStaffId`）→ `stoUserId` → 当前在线 `deviceId` 的 WS 连接 |
| **peerId** | 钉钉侧聊天窗口 ID（**已定**：`conversationId` / 等价 `openConversationId`）；到本机后用于续聊，**不是**路由键 |
| **Binding** | **本机** `ChannelAccount/默认钉钉入口 → agentId`（引擎由 Agent 决定） |
| **SessionFacade** | 本机唯一会话入口；双引擎分发到页面对话链 |

> **路由键 vs 续聊键：** 路由用 **钉钉用户**（落到哪台 StoClaw）；续聊用 **peerId/会话窗口**（在该 StoClaw 上复用哪个 sessionKey）。二者不要混用。

---

## 3. 架构

### 3.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│  Channel Hub（组织侧 · 统一机器人）                            │
│  DingTalkTransport（Stream）· UserRoute · Delivery→钉钉       │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket 按用户路由
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  StoClaw Desktop Channel Plane（用户侧）                       │
│  HubClient · 本机 Binding · Ingress · Delivery→Hub            │
│  channel-store（本机 SQLite：Binding / 路由登记缓存）            │
└────────────────────────────┬────────────────────────────────┘
                             │ SessionFacade
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Session 桥接 / 未来 Conversation                              │
│  getAdapter → claude-adapter | openclaw-adapter（页面对话同链） │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Transport 与 HubClient

| 组件 | 运行位置 | V1 |
|------|----------|-----|
| `DingTalkTransport` | **仅 Hub**：`dingtalk-stream` + 统一凭证 | **做** |
| `HubClient` | **每台 StoClaw**：WS 注册 / 收路由消息 / 回程 | **做** |
| `WeChatTransport` | 预留 | 不做 |
| `MobileTransport` | 预留（§7.1） | 不做 |

本机 Ingress 消费的是 Hub 转发后的 `InboundMessage`（已带 `channelTraceId`、`peerId`、`dingTalkUserId`、`replyHandle`），**不**在桌面进程直连钉钉 Stream。

### 3.3 与 OpenClaw 频道插件的关系

- 平台钉钉入站 **永不**经 OC dingtalk channel plugin。  
- 未迁移频道（WhatsApp/Telegram/…）仍走 Gateway。  
- dws / send-guard 继续服务 **App 内 @ 代发**，与统一机器人入站分离。  
- 绑 OpenClaw Agent：本机仍走 **页面对话** `openclaw-adapter`，不经 OC 频道插件。

### 3.4 V1 路径

```text
【路径 A · 未迁移频道】
  WhatsApp/Telegram/… → Gateway 插件 → …

【路径 B · 平台钉钉（统一机器人 + 用户路由）】
  钉钉 Stream → Hub.DingTalkTransport
    → UserRoute(dingTalkUserId → 在线 StoClaw)
    → WS → 本机 Ingress → SessionFacade → getAdapter → 页面对话链
    → 回程 WS → Hub.Delivery → sessionWebhook / OpenAPI

【路径 C · 桌面 Chat】
  Renderer → 现有 send 链 → claude-adapter / openclaw-adapter
```

**排障：** `channelTraceId` 贯穿 Hub → WS → Facade → runId；日志前缀 `[channel:dingtalk:hub]` / `[channel:dingtalk:desktop]` / `[gateway:channel]`。  
**互斥：** 统一机器人启用后，不得再对该应用启用 OC 钉钉插件入站。

### 3.5 SessionFacade 与 `engine-sessions.json` 互斥（硬约束）

当前 `session-registry.ts` 用进程内 `registryMutationQueue` 串行化读写 `engine-sessions.json`。

| 规则 | 说明 |
|------|------|
| **MUST** | SessionFacade **只**调用已有导出：`get/upsert/delete/listEngineSessionRegistryEntry(ies)`、`rememberSessionEngineType`，以及 `engines/manager` 的 `resolveAgentEngineType` / `getAdapter`（再调对应 adapter 的 `sendMessage`） |
| **MUST NOT** | 自行 `readFile`/`writeFile` `engine-sessions.json`，或另起一套 registry 队列；**禁止**在 Facade 内写死只调 `claude-adapter` |
| **MUST** | 与桌面 Chat 同进程、同模块实例，保证共用同一 `registryMutationQueue` |
| **SHOULD** | Facade 的 send 复用 `adapter.sendMessage`（与路径 C 同入口），避免旁路漏写 registry |

否则会出现登记丢失、列表闪烁、resume 错 `sessionId` 等竞争问题——这是实现门禁，不是可选优化。

---

## 4. 绑定

### 4.1 UI

1. 先选 **引擎**（Claude / OpenClaw）  
2. 再选该引擎下的 **Agent**  
3. 若该引擎下 **仅 1 个 Agent → 默认选中**

### 4.2 默认值（频道账号首次绑定）

- 引擎：**Claude**  
- Agent：**main**（若不存在则提示创建或选同引擎下第一个）

### 4.3 存储

- **本机 Binding**（选哪个 Agent）落在本机 `stoclaw.sqlite`，**不**写 `openclaw.json` bindings。  
- **统一机器人 AK/SK** 只存在 **Hub**（运维/管理端配置），**不**要求每个终端用户在 Channels 表单填 clientSecret。  
- 本机可缓存：Hub 连接状态、已绑定的 `dingTalkUserId`、默认 Binding。  
- **命名注意：** 钉钉开放平台应用 `agentId` ≠ StoClaw Binding `agent_id`。

### 4.4 改绑定

采用策略 **C**：

- 立即结束该 peer 上「当前复用的会话」语义（临时实现：换新 `sessionKey` / 停止续用旧 key）。  
- 下一条入站消息按新 Binding 创建新会话。  
- 历史仍可通过旧 sessionKey 在侧栏查看（若仍登记在 `engine-sessions.json`）。

---

## 5. 会话（临时桥接）

### 5.1 原则

- **按平台 Channel 设计**；会话创建走 **SessionFacade**。  
- 统一 Conversation 未就绪前，Facade **双引擎分发**：与 **页面对话同一套入口**——`sessionKey` → registry → `resolveAgentEngineType` / `getAdapter` → `claude-adapter` | `openclaw-adapter`。  
- 绑 OpenClaw **不是**走 OC 钉钉/频道插件入站，而是复用路径 C 的 `openclaw-adapter.sendMessage`（与用户在侧栏点进该会话发消息同链）。  
- 侧栏 **按普通对话展示，不打来源标**；后期统一会话再补 `source`。

### 5.2 SessionFacade（迁移锚点）

```ts
interface SessionFacade {
  /** 同 channel+account+peer 复用；无则创建；登记 engineType */
  createOrGet(params: {
    agentId: string;
    channelType: string;
    accountId: string;
    peerId: string;
  }): Promise<{ sessionKey: string; engineType: 'claude' | 'openclaw' }>;

  send(sessionKey: string, text: string, extras?: unknown): Promise<{ runId?: string }>;
  // abort / 可选 getHistory 按需
}
```

**V1 分发规则（已定：Facade 双引擎）：**

| 步骤 | 行为 |
|------|------|
| 1 | Binding 给出 StoClaw `agent_id`（可冗余校验 `engine_type`） |
| 2 | `createOrGet`：用 `resolveAgentEngineType(agentId)` 得引擎；`rememberSessionEngineType(sessionKey, engineType)`；upsert registry |
| 3 | `send`：`getAdapter(engineType)` 或 `getAdapterForSession(sessionKey)` → `adapter.sendMessage(...)`（与页面对话同入口） |
| 4 | 改 Binding（策略 C）后新 `sessionKey`，按新 Agent 重新解析引擎 |

- **现在**：内部生成/复用稳定 `sessionKey`，经 `engines/manager` 调对应 adapter（**禁止** Facade 写死只走 Claude；**禁止**为 OpenClaw 另开 OC channel plugin 入站）。  
- **以后**：改为 `ConversationService`；Ingress 不改或极少改。  
- **默认**：账号首次绑定仍为 Claude + main；用户可改为 OpenClaw Agent，入站仍经 Facade → `openclaw-adapter`（页面对话链），不经 OC 频道插件。

### 5.3 sessionKey 与 peerId（临时）

```text
agent:{agentId}:dingtalk:{peerId}
```

- **`peerId`（已定）**：钉钉使用 **`conversationId`**（若回调仅有 `openConversationId`，取其作为同一语义的稳定会话窗 ID）。  
- **路由不用 peerId**：Hub 用 `dingTalkUserId`（如 `senderStaffId`）选 StoClaw；peerId 只在本机续聊。  
- 群聊：同一群同一 `peerId` → 群成员若路由到**不同**人的 StoClaw，会在各自机器上各有一份同 peer 会话——V1 **接受**（群 @ 机器人时，以「被路由到的那台」为准回复；详见 §6.5）。  
- 同 peer 长期复用；**改选脑（策略 C）** 后新 key；**换钉钉扫码绑定**只改身份/凭证，**选脑不变**（§6.4）。

### 5.4 生命周期（V1）

| 场景 | 行为 |
|------|------|
| 同账号同 peer 再来消息 | 复用 sessionKey，续聊 |
| 用户桌面侧栏点进该会话 | 与普通同引擎会话相同（Claude / OpenClaw） |
| 改 Binding | 旧会话不再接收该 peer 入站；新消息新会话 |
| 空闲超时 | **不做** |

---

## 6. 钉钉 V1：统一机器人 + 用户路由

> **架构变更（相对初稿）：** 否决「每台 StoClaw 自持 AK/SK 本机连 Stream」。改为组织 **一套机器人**，Hub 收消息并 **按钉钉用户路由到本人在线 StoClaw**。

### 6.1 技术选型

| 项 | 选择 |
|----|------|
| 钉钉协议 | 开放平台 **Stream**（官方 `dingtalk-stream`） |
| Stream 连接点 | **仅 Channel Hub**（单点持证；避免多桌面抢同一 AK/SK） |
| 桌面连通 | StoClaw ↔ Hub **WebSocket**（注册、收消息、回程） |
| 统一凭证 | Hub 侧配置一套 `clientId` / `clientSecret`（及发消息所需 `robotCode` 等）；字段语义可对齐 `CHANNEL_META`，但是 **运维/管理配置**，不是每用户 Channels 表单必填 |
| 回复 | Hub 优先用入站 `sessionWebhook`；失败/过期再 OpenAPI 兜底 |
| Hub 部署 | **已定**：`sto-wisdom-star`（`wisdom-star-conversation`）；在现有钉钉监听中分支到 StoClaw WS（见 §6.8） |

### 6.2 端到端流程

```text
【运维一次】开通钉钉机器人 → Java Hub 写入统一 AK/SK → Hub 启动钉钉对接/Stream

【用户首次绑定 · WS 时序方案 B + 扫码身份：自建码/H5 免登（已定）】
  StoClaw 展示**自建**二维码（内容 = Hub 绑定页 URL + bindToken；此时尚未建业务 WS）
    → 手机钉钉「扫一扫」打开绑定页（须在钉钉内 / 已配置的 H5 微应用域名）
    → 页内 `requestAuthCode` 免登 → 服务端换 **userid**（= 后续匹配 `senderStaffId`）
    → 用户确认绑定
    → Hub 签发短期 ticket
    → 桌面拿到 ticket 后 → 建立 WebSocket 并鉴权
    → 绑定生效，UI 显示已绑定/在线

【日常在线】
  StoClaw 启动（已绑定）→ 用已存凭证/刷新票连 Hub WS → 收路由消息

【消息】
  用户钉钉私聊/群 @ 统一机器人
    → Hub 收钉钉入站
    → 解析 dingTalkUserId + peerId(conversationId) + replyHandle
    → UserRoute：dingTalkUserId → 在线 device WS
    → 推送到该 StoClaw
    → 本机 Ingress → Binding → SessionFacade → 页面对话链
    → 流式增量回 Hub → Delivery 流式回钉钉
```

### 6.2.1 扫码绑定与 WS（已定）

> **两层「B」勿混淆：**  
> 1）**WS 时序方案 B**：确认后桌面才拿 ticket 建 WebSocket。  
> 2）**扫码取身份方案 B（本条）**：**自建二维码 + 钉钉内 H5 免登**拿 `userid`（**不**用钉钉官方登录内嵌码 / 扫码登录第三方网站）。

官方依据：[网页应用免登](https://open.dingtalk.com/document/orgapp/enterprise-internal-application-logon-free)、[requestAuthCode](https://developers.dingtalk.com/document/development/jsapi-request-auth-code)。

| 步骤 | 行为 |
|------|------|
| 1 | StoClaw → Hub 申请 `bindToken`；二维码内容为 `https://{hub}/bind?token={bindToken}`（**自建码**；**不出业务 WS**） |
| 2 | 用户钉钉扫一扫打开绑定页（钉钉容器内）→ `dd.requestAuthCode({ corpId, clientId })` 得免登 `code` |
| 3 | 服务端：免登码 + 应用 access_token → **userid**（与机器人入站 `senderStaffId` 对齐）；展示确认「绑定这台电脑」 |
| 4 | 确认后 Hub 签发 **ticket**；桌面轮询领票 → `HubClient.connect(ticket)` |
| 5 | WS 鉴权成功 → 本机存 `refreshToken`；userid 作为队列/路由匹配键 |

**否决：** 钉钉官方扫码登录内嵌码（对比文档中的方案 A）；出码前先建匿名 WS（WS 时序方案 A）。

**前置配置（sto-wisdom-star / 钉钉开放平台）：** 企业内部应用已开通网页应用；绑定页域名在 JSAPI/安全域名白名单；具备 `corpId`、Client ID/Secret。

#### 绑定用什么（凭证与标识）

| 名称 | 谁生成 | 用途 | 建议寿命 |
|------|--------|------|----------|
| `deviceId` | StoClaw 本机（UUID，持久化） | 标识哪台电脑 | 长期，解绑/重装可换 |
| `bindToken` | Hub | 二维码与绑定会话 ID | 2～5 min，一次性 |
| `dingTalkUserId` | 钉钉 H5 免登换得的 **userid** | 路由/队列键，对齐 `senderStaffId` | 长期身份 |

| `ticket` | Hub（确认后） | **仅用于首次**建立 WS 鉴权 | 1～5 min，一次性 |
| `refreshToken`（或 session 凭证） | Hub（WS 鉴权成功后下发） | 日常重连 WS，不必再扫码 | 较长，可刷新/吊销 |
| Hub 映射行 | Hub DB | `dingTalkUserId ↔ deviceId`（+ 可选 stoUserId） | 直至解绑/换机覆盖 |

**不用：** 机器人 AK/SK 当客户端绑定凭证；用户手填 clientSecret。

#### 协议草案（V1）

> 路径前缀示意 `/api/channel-hub`；实现时可按现有 Java 应用规范调整。一律 **HTTPS / WSS**。

**1）桌面申请绑定会话（出码）**

```http
POST /api/channel-hub/bind/session
Content-Type: application/json

{
  "deviceId": "uuid-of-this-stoclaw",
  "deviceName": "文彭的 MacBook",          // 可选，确认页展示
  "clientVersion": "x.y.z"             // 可选
}
```

```json
{
  "bindToken": "bt_xxx",
  "expiresInSec": 180,
  "qrUrl": "https://hub.example.com/bind?token=bt_xxx",
  "pollIntervalMs": 1500
}
```

- 二维码内容 = `qrUrl`（用户钉钉扫一扫打开）。  
- Hub 创建状态为 `pending` 的绑定会话，关联 `deviceId`。

**2）用户确认（钉钉内 H5 绑定页 · 扫码身份方案 B）**

```text
GET /bind?token={bindToken}
  → 钉钉容器打开（自建码扫入）
  → dd.requestAuthCode → 后端用免登码换 userid
  → 用户点击「确认绑定这台电脑」
POST /api/channel-hub/bind/confirm
  { "bindToken", /* userid 已由服务端免登会话持有，可不回传明文 */ }
  → Hub：写映射 userid ↔ deviceId；状态 → confirmed；签发 ticket
```

**3）桌面轮询绑定结果（方案 B：此时才拿 ticket）**

```http
GET /api/channel-hub/bind/session/{bindToken}
```

```json
// pending
{ "status": "pending", "expiresInSec": 120 }

// expired / cancelled
{ "status": "expired" }

// confirmed — 桌面领票后应立即连 WS，并停止展示该码
{
  "status": "confirmed",
  "ticket": "tk_xxx",
  "ticketExpiresInSec": 120,
  "dingTalkUserId": "manager123",
  "dingTalkName": "张三"              // 可选，UI 展示
}
```

- `ticket` **只返回一次**（或短窗内可重取）；桌面落盘前优先立刻用于 WS。  
- 轮询间隔用申请时返回的 `pollIntervalMs`；超时按 `expired` 刷新二维码。

**4）建立 WebSocket（确认后）**

```text
WSS /api/channel-hub/ws
```

首帧或 query 鉴权（二选一，实现定一种）：

```json
// 连接后首条 client → server
{ "type": "auth", "ticket": "tk_xxx", "deviceId": "uuid-of-this-stoclaw" }
```

或：`wss://.../ws?ticket=tk_xxx&deviceId=...`

成功：

```json
{
  "type": "auth.ok",
  "refreshToken": "rt_xxx",
  "dingTalkUserId": "manager123",
  "heartbeatIntervalMs": 25000
}
```

失败：`auth.fail` + 关闭连接；桌面提示重新扫码。

**5）日常重连（已绑定，不再扫码）**

```json
{ "type": "auth", "refreshToken": "rt_xxx", "deviceId": "uuid-of-this-stoclaw" }
```

- `refreshToken` 存本机 `channel_hub_link`（权限同用户数据目录）；泄露可 Hub 侧吊销。  
- 心跳：客户端按 `heartbeatIntervalMs` 发 `ping`；超时踢掉并标离线。

**6）解绑 / 换机**

```http
POST /api/channel-hub/bind/revoke
{ "deviceId", "refreshToken" }   // 或登录态
```

- 换机：新电脑走完整扫码 B；Hub 将同 `dingTalkUserId` 的路由切到新 `deviceId`（V1 可踢旧设备 WS）。

#### 本机落库（与协议对应）

绑定成功后 UPDATE/INSERT `channel_connections`：写入 `external_user_id`、`refresh_token`、`bind_status=bound`，并默认 `engine_type`/`agent_id`。  
**不存** 长期 `ticket` / `bindToken`。详见 §6.4（**单表**）。

#### WS 业务帧（绑定之后，路由消息）

```json
// Hub → Desktop：入站
{
  "type": "channel.inbound",
  "channelTraceId": "...",
  "channelType": "dingtalk",
  "dingTalkUserId": "manager123",
  "peerId": "cid_xxx",
  "text": "你好",
  "replyHandle": { "sessionWebhook": "...", /* 或 OpenAPI 所需 */ }
}

// Desktop → Hub：出站（流式增量；禁止只等终态一次回）
{
  "type": "channel.outbound.delta",
  "channelTraceId": "...",
  "textDelta": "…",
  "done": false,
  "replyHandle": { /* 原样回传 */ }
}
// 结束帧
{
  "type": "channel.outbound.delta",
  "channelTraceId": "...",
  "textDelta": "",
  "done": true,
  "replyHandle": { /* 原样回传 */ }
}
```

### 6.3 用户路由规则（V1 默认）

| 规则 | 决策 |
|------|------|
| 路由键 | **`dingTalkUserId`**（优先 `senderStaffId` / 开放平台稳定用户 ID） |
| 映射 | `dingTalkUserId` ↔ 设备/用户；**首次经扫码确认（方案 B）** 建立 |
| 多设备在线 | 同一用户多台 StoClaw：**选最近心跳/最近活跃的一台**（V1）；换机再扫可抢路由 |
| 无在线设备 | Hub **直接**用 webhook/OpenAPI 回复短文案（如「请打开 StoClaw」）；不落本机会话 |
| 未绑定映射 | Hub 回复引导「请在 StoClaw 扫码绑定」；不路由 |
| 群聊 | 仍按 **发送者** `dingTalkUserId` 路由到发送者的 StoClaw；`peerId` 用群 `conversationId` 做本机续聊 |

### 6.4 本机 SQLite 表设计（多频道抽象 · 已定）

> **目标：** **一张表**；钉钉 / 微信 / 企业 App **每种频道本机只保留 1 条绑定**，**以后绑为准（覆盖先绑）**。  
> 库：现有 `stoclaw.sqlite`（`electron/db`）；**不含** transcript / `engine-sessions`。

#### 绑定基数（已定）

| 规则 | 说明 |
|------|------|
| **每频道只绑一个账号** | 产品规则：本机每种 `channel_type` 只保留当前绑定；`account_id` 恒为 `default` |
| **最后绑定为准** | 再次扫码/确认成功 → **UPSERT 同一行**（覆盖身份与凭证） |
| `account_id` | 固定 `default`（占位，不再用多 account 表达多账号） |
| 厂商侧账号 ID | 如微信 `ilink_bot_id` → `provider_account_id`（后绑覆盖为最新） |

> 现网 OC 微信插件仍可能多账号 json；**本 Channel Plane 产品规则**为单账号覆盖。迁入本表时只保留最后一次绑定。

#### 对照现网微信（字段映射）

```text
扫码 ilink → bot_token + ilink_bot_id + baseUrl + ilink_user_id?
  → UPSERT channel_connections WHERE channel_type='wechat'  （覆盖上一微信绑定）
```

| 现网字段 | 落入本表 |
|----------|----------|
| `ilink_bot_id` | `provider_account_id` |
| `bot_token` | `credential_token` |
| `baseUrl` | `endpoint_base_url` |
| `ilink_user_id` | `external_user_id`（可空） |
| 绑 `main` | `engine_type` + `agent_id` |

钉钉再扫换人：覆盖同行 `external_user_id` / `refresh_token` 等，仍只有一行 `channel_type=dingtalk`。

#### 表：`channel_connections`（仅此一张）

```sql
CREATE TABLE channel_connections (
  id                  TEXT PRIMARY KEY,
  channel_type        TEXT NOT NULL CHECK (
                        channel_type IN ('dingtalk', 'wechat', 'sto-mobile')
                      ),
  account_id          TEXT NOT NULL DEFAULT 'default',
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

  device_id           TEXT NOT NULL,
  external_user_id    TEXT,                 -- 用户身份（钉钉 userid 等）
  provider_account_id TEXT,                 -- 厂商账号（微信 ilink_bot_id 等）

  bind_status         TEXT NOT NULL DEFAULT 'unbound'
                        CHECK (bind_status IN ('unbound', 'bound', 'revoked')),
  bound_at            TEXT,
  last_online_at      TEXT,

  refresh_token       TEXT,                 -- Hub 方案 B；微信 NULL
  credential_token    TEXT,                 -- 微信 bot_token；钉钉 Hub NULL
  endpoint_base_url   TEXT,

  engine_type         TEXT CHECK (
                        engine_type IS NULL
                        OR engine_type IN ('claude', 'openclaw')
                      ),
  agent_id            TEXT,

  extras_json         TEXT CHECK (
                        extras_json IS NULL OR json_valid(extras_json)
                      ),

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,

  -- 约束保持 (channel_type, account_id)；产品上 account_id 恒为 default，后绑 UPSERT 该行
  UNIQUE (channel_type, account_id)
);

CREATE INDEX idx_channel_connections_external
  ON channel_connections (channel_type, external_user_id);
```

**后绑覆盖（已定）：只改绑定，选脑不变**

| 字段 | 再次扫码/确认成功时 |
|------|---------------------|
| 身份 / 凭证 / provider / endpoint / bind 状态 / bound_at / refresh_token | **覆盖** |
| `engine_type` / `agent_id` | **不变**；仅当旧行为空时补默认 `claude`+`main` |
| `device_id` | 保留本机值 |

#### 三端怎么填（均为单行）

| channel_type | external_user_id | provider_account_id | refresh_token | credential_token |
|--------------|------------------|---------------------|---------------|------------------|
| `dingtalk` | 钉钉 userid | NULL | 有 | NULL |
| `wechat` | `ilink_user_id?` | `ilink_bot_id` | NULL | bot_token |
| `sto-mobile` | App userId | 按需 | 有（若同 Hub） | 按需 |

#### 本机 vs Hub

| 数据 | 位置 |
|------|------|
| 钉钉统一机器人、权威路由（一人可多**设备**） | Hub |
| 本机每频道当前唯一绑定 | `channel_connections` 单行覆盖 |
| transcript / engine-sessions | 现有链 |

- 钉钉行 **MUST NOT** 存 Stream AK/SK。  
- migration：`0002-channel-plane.ts` 建本表。

### 6.5 投递与并发（V1 · 已定）

| 项 | 决策 |
|----|------|
| **何时回钉钉** | **必须流式输出**——本机页面对话链产生增量即经 Hub 推到钉钉；**禁止**等整轮 run 终态再一次性回（体感差） |
| **同 peer 并发** | **排队**——上一条未完成则入队，不并行、不打断 |
| webhook / 流式能力 | 优先 `sessionWebhook` 流式/多次更新；能力不足时用 OpenAPI 可达到的流式或分片补齐；失败打日志，侧栏仍有完整对话 |
| `peerId`（钉钉） | **`conversationId`**（见 §5.3） |

### 6.6 与 dws 的边界

| 能力 | 归属 |
|------|------|
| 用户找 **统一机器人** 对话 | Hub + 用户路由 + 本机 Facade |
| 桌面输入框 @ 人代发 | 现有 dws + send-guard（不变） |

### 6.7 桌面 UI 变化（相对旧 Channels 钉钉表单）

| 旧设想 | 新设想 |
|--------|--------|
| 每人填 clientId/Secret 启 Stream | **取消** |
| — | **扫码绑定**：自建码 → 钉钉内 H5 免登拿 userid → 确认 → ticket → 连 WS |
| — | 已绑定：展示连接状态、解绑/换机再扫、本机 Agent 绑定（先引擎后 Agent） |
| `CHANNEL_META` 凭证字段 | 仅 **Hub/Java 运维配置** 复用语义；终端用户不做该表单 |
---

### 6.8 Hub 落点（已定：sto-wisdom-star）

> **项目：** `/Users/wenpeng/IdeaProjects/shentongneiwai/sto-wisdom-star`  
> **模块：** `wisdom-star-conversation`  
> **钉钉入站已有节点：** `cn.sto.wisdomstar.conversation.ding.listener.RobotMsgCallbackListener`

#### 现状能力（可复用）

| 能力 | 现有位置 |
|------|----------|
| 钉钉消息监听 | `RobotMsgCallbackListener.execute` |
| 去重 | Redis `dinguser:{createAt}` |
| 发卡片 / **流式中间态** | `DingCardService.sendRobotCard` / `streamUpdate` / `updateCard` |
| 走智慧星问答 | `sendChatMsg` → `ChatEntrance.process` |

与本方案「**必须流式回钉钉**」一致：StoClaw 回程增量应对齐现有 `streamUpdate(..., false)`，结束帧对齐 `streamUpdate(..., true)`。

#### 分支节点（实现插入点）

在 `execute` 内、进入 `sendChatMsg` / `ChatEntrance` **之前**（建议：解析 `DingTalkMessage`、去重之后，发首张卡片之时或之前）增加判断：

```text
RobotMsgCallbackListener.execute
  → parse + 去重
  → 判断：当前机器人是否为「StoClaw 个人助理」（sclaw）
       ├─ 否 → 现有链路：发卡片 + sendChatMsg → ChatEntrance（智慧星）
       └─ 是 → StoClaw 分支（本方案 Hub）：
              1. 用 senderStaffId（dingTalkUserId）做用户账号匹配
              2. 查在线设备 / WS 会话（扫码绑定方案 B 登记的 refresh/device）
              3. 未绑定/离线 → 钉钉短提示（引导 StoClaw 扫码）
              4. 已在线 → 投递到对应用户队列（再经 WS 推 StoClaw）
              5. StoClaw Facade 流式产出 → Hub 收 delta → DingCardService.streamUpdate 回钉钉
```

**「是 sclaw 个人助理」的判定：** 使用 **`robotCode`** 匹配（与智慧星 `RobotDingtalkConfigVo` / 现有多机器人配置一致）。

> **`robotCode` 具体取值：待创建 StoClaw 个人助理机器人后补上**（配置/常量占位，勿先写死无意义字符串）。创建时同步更新本节与实现配置。

#### Hub 在本项目中的职责切分

| 职责 | 落点 |
|------|------|
| 钉钉监听、卡片流式发送 | 已有 `RobotMsgCallbackListener` + `DingCardService` |
| 用户匹配（dingTalkUserId → 设备/队列） | **新增**（同模块或 domain 服务） |
| StoClaw WS 接入、扫码 bind/ticket | **新增**（`wisdom-star-conversation` 或 web 暴露；与桌面协议 §6.2.1） |
| 按用户队列投递入站 | **新增**（队列名/分区按 `dingTalkUserId` 或 `deviceId`） |
| 本机执行 / 选脑 | **StoClaw** SessionFacade（不进 ChatEntrance） |

#### 与智慧星主链路的关系

- sclaw 分支 **不走** `ChatEntrance`（避免与智慧星机器人逻辑混跑）。  
- 非 sclaw 机器人行为 **不变**。  
- 同一套钉钉应用/多机器人配置下，仅标记为个人助理的 `robotCode` 进入 WS 分支。

### 6.9 Hub 存储（已定：一张表 + Redis 短态）

> **机器人配置：** 复用智慧星现有钉钉机器人配置（如 `RobotDingtalkConfigVo`），**不新建**机器人配置表。  
> **绑定/鉴权：** V1 **一张表**即可（userid↔设备 + refreshToken/吊销合在一行）。  
> **扫码中间态：** `bindToken` / 一次性 `ticket` 用 **Redis**（短 TTL），不建表。

#### 表：`sclaw_device_bind`（建议名，可按库规范微调）

```sql
CREATE TABLE sclaw_device_bind (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  ding_user_id    VARCHAR(64)  NOT NULL COMMENT '钉钉 userid，对齐 senderStaffId；路由键',
  device_id       VARCHAR(64)  NOT NULL COMMENT 'StoClaw 本机 deviceId',
  refresh_token   VARCHAR(128) NOT NULL COMMENT 'WS 重连入场券；解绑/换机时轮换或作废',
  status          VARCHAR(16)  NOT NULL DEFAULT 'bound'
                  COMMENT 'bound | revoked',
  bound_at        DATETIME     NOT NULL,
  updated_at      DATETIME     NOT NULL,
  UNIQUE KEY uk_ding_user (ding_user_id),
  UNIQUE KEY uk_refresh_token (refresh_token),
  KEY idx_device_id (device_id)
) COMMENT 'StoClaw 钉钉个人助理：用户-设备绑定与 WS 凭证（单表）';
```

**怎么用：**

| 场景 | 用法 |
|------|------|
| 入站路由 | `ding_user_id = senderStaffId` 且 `status=bound` → 得 `device_id` → 投递该用户队列/WS |
| WS 重连 | `refresh_token = ?` 且 `status=bound` → 鉴权通过 |
| 后绑覆盖 | 同一 `ding_user_id` **UPSERT**（换 `device_id` + 新 `refresh_token`）；旧设备失效 |
| 解绑 | `status=revoked` 或删行；本机清 `refresh_token` |

**不拆第二张凭证表的原因：** V1 一人一当前设备、后绑覆盖；拆表无收益。

#### Redis（不建表）

| Key 示意 | TTL | 用途 |
|----------|-----|------|
| `sclaw:bind:{bindToken}` | 2～5 min | 扫码会话 pending/confirmed + 可领 ticket |
| `sclaw:online:{device_id}` 或连接注册表 | 随心跳 | 是否在线（亦可进程内 WS 会话表） |

## 7. 后续频道（预留）

| 频道 | 备注 |
|------|------|
| 微信 | 可评估是否同样「统一号 + Hub 路由」或保持账号自持；V1 不做 |
| 企业移动 App | **可复用本钉钉 Hub 的设备注册 / WS 路由思想**；App 产品本身仍待定（§7.1） |

### 7.1 企业移动 App（后续）

钉钉 V1 **已经引入** Hub + 设备 WS 注册，移动端可复用同一套「`stoUserId` + device 在线表」。  
App UI、配对交互、推送策略仍 **TODO**，不阻塞钉钉 Hub 设计定稿；但实现钉钉时 **应** 把 Hub 协议写成可扩展（`channelType` / `deviceKind`），避免只硬编码桌面。

---

## 8. 目录与模块建议（实现时）

### 8.1 新增

```text
# Hub（sto-wisdom-star）：复用 Listener/DingCardService/机器人配置
# 新增：sclaw 分支、表 sclaw_device_bind、H5 免登扫码、WS、按用户队列

# StoClaw Desktop
electron/channels/
  hub-client.ts              # ★ WS 注册、收路由消息、回程
  binding-service.ts         # 本机 Agent 绑定；默认 Claude+main；策略 C
  session-facade.ts          # 双引擎；session-registry
  session-key.ts             # agent:{id}:dingtalk:{peerId}
  ingress.ts / delivery.ts   # 本机：Hub 消息 → Facade；结果 → Hub
  logging.ts
electron/db/migrations/0002-channel-plane.ts   # channel_connections（单表）
```

### 8.2 必改的现有模块

| 模块 | 改动要点 |
|------|----------|
| `electron/db/*` | Binding / hub_link migration；不改驱动 |
| `electron/main/*` | 启动后连 Hub（需登录态） |
| Channels UI | **改为**：Hub 状态 + 钉钉身份绑定 + 本机 Agent 绑定；**不再**让终端用户填 Stream AK/SK |
| `channels.ts` 路由 | 钉钉不再 `ensureDingTalkPluginInstalled` / 写 `openclaw.json` channels.dingtalk |
| Hub 管理配置 | 统一机器人凭证配置入口（可管理端或运维配置） |

### 8.3 API 分流（桌面）

| 能力 | 钉钉（平台） | 其它频道 |
|------|--------------|----------|
| Agent Binding | 本机 SQLite | OC bindings |
| 凭证 / Stream | **Hub**，桌面不持 Stream 密钥 | OC / 原逻辑 |
| 连接状态 | HubClient + Hub API | Gateway `channels.status` |
| `/api/channels/accounts` | 合并展示「钉钉统一机器人入口」状态，非每人一套账号密钥 | OC 账号列表 |

### 8.4 测试（要点）

- Hub：`user-route`（绑定/未绑定/离线/多设备）  
- Desktop：`hub-client` 收发、`session-facade` 双引擎、不写 openclaw 钉钉配置  
- 端到端（可 mock）：Stream 入站 → 路由 → Facade → 回程  

### 8.5 明确不做

- 每台桌面自持 AK/SK 直连 Stream  
- 本机双写 `openclaw.json` channels.dingtalk  
- `better-sqlite3` / `channel-plane.db`  
- 在 adapter 内写钉钉协议  
- OC 钉钉插件入站与统一机器人并行  

### 8.6 约束汇总

- Stream **只在 Hub**；桌面只经 HubClient。  
- 路由键 = `dingTalkUserId`；续聊键 = `peerId`（conversationId）。  
- 本机执行 **只**经 SessionFacade → `getAdapter`（页面对话同链）。  
- `channelTraceId` 端到端。  

---

## 9. 迁移路径（同事会话层就绪后）

1. Conversation 仓库上线（含 `source` / external peer）。  
2. 替换本机 `session-facade`；Hub 路由与 Transport **尽量不动**。  
3. 侧栏来源标签（V1 不做）。  

---

## 10. 验收（V1）

- [ ] 扫码：自建码 + H5 免登得 userid；确认后 ticket → 桌面建 WS；userid 可匹配 `senderStaffId` 入队  
- [ ] Hub 持统一机器人凭证，收钉钉消息并按 `dingTalkUserId` 路由  
- [ ] 未绑定 / 离线有明确钉钉侧提示  
- [ ] 本机经 SessionFacade 双引擎页面对话链执行；不经 OC 频道插件  
- [ ] 助手回复 **流式**经 Hub 回钉钉（非终态一次回）
- [ ] 本机 Binding：默认 Claude+main；可改 OpenClaw；改绑策略 C  
- [ ] 终端用户 **无需**自配 Stream AK/SK  
- [ ] 与 dws 代发、未迁移 Gateway 频道无回归  
- [ ] 日志带 `channelTraceId`  

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| Hub 成为单点 | 部署高可用 / 健康检查；离线提示清晰 |
| 用户映射错误 | 显式绑定 + 审计日志；禁止模糊猜路由 |
| 多设备抢消息 | V1 固定「最近活跃一台」 |
| 群聊路由到发送者本机，其他人不可见执行过程 | 接受 V1；文档说明 |
| Hub 与智慧星主链路误混 | sclaw 分支不进 `ChatEntrance`；非 sclaw 保持原逻辑 |
| 与「本机填 AK/SK」旧设想混淆 | §6 标明已否决 |

---

## 12. 已定决策摘要

| # | 决策 |
|---|------|
| 1 | 钉钉 = **统一机器人** + **Java Hub（含现有钉钉对接）** + **WS 中转** + **按钉钉用户路由** |
| 2 | 否决每台桌面自持 AK/SK 直连 Stream |
| 3 | 路由键 = `dingTalkUserId`；钉钉续聊 `peerId` = **`conversationId`**（或等价 `openConversationId`） |
| 4 | 本机执行 = SessionFacade **双引擎**页面对话链；不用 OC 频道插件 |
| 5 | 默认 Binding Claude + main；可绑 OpenClaw |
| 6 | **扫码取身份：自建码 + 钉钉内 H5 免登**拿 userid（对齐 `senderStaffId`）；**WS 时序方案 B**：确认后 ticket 再连 WS → `refreshToken` 重连 |
| 7 | 多设备：最近活跃一台；离线/未绑定由 Hub 短回复 |
| 8 | 本机 `channel_connections`：每频道只绑一个、**后绑覆盖**；**只改绑定（身份/凭证），选脑不变**；约束仍 `UNIQUE(channel_type, account_id)` |
| 9 | 复用 `electron/db`（`node:sqlite` + Kysely） |
| 10 | WhatsApp 等仍走 Gateway；dws 代发不变 |
| 11 | Hub **落点 `sto-wisdom-star`**：`RobotMsgCallbackListener` 用 **`robotCode`** 判断 sclaw（**取值待补**）→ 用户匹配 → 队列 → WS；回程 `DingCardService` 流式 |
| 12 | 统一会话仍由同事替换 Facade；Hub 尽量不动 |
| 13 | **同 peer 并发：排队** |
| 14 | **回复必须流式**经 Hub 回钉钉；禁止终态一次回 |
| 15 | Hub 持久化 **一张表** `sclaw_device_bind`（userid+device+refreshToken）；机器人配置复用现有；bindToken/ticket 用 Redis |

---

**已定可继续拆实现。** 建议顺序：`sto-wisdom-star`（Listener 分支 + 用户匹配 + 队列 + WS/扫码）→ StoClaw HubClient → SessionFacade 流式回程对接 `DingCardService` → UI。
