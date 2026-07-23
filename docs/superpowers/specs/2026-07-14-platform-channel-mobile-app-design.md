# 企业移动 App 入站通道设计（与钉钉共用 Hub）

> 状态：草案（待评审）· 已按产品反馈收窄  
> 日期：2026-07-14  
> 关联：[`2026-07-11-platform-channel-design.md`](./2026-07-11-platform-channel-design.md) §7.1；钉钉 V1 已定案（Hub=`sto-wisdom-star`，桌面 `HubClient` + `SessionFacade`）

---

## 0. 范围（已定）

| 项 | 定案 |
|----|------|
| **本方案范围** | 仅 **本地通道**：App 入站 → Hub → 桌面 StoClaw 执行 → 回程 App |
| **云端 Tab** | **本方案忽略**（另一条产品线，不在此设计内） |
| **绑定 UX** | App 切「本地」静默认领；**桌面**须先打开「App 绑定」开关（或已钉钉扫码）完成 **注册+连业务 WS**；登录 StoClaw 本身不登记、不连 WS |

---

## 1. 目标与结论

### 1.1 产品目标

- App 是**新入站源**，效果对齐钉钉：用户在 App 发消息 → 智多星 Hub → 在线 StoClaw → SessionFacade 双引擎 → 回程到 App。
- 切到 **本地 Tab** 时：
  - **未绑定过** → App 侧静默完成新绑定（同一登录身份关联桌面设备）；
  - **已绑定过** → 静默连上 Hub WS / 恢复路由，不弹出绑定向导。
- App ↔ 智多星 **走 WS**（入站+回程）；与钉钉 Stream 入站不同，但与桌面「Hub 下行 WS」同属 sclaw bus。

### 1.2 靠谱性结论

**靠谱。** 注册与业务 WS **绑定事件驱动**，不跟「登录 StoClaw」绑在一起，和现网钉钉时序一致。

| # | 约束 |
|---|------|
| 1 | 梧桐账号统一 |
| 2 | Hub→桌面执行链与钉钉相同，仅来源不同 |
| 3 | App WS ≠ 桌面执行 WS；桌面执行 WS **至多一条**（后绑覆盖） |
| 4 | 云端 Tab 另线 |

### 1.3 何时注册 + 连 Desktop 业务 WS（已定）

**登录 StoClaw：不注册、不连 WS。**

仅下列事件触发 **注册（deviceId + 梧桐身份）且连接业务 WS**：

| 触发 | 行为 |
|------|------|
| **钉钉扫码绑定成功** | 现网路径：claim → 注册/更新 device + 连 `/ws/sclaw` |
| **桌面打开「App 绑定」开关** | 与上对称：注册/更新 device + 连 `/ws/sclaw`（若已因钉钉连着则 **复用同一条**，只补 mobile 路由映射） |

```text
登录 StoClaw          → 无 Hub 设备动作
钉钉扫码成功          → 注册 + 连 Desktop WS（执行端）
桌面打开 App 绑定开关 → 注册 + 连 Desktop WS（已有则复用）
App 切本地 Tab        → 静默认领当前有效 device（后绑覆盖）；桌面未开开关/未在线则失败文案
```

冷启动：用户须 **先在桌面打开 App 绑定开关（或先完成钉钉绑定）**，再在手机 App 切本地；否则提示打开 StoClaw 并打开 App 绑定。

### 1.4 与钉钉会不会互相影响（已定隔离）

| 映射 | 用途 |
|------|------|
| `dingTalkUserId ↔ deviceId` | 钉钉 Stream 路由 |
| `stoUserId ↔ deviceId`（mobile） | App 本地路由 |
| Desktop `/ws/sclaw` | **同一条**执行连接，包内用 `channelType` 区分 |

- 解绑钉钉 ≠ 关掉 App 通道（除非同时关 App 开关 / 断 WS）。  
- 关掉 App 开关：清 mobile 映射；若仍有钉钉绑定则 **保持** Desktop WS；两者都无则断开 WS。  
- 禁止静默绑覆盖 `dingTalkUserId`。
---

## 2. 和钉钉比：共用与不同

```text
【钉钉】
  钉钉 IM ──Stream──► Hub.DingTalkTransport
                         │ UserRoute（dingTalkUserId → device）
                         ▼
                    Desktop HubClient WS ──► Ingress ──► SessionFacade
                         ▲
                         └── 回程 Delivery ──► 钉钉卡片

【App · 本地】
  App UI ──App↔Hub WS──► Hub.MobileTransport（入站）
                         │ UserRoute（stoUserId → device）  ← 静默绑定写入的映射
                         ▼
                    Desktop HubClient WS ──► Ingress ──► SessionFacade   ← 共用
                         ▲
                         └── 回程 ──► Hub ──App WS──► App 会话
```

