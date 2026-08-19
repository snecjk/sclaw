# Mobile App Channel（本地通道）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 StoClaw Desktop 落地 App 本地通道：支持 `channelType=mobile` 入站、按 `sessionKey` 新建/续聊、流式回程带 `sessionKey`，以及 `history.list` / `history.get`（limit+cursor）经 Hub 透传查询本机会话。

**架构：** App ↔ Hub（`/ws/sclaw-app` + `/api/m/...`）↔ Desktop `/ws/sclaw`。Desktop 复用现有 HubClient / Ingress / SessionFacade / catalog + `adapter.getHistory`；真相源在本机，Hub 不镜像历史。协议见 `docs/superpowers/specs/2026-07-23-mobile-app-channel-api.md`。

**技术栈：** Electron Main、现有 `electron/channels/*`、SQLite catalog、双引擎 adapter。

**范围拆分：**

| 仓库 | 本计划 |
|------|--------|
| **sto-claw（本仓）** | Desktop：mobile 通用化、sessionKey、history RPC、App 绑定开关（可后置 UI） |
| **sto-wisdom-star（Hub）** | 另开计划：App WS、静默绑定 `/api/m/...`、透传、超时 10s |

**对接契约（已定）：** `Token` Header/Query；分页 `limit`+`cursor`；坏 sessionKey 静默新建；同会话排队；详情仅 user/assistant 文本。

---

## 文件结构（Desktop）

| 文件 | 职责 |
|------|------|
| `electron/channels/session-facade.ts` | `channelType` 支持 `mobile`；按 sessionKey 续聊/新建 |
| `electron/channels/session-key.ts` / `session-lifecycle.ts` | mobile sessionKey 生成与解析（可与 dingtalk 对称） |
| `electron/channels/binding-service.ts` | `mobile` 行：App 绑定开关、选脑 |
| `electron/channels/ingress.ts` | 按 `channelType` 路由；sessionKey 空/有；排队键 |
| `electron/channels/delivery.ts` / `hub-client.ts` | delta/done 带 `sessionKey`；处理 history RPC |
| `electron/channels/history-facade.ts`（新建） | list catalog + getHistory + cursor 编解码 |
| `electron/channels/startup.ts` | 注册 history 处理器 |
| UI（可后置） | Channels「App 绑定」开关 |
| `tests/unit/...` | sessionKey / history cursor / ingress 分支 |

---

### 任务 1：channelType 通用化 + mobile Binding

**文件：**
- 修改：`binding-service.ts`、`session-facade.ts`、`ingress.ts`
- 测试：`tests/unit/channel-mobile-binding.test.ts`（新建）

- [ ] **步骤 1：** `resolveChannelBinding(channelType)` 替代写死 `resolveDingTalkBinding`；支持 `dingtalk` | `mobile`
- [ ] **步骤 2：** `createOrGetSession` 的 `channelType` 放开为 `'dingtalk' | 'mobile'`；sessionKey 前缀 `agent:{id}:mobile:...`
- [ ] **步骤 3：** `upsertMobileHubBind` / `setMobileBindEnabled`（打开开关 → 登记并连 WS，与钉钉共用 Desktop WS）
- [ ] **步骤 4：** 单元测试：mobile 绑定行 UPSERT、选脑默认 claude+main
- [ ] **步骤 5：** Commit

### 任务 2：inbound 按 sessionKey 新建/续聊

**文件：**
- 修改：`ingress.ts`、`session-facade.ts`、`hub-client.ts`（payload 类型）、`delivery.ts`

- [ ] **步骤 1：** inbound payload 增加可选 `sessionKey`、`channelType`（默认 dingtalk 兼容）
- [ ] **步骤 2：** `sessionKey` 空 → 新建；有值且本机存在且 channel=mobile → 续聊；否则 **策略 B** 静默新建并打日志 `sessionKeyIgnored`
- [ ] **步骤 3：** 排队键：mobile 用 `sessionKey`（新建前用临时 peer/request 队列，或先建 key 再入队）；钉钉保持现 peer 队列
- [ ] **步骤 4：** `sendDelta`/`done` 回程 payload **必须带 `sessionKey`**
- [ ] **步骤 5：** 测试：空 key 新建、有效续聊、无效 key 静默新建
- [ ] **步骤 6：** Commit

### 任务 3：history.list / history.get

**文件：**
- 创建：`electron/channels/history-facade.ts`
- 修改：`hub-client.ts`、`startup.ts` 或 ingress 旁路注册
- 测试：`tests/unit/channel-mobile-history.test.ts`

- [ ] **步骤 1：** Hub→Desktop 帧：`history.list` / `history.get`（含 `requestId`）；回 `history.list.result` / `history.get.result`
- [ ] **步骤 2：** list：`catalog_sessions` 筛 `channel_type=mobile`，按 `last_activity_at`，`limit`+cursor；标题=首条用户话或「新对话」
- [ ] **步骤 3：** get：`adapter.getHistory`，过滤 user/assistant 文本；`limit`+cursor；正序返回；`hasMore`/`nextCursor`
- [ ] **步骤 4：** cursor 不透明（base64url JSON 即可）；App 原样回传
- [ ] **步骤 5：** 桌面离线由 Hub 处理；Desktop 仅处理已送达请求
- [ ] **步骤 6：** 测试 list/get 分页与过滤
- [ ] **步骤 7：** Commit

### 任务 4：App 绑定开关 UI（可与 Hub 并行后置）

**文件：**
- 修改：Channels 相关 UI / host-api

- [ ] **步骤 1：** 「App 绑定」开关 → 本机 `channel_connections` mobile 行 + 确保 HubClient 已连接
- [ ] **步骤 2：** 关闭开关：清 mobile 映射意图；若无钉钉绑定可断 WS（与设计一致）
- [ ] **步骤 3：** Commit

### 任务 5：联调清单（依赖 Hub）

- [ ] Hub：`/api/m/sclaw/mobile/bind/silent`、`/ws/sclaw-app`、`Token` Header/Query
- [ ] Hub：透传 inbound / history，10s 超时，`DESKTOP_OFFLINE`
- [ ] 端到端：App mock → 新建 → 续聊 → list → get 滑动加载

---

## 执行顺序建议

```text
任务 1 → 任务 2 → 任务 3 →（Hub 并行）→ 任务 4 UI → 任务 5 联调
```

**第一刀：** 任务 1 + 任务 2（对话先通），再补 history。

---

## 进度（2026-07-23）

- [x] 任务 1：session-key / lifecycle / binding（`enableMobileAppBind`）/ facade `channelType=mobile`
- [x] 任务 2：ingress 认 `channelType`+`sessionKey`；delivery/delta 带回 `sessionKey`；坏 key 策略 B
- [x] 任务 3：`history-facade` + HubClient `historyRpc` 接线
- [x] 任务 4：App 绑定开关 UI（Channels 页 + `/api/channels/hub/mobile/*`）
- [ ] 任务 5：Hub 侧与端到端联调
