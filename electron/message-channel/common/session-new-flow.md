# 渠道会话：是否新开对话

> 判定在 Electron **主进程** `message-channel/common` 完成，**不是** OpenClaw Gateway。  
> Gateway / Claude / Pi 只消费已经定好的 `sessionKey`。

相关代码：

- `session-facade.ts` — `createOrGetSession`
- `session-lifecycle.ts` — 空闲 TTL、指令识别、策略 C、key 解析
- `session-key.ts` — sessionKey 编解码
- 设置：`electron/utils/store.ts` → `channelSessionIdleEnabled` / `channelSessionIdleHours`（`settings.json`）
- UI：`src/pages/Channels`「会话管理」→ `GET/PUT /api/settings`

---

## 1. 谁触发

用户在渠道发消息 → 入站适配层：

| 渠道 | 入口 |
| --- | --- |
| 钉钉 / App | `hub/ingress.ts` → `handleSclawInbound` |
| 微信 | `weixin/bridge-inbound.ts` |

入站解析出：`channelType`、`peerId`、绑定的 `agentId` / `engineType`，以及是否用户主动要求新开，然后调用：

```ts
createOrGetSession({ channelType, peerId, agentId, engineType, forceNew?, sessionKey? })
```

---

## 2. 入站侧先算一层 `forceNew`

### 钉钉（`hub/ingress.ts`）

- Hub 下发 `action: 'new_session'`（如卡片按钮）
- 或用户发送「新对话 / 新会话 / 清空上下文 / `/new` / `/reset`」等（`isDingTalkNewSessionCommand`）

### 微信（`weixin/bridge-inbound.ts`）

- 复用同一套指令匹配
- 命中后回「已开启新对话…」，本轮不再把指令当普通内容丢给模型

### App / mobile

- 带了有效 `sessionKey` → 尽量续聊
- **没带** `sessionKey` → 视为显式新建（**不看**空闲小时数）

### 自然语言「新开对话」：入站拦截（不是工具）

用户在渠道里说「新对话」「开一个新会话」等能立刻新开，**不是** Agent 内置 tool，也不是模型理解语义后回调。

机制：入站适配层在调用模型**之前**做硬编码文本匹配：

```ts
isDingTalkNewSessionCommand(text)  // session-lifecycle.ts；钉钉/微信共用
```

命中则 `forceNew = true`。微信还会直接 `outbound.commit`「已开启新对话…」并 `return`，**本轮不进模型**。钉钉侧同样用该结果驱动 `createOrGetSession({ forceNew })`，并可能回一条新会话提示。

匹配前会：`trim` → `toLowerCase` → 去掉末尾 `!！.。？?`。

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 精确词 | `NEW_SESSION_COMMANDS` | `新对话`、`新会话`、`清空上下文`、`/new`、`/reset` |
| Slash | `NEW_SESSION_SLASH_RE` | `/new`、`/reset` |
| 自然语言 | `NEW_SESSION_NATURAL_RE` | `开一个新会话`、`请新建对话`、`帮我开个新对话` |
| 清空说法 | `CLEAR_CONTEXT_NATURAL_RE` | `帮我清空上下文`、`请清除一下会话` |

注意：

- 要求**整句**匹配（正则带 `^…$`）；夹在长消息里通常不命中
- 说法太绕、多句混写，可能匹配失败，会当普通聊天进模型
- 与空闲 TTL、换引擎（策略 C）独立：这是用户主动指令路径

---

## 3. `createOrGetSession` 判定顺序

### A. App 续聊捷径

若传入 `sessionKey`，且格式 / 渠道 / agent / catalog 均有效 → **直接复用**，更新 `lastActivityAt`，结束。  
无效则忽略该 key，继续往下走。

### B. 查最近一次渠道会话

```ts
getLatestChannelCatalogSession({ channelType, channelId: peerId, agentId })
```

从 SQLite catalog 取该 peer 最近一条的 `sessionKey` + `lastActivityAt`。

### C. 叠加强制新建

在入站 `forceNew` 之外：

1. **mobile 且无 sessionKey** → `forceNew = true`
2. **策略 C（换引擎）**：最近会话在引擎 registry 登记的引擎 ≠ 当前绑定引擎 → `forceNew = true`  
   （避免用新引擎改写旧会话；函数名仍为 `shouldForceNewDingTalkSessionForEngine`，钉钉/微信共用）

### D. 读空闲设置，算 TTL

```ts
getSetting('channelSessionIdleEnabled')
getSetting('channelSessionIdleHours')  // 默认 24，钳制 1–168
→ resolveChannelIdleTtlMs({ channelType, idleEnabled, idleHours })
```

| 情况 | TTL |
| --- | --- |
| `mobile` | `∞`（永不因空闲拆） |
| 开关关闭 | `∞` |
| 开关开启 | `hours × 3600 × 1000` |

### E. `resolveChannelSessionKey` 二选一

```
若有 latestSession
  且 不是 forceNew
  且 now - lastActivityAt < TTL
→ 复用 latestSession.sessionKey

否则
→ 新建 sessionKey（时间戳 + nonce）
```

**空闲超时不会后台建会话**；只在本次入站需要定 key 时，发现超时了才新建。

### F. 落库并返回

1. `rememberSessionEngineType(sessionKey, engineType)`
2. catalog upsert（`lastActivityAt = now`）
3. 返回 `{ sessionKey, engineType, agentId }`

---

## 4. 之后才交给引擎

`sendViaFacade` → 按 `engineType` 选 adapter → `runMainChatSend`。  
此时才进入 Claude / Pi / OpenClaw 执行路径；它们**不参与**「要不要新开」的决策。

---

## 5. 总览

```
渠道消息
  → ingress / weixin-bridge
      ├─ 文本指令拦截（isDingTalkNewSessionCommand，非 tool）？ → forceNew
      ├─ 按钮 new_session / mobile 无 sessionKey？ → forceNew
      └─ createOrGetSession
            ├─ App 带有效 sessionKey？ → 复用
            ├─ 查 catalog 最近会话
            ├─ 换引擎（策略 C）？ → forceNew
            ├─ 读 settings 空闲小时
            └─ 超时或 forceNew？
                  ├─ 是 → 新 sessionKey
                  └─ 否 → 复用旧 sessionKey
  →（指令命中且微信等短路）直接回提示，不进模型
  → 否则 sendViaFacade（Claude / Pi / OpenClaw）
```

---

## 6. 与「自动新起会话」UI 的对应

Channels 页「会话管理」开关 + 小时数，写入本机 `settings.json`。

开启且设为 N 小时时（钉钉 / 微信）：

- 同 `peerId` 连续聊 → 复用同一会话
- 停了 ≥ N 小时，**再发下一条** → 新建 `sessionKey`，旧上下文不再带给模型
- **不会**在整点自动冒出一个空会话
- **App（mobile）不受此开关影响**
