# 企业 App「本地通道」对接文档（App 侧）

> 状态：可对接开发  
> 日期：2026-07-23  
> 受众：App / H5 客户端开发  
> 关联设计：[`2026-07-14-platform-channel-mobile-app-design.md`](./2026-07-14-platform-channel-mobile-app-design.md)  
> 范围：**仅本地通道**（消息经智多星 Hub 落到用户电脑上的 StoClaw 执行）。云端 Tab 不在本文范围。

---

## 1. 对接方式总览

### 1.1 架构

```text
App / H5
  │  ① HTTPS：静默绑定
  │  ② WSS ：业务长连接（发消息、收流式、拉历史）
  ▼
智多星 Hub（通道中枢 / chatbotapi）
  │  仅当桌面在线时转发
  ▼
用户电脑 StoClaw Desktop（真相源：会话与聊天记录）
```

| 通道 | 用途 |
|------|------|
| **HTTPS** | 静默绑定（V1 **不做**单独的绑定状态查询接口） |
| **WebSocket（WSS）** | 对话、历史列表、会话详情、流式回程、错误与在线状态推送 |

**重要约束：**

- 历史与对话正文 **只存在电脑本地**；Hub **不镜像**聊天记录。
- 电脑 StoClaw **不在线**时：不能发消息、不能拉历史（会返回明确错误文案）。
- App **不需要**关心 `peerId`；会话身份只认 **`sessionKey`**。

### 1.2 环境与地址

| 环境 | HTTP Base | App WS |
|------|-----------|--------|
| 测试 | `https://baseinfo-chatbotapi-test.sto.cn` | `wss://baseinfo-chatbotapi-test.sto.cn/ws/sclaw-app` |
| 预发 | `https://pre-baseinfo-chatbotapi.sto.cn` | `wss://pre-baseinfo-chatbotapi.sto.cn/ws/sclaw-app` |
| 生产 | `https://baseinfo-chatbotapi.sto.cn` | `wss://baseinfo-chatbotapi.sto.cn/ws/sclaw-app` |

| 项 | 说明 |
|----|------|
| 鉴权 | **Header** 或 **Query** 传 `Token`（二选一即可，值相同：梧桐登录态）。推荐优先 Header；WS 无法带自定义 Header 的端用 Query |
| WS Path | **`/ws/sclaw-app`** |
| HTTP 前缀 | 统一走 **`/api/m/`**（见 §3） |

**鉴权示例（Header，推荐）：**

```http
Token: <梧桐登录 Token>
```

**鉴权示例（Query，兼容）：**

```text
HTTPS: POST /api/m/...?Token=<梧桐登录 Token>
WSS:   wss://{hub-host}/ws/sclaw-app?Token=<梧桐登录 Token>
```

Header 与 Query **同时传时以 Header 为准**。

### 1.3 推荐接入顺序

**不要每次进「本地」Tab 都调静默绑定。** 绑定是低频动作；进 Tab 后优先复用已有绑定并建 WS。

```text
进入「本地」Tab
  │
  ├─ 本地已有「绑定成功」标记（曾 silent 成功 / 本地缓存）
  │     → 直接建 App WS
  │     → 监听 mobile.bind_status / mobile.error 刷新在线态
  │
  └─ 从未绑定，或本地缓存丢失，或收到 NOT_BOUND，或用户主动「重新绑定」
        → POST 静默绑定
        → 成功后再建 App WS
```

| 步骤 | 行为 |
|------|------|
| 1 | 进入「本地」Tab：若**已绑定过** → **直接建 WS**；仅首次 / 缓存丢失 / `NOT_BOUND` / 重新绑定时才调 **静默绑定** |
| 2 | WS 连通后：可发消息、拉历史；`desktopOnline=false` 时禁用发送/拉历史，展示离线文案（**不必再打绑定**） |
| 3 | 对话页：发 `mobile.inbound`，收 `mobile.delta` / `mobile.done` |
| 4 | 历史页：`mobile.history.list` → 点进 → `mobile.history.get` |
| 5 | 全程监听 `mobile.error` / `mobile.bind_status` |

| 时机 | 调静默绑定？ |
|------|----------------|
| 每次进 Tab | **否** |
| 首次使用本地通道 | **是** |
| 已绑定后再进 Tab | **否**，直接 WS |
| App 清缓存 / 重装导致本地标记丢失 | **是**（按未绑定走；Hub 侧映射通常仍在，silent 幂等成功后写回缓存） |
| 收到 `NOT_BOUND` | **是**，补绑后再连 |
| 仅 `DESKTOP_OFFLINE` | **否**（需用户打开电脑） |
| 换机 / 解绑后重来 | **是** |

