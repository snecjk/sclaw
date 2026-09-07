# SClaw 移动端（申懂懂）消息格式对接文档

> 文档状态：基于 SClaw Desktop 当前代码实现整理  
> Desktop 协议版本：`protocolVersion = 2`  
> 适用范围：申懂懂 App、Channel Hub、SClaw Desktop 三方联调

## 1. 对接结论

SClaw 移动端不直接连接用户电脑，也不直接调用本地 Agent。完整链路为：

```text
申懂懂 App
   │ 登录态、发消息、查历史
   ▼
Channel Hub
   │ WebSocket 下发 inbound / history.*
   ▼
SClaw Desktop
   │ 选择绑定的 Agent 和引擎，创建或恢复本地 session
   ▼
本地 Agent（Claude / OpenClaw）
   │ 流式事件
   ▼
SClaw Desktop ── WebSocket delta/done（HTTP 兜底）──► Channel Hub ──► 申懂懂 App
```

关键约定：

1. App 与 Desktop 使用同一企业账号登录，由 Hub 完成账号与桌面设备的关联。
2. App 开新对话时不传 `sessionKey`；Desktop 创建会话后在 `delta`/`done` 中返回 `sessionKey`。
3. App 续聊时必须原样回传最近一次 Desktop 返回的 `sessionKey`。
4. `delta.content` 是“当前完整快照”，不是字符增量；App 必须覆盖当前内容，禁止直接拼接。
5. `done.content` 是本轮最终完整正文；收到后结束加载态。
6. `chatUid` 是单次问答的关联 ID；同一轮所有 `delta`/`done` 都使用同一个 `chatUid`。
7. Desktop 当前没有基于 `chatUid` 的入站去重。Hub/App 重试同一问题时必须避免重复投递，否则可能触发两次 Agent 执行。

## 2. 职责边界

### 2.1 App 负责

- 使用与 Desktop 相同的账号登录。
- 查询当前账号下的 Desktop 在线状态。
- 为每次用户发送生成全局唯一的 `chatUid`。
- 新对话不传 `sessionKey`，续聊原样传回已有 `sessionKey`。
- 将文本、图片、音频、视频和文件整理为 `parts`。
- 保存 Desktop 回传的 `sessionKey`，并按 `chatUid` 更新对应消息气泡。
- 将 `delta` 当快照覆盖，将 `done` 当最终结果。
- 使用不透明的历史分页 `cursor`，不得自行解析或修改。

### 2.2 Channel Hub 负责

- 校验 App 登录态、账号归属及 Desktop 设备绑定关系。
- 维护 Desktop WebSocket 连接和在线状态。
- 将 App 消息转换为 Desktop 接受的 `inbound` 包。
- 按 `chatUid` 将 Desktop 的 `delta`/`done` 路由回正确的 App 用户和会话。
- 转发 `history.list`、`history.get` 及其结果。
- 对上传媒体生成 Desktop 可直接下载的 URL。
- 对同一 App 请求实施幂等或至少一次投递保护。

### 2.3 Desktop 负责

- 使用本地 `refreshToken` 连接 Hub WebSocket。
- 根据 `channelType = mobile` 选择移动端绑定的 Agent 和引擎。
- 创建、校验或恢复本地 `sessionKey`。
- 下载媒体到本地，并调用 Agent 多模态接口。
- 将 Agent 过程态和正文转换为 `delta`/`done`。
- 提供移动端会话列表和消息历史。

## 3. 绑定与连接逻辑

### 3.1 移动端绑定不是扫码绑定

界面中的二维码是 App 下载二维码，不是 Desktop 与 App 的配对凭证。实际绑定流程是：

1. 用户在 Desktop 与申懂懂 App 使用同一账号登录。
2. 用户在 Desktop 打开“开启连接 App”开关。
3. Desktop 使用当前登录用户的 `stotoken` 调用 Hub：

```http
POST /api/sclaw/desktop/channel/bind/enable
stotoken: <desktop-login-token>
Content-Type: application/json
```

```json
{
  "channelType": "mobile",
  "deviceId": "<desktop-device-id>",
  "clientVersion": "<desktop-version>",
  "protocolVersion": 2
}
```

4. Hub 返回 Desktop 专用 `refreshToken`。
5. Desktop 使用该 token 建立 WebSocket：

```text
wss://<hub-host>/ws/sclaw?refreshToken=<refreshToken>
```

6. App 根据同账号下 Desktop 的 Hub 在线状态显示“已连接电脑”。

注意：`refreshToken` 是 Hub 与 Desktop 之间的设备凭证，不应下发给 App，也不应写入日志。