### 2.1 共用（MUST）

| 能力 | 说明 |
|------|------|
| Hub / sclaw | `sto-wisdom-star`、设备在线表、Redis 推送 |
| 桌面 HubClient | `inbound`、心跳、`refreshToken` 重连 |
| Ingress → SessionFacade → Binding | 按 `channelType` 通用化后钉钉/App 共用 |
| 下行 envelope 骨架 | `inbound` + `peerId` + `text` + `replyHandle` + `channelTraceId` + **`channelType`（来源标记，建 session 透传）** |
| 账号体系 | **申通梧桐账号统一**；静默绑 / 路由用户键对齐该身份 |

### 2.2 不同（App 专用）

| 点 | 钉钉 | App（本地） |
|----|------|-------------|
| 入站 | Stream | **App↔Hub WS 上报** |
| 身份 | 钉钉扫码 H5 免登 | **App 已登录态**（静默） |
| 绑定触发 | 桌面出码 + 扫码确认 | **切本地 Tab → 静默 bind API** |
| 回程 | 钉钉卡片 | **App WS 气泡** |
| `channelType` | `dingtalk` | `mobile` |

---

## 3. 切「本地」与静默绑定

### 3.1 状态

| 概念 | 含义 |
|------|------|
| `desktopBind` | Hub：`stoUserId ↔ deviceId`（本地通道是否挂过桌面） |
| App↔Hub WS | App 入站/回程连接 |
| Desktop↔Hub WS | 执行端连接（与钉钉共用客户端） |

### 3.2 已定行为

**桌面侧**

```text
登录 StoClaw                    → 无注册、无 WS
打开「App 绑定」开关            → 注册 + 连 /ws/sclaw（已有钉钉 WS 则复用）
关闭「App 绑定」开关            → 清 mobile 映射；若无钉钉绑定则断 WS
钉钉扫码成功                    → 注册 + 连 /ws/sclaw（已有 App WS 则复用）
```

**App 侧**

```text
切到「本地」Tab
  ├─ 桌面已开 App 开关（或已钉钉）且 WS 在线
  │     → 静默 ensure / 认领 device（后绑覆盖）→ 可发消息
  └─ 否则
        → 拒收路径准备：提示「请打开 StoClaw 并打开 App 绑定」
```

> 已取消「登录即 HTTP 空登记」；注册与 WS 同生同灭于频道绑定事件。

### 3.3 前提

1. 梧桐账号统一。  
2. App 静默绑认领的是 **已因钉钉或 App 开关而上线的 device**。  
3. 多机：**后绑覆盖**。
---

## 4. 静默绑定协议（示意）

```http
POST /api/sclaw/mobile/bind/silent
Authorization: App用户凭证

{
  "clientVersion": "x.y.z"
}
```

成功：

```json
{
  "success": true,
  "deviceId": "uuid-of-stoclaw",
  "deviceName": "文彭的 MacBook",
  "desktopOnline": true
}
```

失败（无设备）：

```json
{
  "success": false,
  "errorCode": "NO_DESKTOP_DEVICE",
  "message": "未发现已登录的 StoClaw，请先打开桌面客户端"
}
```

已绑定用户再次切本地：可走同一接口做 **idempotent ensure**（有则返回现状 + 确保 App WS），或仅 `GET bind/status` + 连 WS。

换机：单独 `POST .../bind/replace` 或静默绑在多设备策略下覆盖（产品后续可暴露「更换电脑」）。

---

## 5. 消息主路径（本地）

### 5.1 App → Hub

```json
{
  "type": "mobile.inbound",
  "payload": {
    "channelType": "mobile",
    "peerId": "app-conversation-id",
    "text": "用户输入",
    "channelTraceId": "..."
  }
}
```

Hub：鉴权 → UserRoute(`stoUserId`) → 封装桌面 `inbound` → 推 Desktop。

### 5.2 Desktop（与钉钉同链，仅来源不同）

```text
HubClient 收 inbound(channelType=mobile | dingtalk, …)
  → Ingress.resolveBinding(channelType)   // 同一套，按来源读 Binding
  → SessionFacade.createOrGetSession({
        …,
        channelType / sessionSource: 来自 inbound   // ★ 先透传打标，统一 session 后再落库
     })
  → getAdapter → 上行 delta/done 回 Hub（按 channelType 出口）
```

钉钉与 App **共用此管道**；禁止为 mobile 再复制一套 Facade。

### 5.3 Hub → App

```json
{
  "type": "mobile.delta" | "mobile.done",
  "payload": {
    "peerId": "app-conversation-id",
    "content": "...",
    "channelTraceId": "..."
  }
}
```

---

## 6. 协议扩展

### 6.1 Desktop 下行（共用）