#### 如何判断「已绑定过」

以 **App 本地缓存** 为准（SharedPreferences / UserDefaults / MMKV 等），不要每次进 Tab 都问服务端。

静默绑定 **成功** 后写入，建议按 **梧桐用户 ID** 隔离，例如：

```text
bound = true
deviceId = "..."
deviceName = "文彭的 MacBook"
boundAt = ...
userId = "<当前登录用户>"
```

| 读到的本地状态 | 行为 |
|----------------|------|
| 当前用户下 `bound == true` | 视为已绑定 → 直接建 WS |
| 无记录 / `bound != true` | 视为未绑定 → 调静默绑定 |
| 切换登录账号 | 清掉或忽略上一账号的绑定缓存，按新账号重新判断 |

**服务端纠错：** 本地以为已绑，但 WS/业务返回 `NOT_BOUND` → 清本地标记 → 再调静默绑定 → 重连。

#### 清缓存怎么处理

清的是 **App 侧记忆**，不是 Hub 上的人↔电脑关系。

```text
用户清缓存 / 重装
  → 本地无 bound 标记（按「未绑定」走）
  → 进「本地」Tab → POST .../bind/silent（幂等）
  → Hub 若仍有该用户映射 → 直接成功，返回 deviceId / desktopOnline
  → App 重新写入本地缓存 → 建 WS
```

| 情况 | silent 结果 |
|------|-------------|
| 清了 App 缓存，Hub 仍有绑定 | 成功，恢复本地标记（用户无感，多一次 HTTP） |
| 确实从未绑 / 桌面未开 App 绑定 | 失败 `NO_DESKTOP_DEVICE`，引导开电脑 |

不需要单独的「恢复绑定」接口；**再 silent 一次即可**。

---

## 2. 会话模型（App 必读）

| 规则 | 说明 |
|------|------|
| `sessionKey` 谁发 | **仅服务端（经 Desktop）发放**；App 禁止自造 |
| 新建对话 | 本地把 `sessionKey` **置空 / 删除**，再发消息即可 |
| 续聊 | 请求里带上当前页的 `sessionKey` |
| 回包覆盖 | 每次流式回程（尤其 `done`）都会带 `sessionKey`；App **以最新回包为准**写回本地 |
| 坏 key | 服务端发现无效/过期 key → **静默当新建**，回新 `sessionKey`（不报错给用户） |
| 删除会话 | **V1 不做**（无删除/归档接口） |
| 媒体消息 | **二期**；V1 仅文本 |

---

## 3. HTTPS 接口

### 3.1 静默绑定

**低频调用**：首次进入本地通道、**App 清缓存/重装导致本地标记丢失**、收到 `NOT_BOUND`、或用户主动重新绑定时调用；**不要**每次进 Tab 都调。服务端做成幂等；清缓存后再次 silent 即可恢复本地标记（Hub 映射通常仍在）。

```http
POST /api/m/sclaw/mobile/bind/silent
Token: <梧桐登录 Token>
Content-Type: application/json

{
  "clientType": "sto-app",
  "clientVersion": "1.2.3",
  "platform": "ios"
}
```

> 完整 URL 示例（测试）：`https://baseinfo-chatbotapi-test.sto.cn/api/m/sclaw/mobile/bind/silent`  
> 亦可：`.../bind/silent?Token=<token>`（不传 Header 时）。  
>
> **路径易错：** 必须是 **`/api/m/sclaw/...`**。写成 `/api/sclaw/mobile/bind/silent`（少 `/m`）会 **404**，与服务是否部署无关。

**请求体：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `clientType` | **是** | 目前仅一个取值：**`sto-app`**（官方 App）。用于识别客户端类型，**不是**选手机/电脑 |
| `clientVersion` | 建议 | 客户端版本号，如 `1.2.3`，便于排障与兼容 |
| `platform` | 建议 | `ios` / `android` / `harmony` |

> **路由说明：** 用户身份来自 `Token`（Header 或 Query）；认领哪台 StoClaw 由 Hub 按该用户已登记桌面决定（后绑覆盖）。多台手机可同为 `sto-app`——WS 回程按「发请求的那条连接」返回，不靠 `clientType` 选机。

**成功：**

```json
{
  "success": true,
  "deviceId": "uuid-of-stoclaw",
  "deviceName": "文彭的 MacBook",
  "desktopOnline": true
}
```

**失败示例（无桌面）：**

```json
{
  "success": false,
  "errorCode": "NO_DESKTOP_DEVICE",
  "message": "未发现已登录的 StoClaw，请先在电脑打开 StoClaw，并打开「App 绑定」"
}
```