### 3.2 Desktop 心跳与重连

Desktop 每 30 秒发送：

```json
{ "type": "ping" }
```

Hub 应回复：

```json
{ "type": "pong" }
```

WebSocket 非主动断开后，Desktop 按 `1s、2s、4s、8s、16s、30s` 上限指数退避重连。连接成功后重置重试次数。

### 3.3 换绑或解绑通知

Hub 可以向 Desktop 发送：

```json
{
  "type": "bind.replaced",
  "reason": "bound_on_another_device",
  "deviceId": "<new-device-id>"
}
```

`reason` 当前已知值：

- `bound_on_another_device`：账号已绑定到另一台电脑。
- `unbound`：Hub 侧已解绑。

Desktop 收到后会清除旧连接凭证并永久停止旧 WebSocket 重连。

## 4. App 发消息

### 4.1 Hub 下发给 Desktop 的标准包

App 的发送接口可由 Hub 自行设计，但 Hub 最终必须向 Desktop WebSocket 投递以下结构：

```json
{
  "type": "inbound",
  "payload": {
    "channelType": "mobile",
    "channelTraceId": "trace-20260901-000001",
    "chatUid": "chat-550e8400-e29b-41d4-a716-446655440000",
    "peerId": "user-or-conversation-id",
    "senderNick": "张三",
    "text": "帮我分析这张图片",
    "parts": [
      {
        "type": "text",
        "content": "帮我分析这张图片"
      },
      {
        "type": "picture",
        "url": "https://files.example.com/signed/image.png",
        "fileName": "现场照片.png",
        "mimeType": "image/png"
      }
    ],
    "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2"
  }
}
```

### 4.2 `inbound.payload` 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `channelType` | string | 是 | 移动端固定为 `mobile`。缺省会被 Desktop 当作 `dingtalk`，因此不得省略。 |
| `chatUid` | string | 是 | 单次问答关联 ID。建议 UUID；一轮内保持不变，不同轮不得复用。 |
| `peerId` | string | 建议必填 | 稳定的用户或对话归属 ID，用于生成本地会话键。不得包含敏感明文。缺失时 Desktop 会临时回退为 `mobile-${chatUid}`。 |
| `sessionKey` | string/null | 否 | 新对话省略或传 `null`；续聊原样传回 Desktop 返回值。 |
| `channelTraceId` | string | 否 | 链路追踪 ID，仅用于日志和排障。 |
| `senderNick` | string | 否 | 发送者昵称；当前 Desktop 不参与路由。 |
| `text` | string | 条件必填 | 兼容文本字段。当 `parts` 中已有可用文本时，以 `parts` 为准。 |
| `parts` | array | 条件必填 | 多模态消息分片。至少 `text` 或 `parts` 中有一项有效内容。 |
| `action` | string | 否 | 可随一条有正文/附件的消息传 `new_session`；不能作为无正文的纯控制帧。移动端推荐直接将 `sessionKey` 置空。 |
| `msgtype` | string | 否 | 原始平台消息类型，仅用于日志/兼容。 |
| `robotCode` | string | 否 | 钉钉兼容字段，移动端无需传。 |
| `dingUserId` | string | 否 | 钉钉兼容字段，移动端无需传。 |
| `group` | boolean | 否 | 群聊兼容字段，当前移动端逻辑不依赖。 |

### 4.3 文本消息示例

新对话：

```json
{
  "type": "inbound",
  "payload": {
    "channelType": "mobile",
    "chatUid": "chat-cf67c56a-4081-4cf3-94de-1b438f865e44",
    "peerId": "user-001",
    "parts": [
      { "type": "text", "content": "介绍一下今天的工作重点" }
    ]
  }
}
```

续聊：

```json
{
  "type": "inbound",
  "payload": {
    "channelType": "mobile",
    "chatUid": "chat-37668078-aef2-4bc9-86d2-6cf03e7eb2e2",
    "peerId": "user-001",
    "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
    "parts": [
      { "type": "text", "content": "把第二点展开说说" }
    ]
  }
}
```

### 4.4 新建与续聊规则

- `sessionKey` 为空：Desktop 必定创建新会话，不会按 `peerId` 恢复最近会话。
- `sessionKey` 有效：Desktop 复用该会话。
- `sessionKey` 无效、已删除、通道不是 `mobile`，或 Agent 不匹配：Desktop 静默创建新会话。
- Desktop 创建的新 key 格式为：

```text
agent:{agentId}:mobile:{peerId}:{yyyyMMddHHmmss}:{nonce}
```