`inbound.payload` **必带** `channelType: "dingtalk" | "mobile"`。  
Ingress 改为 `resolveBinding(channelType)`，禁止写死钉钉。

### 6.2 App↔Hub WS（与 Desktop WS 分离）

| 方向 | type | 说明 |
|------|------|------|
| App→Hub | `mobile.inbound` | 用户消息 |
| App→Hub | ping / 鉴权 | 心跳 |
| Hub→App | `mobile.delta` / `mobile.done` | 流式回答 |
| Hub→App | `mobile.bind_status` | 绑定/桌面在线变更 |
| Hub→App | `mobile.error` | 未绑定、桌面离线等 |

`deviceKind`：`desktop`（执行端） vs `mobile_client`（入站 UI）。可同 path 分 audience，或分 path。

---

## 7. Desktop / Hub 改动清单

| 模块 | 改动 |
|------|------|
| `binding-service` | `channel_type='mobile'`；选脑对称钉钉 |
| `session-key` | `agent:{id}:mobile:{peerId}` |
| `session-facade` / `ingress` | 按 `channelType` 通用化 |
| `delivery` | 回 Hub 骨架共用；出口在 Hub 分钉钉/App |
| Hub | `MobileTransport`、App WS、**静默绑定 API**、UserRoute 复用 |

---

## 8. 已定补充 / 仍待拍板

### 8.1 已定（本轮）

| 项 | 定案 |
|----|------|
| **账号** | App / StoClaw / 智多星 **统一申通梧桐账号**；静默绑认领键即该用户身份（与 `stoUserId` 对齐） |
| **Hub→桌面执行链** | **与钉钉相同**（UserRoute → Desktop HubClient → Ingress → SessionFacade → 引擎 → 回程 Hub）；**唯一差异是来源**（`channelType` / source） |
| **Session 来源标记** | 创建 session 时把来源标记 **先传入**（建议：`channelType` 或 `sessionSource=dingtalk\|mobile`）；**先透传、暂不强依赖落库**。待「统一 Session」就绪后再持久化到 session 记录 |

实现注意：

- Desktop `createOrGetSession` / Facade 入参增加 `source`（或复用已有 `channelType`），沿调用链传到引擎会话创建处。  
- V1：**打标 + 链路可观测（日志/trace）即可**；不要阻塞在统一 session 表改造上。  
- 统一 session 落地后：按该标记回填存储字段，历史消息可按标记补迁或仅服务新会话。

### 8.2 仍待拍板 / 已定

| # | 项 | 状态 |
|---|----|------|
| 1 | **Desktop 离线（已绑定后）** | **已定 A：拒收 + 文案** |
| 2 | **多台 StoClaw** | **已定 A：后绑覆盖**（登录登记与 App 静默认领均覆盖；同账号业务上只保留一台当前桌面） |
| 3 | **App WS vs Desktop WS** | **已定 B：分 path**（桌面 `/ws/sclaw`，App 另开如 `/ws/sclaw-app`；桌面执行 WS 仍一条） |
| 4 | **登记/连 WS 时机** | **已定：登录不动作**；仅 **钉钉扫码** 或 **桌面打开 App 绑定开关** 时注册+连 WS；二者共用一条 Desktop WS |
| 5 | **mobile 选脑** | **已定 A：与钉钉对称，各存 `channel_connections` 一行**（mobile 可与钉钉选不同 Agent/引擎） |

---

## 9. 分阶段落地

| 阶段 | 内容 |
|------|------|
| P0 | Desktop `channelType` 通用化（钉钉回归） |
| P1 | Hub 静默绑定 API + App↔Hub WS 骨架 |
| P2 | `mobile.inbound` → Desktop → 回程 App 打通 |
| P3 | 切本地 Tab 态机（新静默绑 / 已绑 ensure）+ 离线提示 |
| P4 | 观测、多设备策略、Channels 可选展示 |

---

## 10. 验收（本地）

- [ ] 未绑定且 **已有桌面登记** → 切本地静默绑成功  
- [ ] 未绑定且 **零桌面登记** → 明确失败文案（请先打开并登录 StoClaw），不假成功  
- [ ] 已绑定切本地 → 只 ensure WS / 在线态  
- [ ] App 发消息经 Hub 命中桌面 SessionFacade，回程到 App  
- [ ] `channelTraceId` 贯穿 App → Hub → Desktop → App  

---

## 11. 总结

- **账号**：统一申通梧桐账号。  
- **执行链**：与钉钉相同，仅来源不同；session 来源标记先透传。  
- **注册+Desktop WS**：登录不做；钉钉扫码或桌面「App 绑定」开关触发；同机共用一条 WS。  
- **App**：切本地静默认领；离线拒收；多机后绑覆盖；App WS 分 path。  

**下一步：** 关键待拍板项已定完，可拆 Hub / Desktop / App 实现计划。