| 响应字段 | 说明 |
|----------|------|
| `desktopOnline` | `true` 才建议发消息 / 拉历史（可先建 WS 收 `bind_status`） |
| `NO_DESKTOP_DEVICE` | 电脑未开 App 绑定或从未上线 |

### 3.2 绑定状态查询

**V1 不做。** 在线/绑定变化依赖：

- 静默绑定成功响应里的 `desktopOnline`
- WS 推送 `mobile.bind_status`
- 业务错误码（如 `NOT_BOUND` / `DESKTOP_OFFLINE`）

---

## 4. WebSocket 对接

### 4.1 连接

```text
wss://{hub-host}/ws/sclaw-app
```

- Path 已定：`/ws/sclaw-app`。
- 鉴权：建连时带 **`Token`**，支持 **Header** 或 **Query**（`?Token=`）；推荐 Header，不能带自定义 Header 时用 Query。
- 鉴权失败：连接关闭或收到 `mobile.error`（`UNAUTHORIZED`）。
- 心跳：**每 30 秒** App → Hub 发 `ping`；Hub 回 `pong`。

### 4.2 公共帧约定

所有业务帧建议形如：

```json
{
  "type": "<见下表>",
  "requestId": "可选，RPC 必填",
  "payload": { }
}
```

| 字段 | 说明 |
|------|------|
| `type` | 消息类型 |
| `requestId` | **历史 list/get 必填**（UUID）；对话 inbound 建议也带，便于排障 |
| `payload` | 业务体 |

### 4.3 消息类型一览（接口清单）

#### App → Hub

| type | 用途 | 模式 |
|------|------|------|
| `mobile.inbound` | 发送用户消息（新建或续聊） | 流式：随后收多条 delta + 一条 done |
| `mobile.history.list` | 历史会话列表 | RPC：一条 result |
| `mobile.history.get` | 某会话消息详情 | RPC：一条 result |
| `ping` | 心跳 | — |

#### Hub → App

| type | 用途 |
|------|------|
| `mobile.delta` | 助手回复增量 |
| `mobile.done` | 本轮回复结束（含最终 `sessionKey`） |
| `mobile.history.list.result` | 列表结果 |
| `mobile.history.get.result` | 详情结果 |
| `mobile.bind_status` | 绑定/桌面在线变更推送 |
| `mobile.error` | 错误（含用户可读文案） |
| `pong` | 心跳应答（若启用） |

---

## 5. 接口详情

### 5.1 对话：`mobile.inbound`

**App → Hub**