- App 不应自行拼装或解析 `sessionKey`，只应存储并原样回传。
- 即使请求携带旧 key，App 也应以最新 `delta`/`done` 返回的 `sessionKey` 覆盖本地值，以兼容失效 key 静默重建。
- 移动端会话不会因空闲时长自动拆分；是否新建完全由 App 是否传 `sessionKey` 决定。

### 4.5 多模态 `parts`

```ts
type MobilePart = {
  type: 'text' | 'picture' | 'audio' | 'video' | 'file';
  content?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
};
```

| `type` | `content` 语义 | `url` 语义 |
|---|---|---|
| `text` | 用户正文 | 通常不传 |
| `picture` | 可选图片说明 | 图片下载地址 |
| `audio` | 推荐放语音识别文本 | 音频下载地址 |
| `video` | 可选视频说明 | 视频下载地址 |
| `file` | 可选文件说明 | 文件下载地址 |

媒体要求：

- URL 必须能由用户电脑直接访问，建议使用有时效的 HTTPS 签名 URL。
- Desktop 下载媒体时不会附带 App 登录 Cookie 或业务鉴权头。
- `mimeType` 应提供标准 MIME；缺省时 Desktop 会根据文件扩展名或 `type` 推断。
- `fileName` 建议带正确扩展名。
- 音频的 `content` 会作为语音识别文本传给 Agent。
- 当 `parts` 中存在 `text` 或 `audio.content` 时，Desktop 使用这些内容拼接 prompt，顶层 `text` 仅作兜底。
- 纯图片/文件没有文字时，Desktop 会自动补充“请查看图片并回答”或“请查看附件并回答”。
- 当前回程协议只支持文本正文，不支持 Desktop 向 App 回传文件或图片。

## 5. Desktop 流式回复

### 5.1 过程帧 `delta`

```json
{
  "type": "delta",
  "chatUid": "chat-cf67c56a-4081-4cf3-94de-1b438f865e44",
  "content": "正在分析你的问题...",
  "finalize": false,
  "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
  "contentKind": "think"
}
```

有正文后的过程帧：

```json
{
  "type": "delta",
  "chatUid": "chat-cf67c56a-4081-4cf3-94de-1b438f865e44",
  "content": "今天的工作重点有三项：第一，完成需求评审；第二，",
  "finalize": false,
  "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
  "contentKind": "answer"
}
```

重要：上述第二个 `content` 是截至当前的完整可见正文。App 应执行覆盖：

```ts
message.content = frame.content;
```

不得执行：

```ts
message.content += frame.content;
```

Desktop 对非终态推送做了约 450ms 的最小间隔节流，App 不应依赖固定帧频。

### 5.2 终态帧 `done`

```json
{
  "type": "done",
  "chatUid": "chat-cf67c56a-4081-4cf3-94de-1b438f865e44",
  "content": "今天的工作重点有三项：第一，完成需求评审；第二，完成移动端联调；第三，发布测试版本。",
  "finalize": true,
  "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
  "contentKind": "answer"
}
```

收到 `done` 后，App 应：

1. 用 `content` 最后覆盖一次消息正文。
2. 保存/更新 `sessionKey`。
3. 结束该 `chatUid` 的 loading、typing 或 streaming 状态。
4. 允许用户继续发送下一轮。

### 5.3 回复字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `type` | `delta`/`done` | 是 | 帧生命周期。 |
| `chatUid` | string | 是 | 与入站请求一致，用于定位消息气泡。 |
| `content` | string | 是 | 当前完整可见内容；`done` 时为最终正文或错误提示。 |
| `finalize` | boolean | 是 | `delta=false`，`done=true`；兼容冗余字段。 |
| `sessionKey` | string | 强烈建议 | Desktop 创建或确认的会话 ID。异常早期失败时可能缺失。 |
| `contentKind` | string | 否 | `think`、`tool`、`answer`。缺失时必须按 `answer` 兼容。 |

`contentKind` 展示建议：

- `think`：过程占位，可使用弱化样式；后续 `answer` 直接覆盖。
- `tool`：工具执行状态；协议已预留，当前 Desktop 主路径通常以 `think` 表示无正文过程态。
- `answer`：用户可见正文。
- 未知值或缺失：按 `answer` 展示，保证向后兼容。

### 5.4 WebSocket 与 HTTP 兜底

Desktop 优先通过 WebSocket 发送 `delta`/`done`。当 WebSocket 不可用时，会调用：

```http
POST /api/sclaw/desktop/reply/stream
```

```json
{
  "chatUid": "chat-cf67c56a-4081-4cf3-94de-1b438f865e44",
  "content": "最终回复",
  "finalize": true,
  "contentKind": "answer"
}
```

此外，WebSocket 成功发送 `done` 后，Desktop 仍会补发一次 HTTP 终态备份。因此 Hub 和 App 必须按 `chatUid + type/finalize` 幂等处理重复终态，不能生成第二条回答消息。

HTTP 兜底结构当前不包含 `sessionKey`。正常路径应以 WebSocket 帧中的 `sessionKey` 为准；Hub 若需要支持纯 HTTP 降级下的会话续聊，应在服务端保存此前该 `chatUid` 对应的 WebSocket `sessionKey`。

## 6. 历史会话协议

历史查询通过 Desktop WebSocket RPC 完成。`requestId` 由 App/Hub 生成，结果必须按原值关联。

### 6.1 会话列表

请求：

```json
{
  "type": "history.list",
  "requestId": "req-history-list-001",
  "payload": {
    "limit": 20,
    "cursor": null
  }
}
```

响应：

```json
{
  "type": "history.list.result",
  "requestId": "req-history-list-001",
  "payload": {
    "items": [
      {
        "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
        "title": "介绍一下今天的工作重点",
        "lastActivityAt": "2026-09-01T02:16:10.000Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false,
    "limit": 20
  }
}
```

规则：

- 默认 `limit = 20`，范围 `1..100`。
- 按 `lastActivityAt` 倒序返回。
- `cursor` 是不透明字符串；下一页原样回传 `nextCursor`。
- 无标题时 Desktop 返回“新对话”。

### 6.2 会话消息详情

请求：

```json
{
  "type": "history.get",
  "requestId": "req-history-get-001",
  "payload": {
    "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
    "limit": 50,
    "cursor": null
  }
}
```

响应：

```json
{
  "type": "history.get.result",
  "requestId": "req-history-get-001",
  "payload": {
    "sessionKey": "agent:main:mobile:user-001:20260901021530:a1b2",
    "messages": [
      {
        "id": "msg-001",
        "role": "user",
        "content": "介绍一下今天的工作重点",
        "createdAt": "2026-09-01T02:15:30.000Z"
      },
      {
        "id": "msg-002",
        "role": "assistant",
        "content": "今天的工作重点有三项……",
        "createdAt": "2026-09-01T02:16:10.000Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false,
    "limit": 50
  }
}
```

规则：

- 默认 `limit = 50`，范围 `1..100`。
- 只返回 `user`、`assistant` 两种角色的可见文本，不返回 thinking、tool call 或附件结构。
- 单页消息按时间正序，适合直接从上到下渲染。
- 向前翻页时原样回传 `nextCursor`。
- 非法或非移动端 `sessionKey` 返回空 `messages`。

### 6.3 历史查询失败

请求缺少 `requestId` 时 Desktop 不响应。其他错误会返回同类型的 `.result`：

```json
{
  "type": "history.get.result",
  "requestId": "req-history-get-001",
  "payload": {
    "error": "Error: gatewayManager unavailable",
    "items": [],
    "messages": [],
    "nextCursor": null,
    "hasMore": false
  }
}
```

App 应以 `payload.error` 是否存在判断失败，不要只根据数组为空判断。

## 7. 异常与边界行为

| 场景 | Desktop 行为 | App 建议 |
|---|---|---|
| 缺少 `chatUid` | 丢弃入站，无法回包 | 发送前强校验并生成 UUID |
| 缺少 `peerId` | Mobile 临时使用 `mobile-${chatUid}` | 正常请求始终提供稳定 `peerId` |
| 文本和媒体均为空 | 返回 `done`，提示“不支持该消息类型” | 发送前禁止空消息 |
| 所有媒体下载失败 | 返回 `done`，提示“媒体文件下载失败” | 检查 URL 时效和公网/企业网可达性 |
| 部分媒体下载失败 | 使用成功下载的媒体继续执行 | App 可提示部分附件可能未处理；协议当前无逐附件回执 |
| `sessionKey` 无效 | 静默创建新会话并回传新 key | 始终用响应 key 覆盖本地 key |
| Agent 执行错误 | `done.content` 为“处理失败：…”或“执行失败” | 当前按普通终态展示，可结合文案显示失败态 |
| Agent 超过 10 分钟 | 强制 `done`，内容为已有正文或“回复超时” | 结束加载并允许重试 |
| Desktop WebSocket 断线 | 指数退避重连；回复走 HTTP 兜底 | Hub 保持 App 侧状态并对终态去重 |
| 重复 `done` | WS 终态后可能还有 HTTP 备份 | 按 `chatUid` 覆盖同一消息，不新增消息 |
| 重复 `inbound` | 可能重复执行 Agent | Hub 对 App 发送请求做幂等保护 |