```json
{
  "type": "mobile.inbound",
  "requestId": "optional-uuid",
  "payload": {
    "channelType": "mobile",
    "sessionKey": null,
    "text": "帮我查一下今天的待办",
    "channelTraceId": "可选，客户端生成的链路 ID"
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `channelType` | 是 | 固定 `"mobile"` |
| `sessionKey` | 否 | `null`/缺省 = 新建；有值 = 续聊 |
| `text` | 是 | 用户输入，V1 纯文本 |
| `channelTraceId` | 否 | 排障用 |

**Hub → App（流式）**

```json
{
  "type": "mobile.delta",
  "payload": {
    "sessionKey": "agent:main:mobile:...",
    "content": "增量文本",
    "channelTraceId": "..."
  }
}
```

```json
{
  "type": "mobile.done",
  "payload": {
    "sessionKey": "agent:main:mobile:...",
    "content": "",
    "channelTraceId": "..."
  }
}
```

**App 处理要点：**

1. **以 `delta` 的 `content` 拼接展示气泡**；`done` 只作为本轮结束信号，**不要依赖** `done.content`（可为空，忽略即可）。  
2. 收到 `done` 后，用 `payload.sessionKey` **覆盖**当前页 sessionKey。  
3. 同会话连发：服务端会 **排队**；UI 可显示「处理中」，勿假定并行。

---

### 5.2 历史列表：`mobile.history.list`

**模式：** 请求-响应（Hub 等 Desktop，默认超时 **10 秒**）。  
**分页：** 业界通用 **`limit` + `cursor`**（App 将 `nextCursor` 原样回传，勿解析）。

**App → Hub**

```json
{
  "type": "mobile.history.list",
  "requestId": "r-list-001",
  "payload": {
    "limit": 20,
    "cursor": null
  }
}
```

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `limit` | 否 | `20` | 每页条数 |
| `cursor` | 否 | `null` | 首页不传 / `null`；下一页传上次返回的 `nextCursor`（**不透明，原样回传，禁止解析/改写**） |

**Hub → App**

```json
{
  "type": "mobile.history.list.result",
  "requestId": "r-list-001",
  "payload": {
    "limit": 20,
    "nextCursor": "opaque-string-or-null",
    "hasMore": true,
    "items": [
      {
        "sessionKey": "agent:main:mobile:...",
        "title": "帮我查一下今天的待办",
        "lastActivityAt": "2026-07-23T10:00:00.000Z"
      }
    ]
  }
}
```

| 列表项字段 | 说明 |
|------------|------|
| `sessionKey` | 点进详情、续聊时使用 |
| `title` | 由本地端返回；一般为首条用户话截断；空则为「新对话」 |
| `lastActivityAt` | ISO8601 时间 |

| 分页字段 | 说明 |
|----------|------|
| `nextCursor` | 下一页游标；无更多时为 `null` |
| `hasMore` | 是否还有下一页 |

排序：按 `lastActivityAt` 降序（最近活跃在前）。

---

### 5.3 会话详情：`mobile.history.get`

**模式：** 请求-响应（超时 **10 秒**）。  
**内容：** 仅用户可见气泡 — `user` / `assistant` 文本（不含工具调用等内部消息）。  
**交互：** 聊天式 **滑动加载**（界面不展示页码）；分页同样用 **`limit` + `cursor`**。

**App → Hub**

```json
{
  "type": "mobile.history.get",
  "requestId": "r-get-001",
  "payload": {
    "sessionKey": "agent:main:mobile:...",
    "limit": 50,
    "cursor": null
  }
}
```

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `sessionKey` | 是 | — | 列表项带入 |
| `limit` | 否 | `50` | 每屏条数 |
| `cursor` | 否 | `null` | 首屏不传 / `null` = 拉**最近**一屏；滑动加载更早时，传上次返回的 `nextCursor`（**不透明，原样回传，禁止解析/改写**） |

**Hub → App**

```json
{
  "type": "mobile.history.get.result",
  "requestId": "r-get-001",
  "payload": {
    "sessionKey": "agent:main:mobile:...",
    "limit": 50,
    "nextCursor": "opaque-string-or-null",
    "hasMore": true,
    "messages": [
      {
        "id": "msg-1",
        "role": "user",
        "content": "帮我查一下今天的待办",
        "createdAt": "2026-07-23T09:59:00.000Z"
      },
      {
        "id": "msg-2",
        "role": "assistant",
        "content": "好的，正在查询…",
        "createdAt": "2026-07-23T10:00:00.000Z"
      }
    ]
  }
}
```

**滑动加载约定：**

| 步骤 | App 行为 |
|------|----------|
| 进入会话 | `cursor=null`，拉最近 `limit` 条，锚定到底部 |
| 滑向更早 | 带上上次的 `nextCursor` 再请求 → 把返回消息插到顶部 |
| 没有更早 | `hasMore=false` 或 `nextCursor=null`，停止加载 |

- `messages` 按时间 **正序**（旧 → 新）返回，便于直接渲染。  
- `cursor` / `nextCursor` 为 **不透明字符串**（可由 Desktop 编码 messageId/时间等），App **原样回传、不要解析**。  
- 列表与详情分页字段名统一，降低对接成本。

**从详情续聊：** 保留该 `sessionKey`，再发 `mobile.inbound` 即可。

---

## 6. 绑定 / 在线状态推送

```json
{
  "type": "mobile.bind_status",
  "payload": {
    "bound": true,
    "desktopOnline": false,
    "deviceName": "文彭的 MacBook"
  }
}
```

App 收到 `desktopOnline=false` 后：禁用发送与拉历史，展示与 `DESKTOP_OFFLINE` 相同语义的提示。

---

## 7. 错误码（必须展示 `message`）

错误统一：

```json
{
  "type": "mobile.error",
  "requestId": "若有则带回",
  "payload": {
    "code": "DESKTOP_OFFLINE",
    "message": "电脑上的 StoClaw 不在线，请打开后再试"
  }
}
```

| code | message（直接展示给用户） | 场景 |
|------|---------------------------|------|
| `NOT_BOUND` | 还未绑定电脑上的 StoClaw，请先在电脑打开「App 绑定」 | 未完成本地绑定 |
| `DESKTOP_OFFLINE` | 电脑上的 StoClaw 不在线，请打开后再试 | 已绑定但桌面离线 |
| `DESKTOP_TIMEOUT` | 电脑端响应超时，请稍后重试 | list/get 等满 10s 无结果 |
| `DESKTOP_BUSY` | 当前对话正在处理中，请稍候 | 同会话排队过久（若触发） |
| `INVALID_REQUEST` | 请求参数有误，请重试 | 缺字段、非法 limit/cursor 等 |
| `UNAUTHORIZED` | 登录已失效，请重新登录 | WS/HTTP 鉴权失败 |
| `INTERNAL_ERROR` | 服务暂时异常，请稍后重试 | 未分类异常 |
| `NO_DESKTOP_DEVICE` | 未发现已登录的 StoClaw，请先在电脑打开 StoClaw，并打开「App 绑定」 | 静默绑定 HTTP 失败 |

**说明：**

- UI **优先展示 `message`**，不要只弹 `code`。  
- 无效 `sessionKey` **不会**用错误码打断用户，而是静默开新会话并在 `done` 里给新 key。

---

## 8. RPC 超时与并发（App 需知）

| 项 | 约定 |
|----|------|
| list / get | Hub 等待 Desktop，超时 **10 秒** → `DESKTOP_TIMEOUT` |
| 原理 | WebSocket 异步帧 + `requestId` 关联；不是 HTTP 同步阻塞 |
| App 实现 | `await` 同一 `requestId` 的 `*.result`；超时以服务端错误帧为准，客户端也可加 ≥10s 的兜底 |
| 同会话发消息 | 服务端排队；勿并行多发指望同时出两轮回复 |

---

## 9. 典型时序

### 9.1 新建对话

```text
App: sessionKey = null
App → mobile.inbound { sessionKey: null, text }
Hub → mobile.delta { sessionKey, content }  × N
Hub → mobile.done  { sessionKey }           ← 写入本地
```

### 9.2 打开历史并续聊

```text
App → mobile.history.list { requestId, limit:20, cursor:null }
Hub → mobile.history.list.result { items, nextCursor, hasMore }
用户点击某一项
App → mobile.history.get { sessionKey, limit:50, cursor:null }
Hub → mobile.history.get.result { messages, nextCursor, hasMore }
用户滑向更早
App → mobile.history.get { sessionKey, limit:50, cursor:"上次的nextCursor" }
用户继续输入
App → mobile.inbound { sessionKey, text }
```

### 9.3 桌面离线

```text
App → mobile.history.list / inbound
Hub → mobile.error { code: DESKTOP_OFFLINE, message: "..." }
```

---

## 10. App 开发检查清单

- [ ] 本地 Tab：**已绑定则直接建 WS**；仅首次 / 清缓存丢标记 / `NOT_BOUND` / 重新绑定才调静默绑定（**禁止每次进 Tab 都绑**）  
- [ ] 「已绑定」以 **App 本地缓存**（按用户 ID）判断；清缓存后按未绑定再 silent 幂等恢复  
- [ ] 建连 `/ws/sclaw-app`，处理断线重连与 `UNAUTHORIZED`  
- [ ] `DESKTOP_OFFLINE` 只提示开电脑，不要反复打绑定  
- [ ] 新建：清空 `sessionKey`；`done` 后回写  
- [ ] 流式拼接 `delta`，`done` 结束一轮  
- [ ] 历史列表三字段展示 + **`limit`/`cursor`** 分页  
- [ ] 详情只渲染 `user`/`assistant` 文本 + **滑动加载**（`limit`/`cursor`，无页码 UI）  
- [ ] 所有错误优先展示 `message`  
- [ ] 离线/未绑定禁用发送与拉历史  

---

## 11. 联调依赖（Hub / Desktop 侧）

App 开发可先按本文 mock；联调需 Hub/Desktop 就绪：

1. 静默绑定 API  
2. `/ws/sclaw-app`  
3. `inbound` 流式回程带 `sessionKey`  
4. `history.list` / `history.get` 的 requestId RPC  
5. 上表错误码与文案  

**联调方式：** 以真实 App 页面为准（非仅脚本）。

---

## 12. 非目标（避免误实现）

- 不在 Hub 存聊天记录  
- 不做 `mobile.history.current`  
- **V1 不做** `GET .../bind/status`（用 silent 响应 + `bind_status` + 错误码）  
- App 不传、不依赖 `peerId`  
- V1 不传图片/文件  
- V1 不提供删除会话  
- 云端 Tab 另一套协议，勿与本文混用  

---

**文档变更：** HTTP 前缀 **`/api/m/`**；鉴权 **`Token` 支持 Header 与 Query**；`clientType` 目前仅 **`sto-app`**；分页 **`limit` + `cursor`（原样回传）**；WS Path **`/ws/sclaw-app`**；环境域名见 §1.2。语义与错误文案以本文为准，变更需双方确认后改版。