当前协议没有结构化业务错误码，普通问答错误通过 `done.content` 返回。若移动端需要可靠区分“回答”和“失败”，建议后续协议新增可选字段：

```json
{
  "error": {
    "code": "MEDIA_DOWNLOAD_FAILED",
    "message": "媒体文件下载失败"
  }
}
```

新增字段应保持可选，避免破坏协议 v2 兼容性。

## 8. App 端推荐状态机

```text
idle
  └─ 用户发送 ─► sending
                    ├─ 收到 contentKind=think/tool 的 delta ─► processing
                    ├─ 收到 contentKind=answer 的 delta ─────► streaming
                    ├─ 收到 done ─────────────────────────────► completed
                    └─ 超时/连接失败 ─────────────────────────► failed
```

伪代码：

```ts
function onDesktopFrame(frame: DesktopReplyFrame) {
  const message = findPendingMessage(frame.chatUid);
  if (!message) return;

  // delta/done 都是快照覆盖，不做字符串追加
  message.content = frame.content;

  if (frame.sessionKey) {
    conversation.sessionKey = frame.sessionKey;
  }

  if (frame.type === 'done' || frame.finalize === true) {
    message.status = 'completed';
    return;
  }

  const kind = frame.contentKind ?? 'answer';
  message.status = kind === 'answer' ? 'streaming' : 'processing';
}
```

## 9. 联调验收清单

- [ ] Desktop 与 App 同账号登录后，Desktop 开启移动端开关，App 显示已连接电脑。
- [ ] 新对话请求不传 `sessionKey`，首个 `delta` 能拿到新 `sessionKey`。
- [ ] 第二轮原样回传 `sessionKey`，Desktop 历史中属于同一会话。
- [ ] 手动清空 `sessionKey` 后创建新会话，不串旧上下文。
- [ ] 连续 `delta` 在 App 中覆盖显示，不出现重复拼接文字。
- [ ] `think` 切换到 `answer` 时，过程文案被正文覆盖。
- [ ] 同一 `chatUid` 的 WS `done` 与 HTTP 备份只生成一条最终消息。
- [ ] 图片、语音识别文本、视频和文件 URL 可被 Desktop 下载。
- [ ] 会话列表分页、会话详情向前分页正常。
- [ ] 无效 `sessionKey` 后 App 能接受并保存 Desktop 返回的新 key。
- [ ] Desktop 临时断网后自动重连，App 在线状态能恢复。
- [ ] Hub 重投保护有效，同一 App 请求不会触发两次 Agent 执行。

## 10. 当前实现限制与建议

1. 本仓库只包含 Desktop 与 Hub 的协议实现，不包含申懂懂 App 调用 Hub 的 HTTP/WebSocket API。因此 App 的登录、设备列表、在线状态查询和消息发送 URL，需要由 Hub 团队补充；本文件定义的是 Hub 最终必须映射到的消息语义和格式。
2. HTTP 终态兜底不携带 `sessionKey`。建议 Hub 在收到 WebSocket 过程帧时缓存 `chatUid → sessionKey`。
3. `delta` 为快照语义，但字段名容易被误解为增量。后续大版本可新增 `updateMode: "replace"` 明示，协议 v2 仍按本文件执行。
4. 当前无结构化问答错误码、附件处理回执和取消指令。若移动端产品需要失败重试、逐附件状态或“停止生成”，需要三方新增协议。
5. App/Hub 必须对 `done` 去重，也应对 `inbound` 做幂等；Desktop 当前不会按 `chatUid` 去重。

## 11. Desktop 代码依据

- 绑定与共享凭证：`electron/channels/binding-service.ts`
- Hub HTTP API：`electron/channels/hub-api.ts`
- WebSocket 包解析、心跳与重连：`electron/channels/hub-client.ts`
- 启动连接和历史 RPC 挂载：`electron/channels/startup.ts`
- Mobile 入站处理：`electron/channels/ingress.ts`
- 多模态下载和 prompt 组装：`electron/channels/inbound-media.ts`
- Session 创建与续聊：`electron/channels/session-facade.ts`
- Session key 结构：`electron/channels/session-key.ts`
- 流式回程：`electron/channels/delivery.ts`
- 历史列表与详情：`electron/channels/history-facade.ts`
- Desktop Host API 路由：`electron/api/routes/channel-hub.ts`
