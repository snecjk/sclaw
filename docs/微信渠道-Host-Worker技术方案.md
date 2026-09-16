# 微信渠道 Host Worker 技术方案

> 状态：**Phase 3 媒体已落地最小闭环**（Phase 0/1/2 已于 2026-09-15 通过；引用缓存与工具进度气泡仍可选）
> 范围：下线 OpenClaw 微信/企微/QQ 等 OC 渠道插件路径；在 `electron/message-channel/weixin` 新建基于 iLink Bot 协议的微信渠道 Worker；**微信可选 Claude Agent / SAgent**（`engineType` 写入绑定并走 session-facade）。  
> 非目标（本方案不包含）：删除整个 OpenClaw 引擎与 Gateway 进程；Claude 迁入 utilityProcess。  
> 延后：无（钉钉 Hub / Mobile 已迁入 `message-channel/`，见 [`钉钉Hub与Mobile迁入message-channel计划.md`](./钉钉Hub与Mobile迁入message-channel计划.md)）。
> 渠道产品面清理（第三方 IM + 钉钉 OC 旁路）：见 [`非钉钉微信Mobile以外渠道清理计划.md`](./非钉钉微信Mobile以外渠道清理计划.md)。
>
> Phase 0 报告：`electron/message-channel/weixin/runtime/spike/phase0-report.json`

---

## 1. 背景与目标

### 1.1 背景

- 当前微信依赖 `@tencent-weixin/openclaw-weixin`，以 **OpenClaw Gateway 渠道插件** 形式运行。
- 登录扫码已在 Host 侧（`electron/message-channel/weixin/host-login.ts`），消息收发仍在 OC 子进程。
- Claude 在主进程、Pi 在 `utilityProcess`；跨引擎事件经 `GatewayManager`（EventEmitter）进入 `ChatRuntimeSupervisor`。
- 钉钉已存在 Host 编排路径：`ingress` → `session-facade` → Claude/Pi → `delivery`。

### 1.2 目标

1. **删除** OpenClaw 相关渠道插件集成（微信、企微、QQ 等，本方案明确不保留）。
2. **新建** 微信渠道：`utilityProcess` Worker 承载 iLink 传输层；主进程复用渠道 Session 门面；**默认绑定 SAgent（Pi）**，UI 可切换 Claude Agent / SAgent。
3. 传输以 `openclaw-weixin` 为参考改造；**不作为 OC Gateway 插件加载**。理想态：本地等价替换 plugin-sdk 值导入后，运行时可不依赖 `openclaw` peer。**R1 退路例外**：可 npm 依赖传输包，此时须保留 `openclaw` peer（见 §4.3 / §10）。
4. 架构上 **隔离微信服务端协议变化**，避免协议抖动穿透到引擎与 UI。

### 1.3 成功标准

| 标准 | 说明 |
| --- | --- |
| 功能 | 扫码登录（**仅 1 个微信 Bot**）、文本收发、typing；基础媒体分阶段 |
| 引擎 | **UI 可切换 Claude Agent / SAgent**；`engineType` 写入绑定并走 session-facade；新建默认 `'pi'` |
| 进程 | 长轮询与 CDN 加解密在 Worker；主进程不跑 iLink 热循环 |
| 可演进 | 更换/升级 iLink 协议实现时，不改 `session-facade` / Supervisor / 前端契约 |
| 侧栏可见 | 微信渠道会话写入 SQLite `catalog_sessions`（`session_type=channel`）；正文走与页面对话同链的 runtime/引擎持久化 |
| Channels UI | 仅保留钉钉 + 微信；下线企微/QQ 等其它非钉钉入口（微信为新实现，非 OC 插件） |
| 清理 | 清理 = **OC 插件 wiring / asar 打包**（企微、QQ、微信插件安装路径）。`@tencent-weixin/openclaw-weixin` 的 **npm 依赖**是否删除以 R1 为准：理想态彻底剥离后删；**退路下须保留**至值导入替换完成（见 §5.1 / §10） |

---

## 2. 决策摘要

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 目录伞 | 新建 `electron/message-channel/` | IM 渠道子系统收口；微信用独立树，避免与 Hub 文件平铺混乱 |
| 钉钉目录 | **已迁入** `message-channel/{hub,common,mobile}`（钉钉专用说明见 `dingtalk/README.md`） | Hub 与 Mobile 共用传输层，不可只塞 `dingtalk/`；见迁移计划 |
| 微信进程模型 | `utilityProcess` Worker | 与 Pi 一致；长轮询与加解密不堵主进程 |
| 引擎位置 | 保持现状（Claude 主进程 / Pi Worker） | 与微信 Worker 解耦；facade 已按引擎分流 |
| 编排复用 | 复用 `session-facade` + 入站/发送链（catalog、Supervisor）；**出站不复用**钉钉 `delivery` 的卡片覆盖语义，按 §4.4.1（typing + commit） | 与钉钉同会话模型；微信无消息编辑 API |
| OC 渠道 | 全部删除（微信/企微/QQ…） | 产品明确不保留 |
| OC 引擎/Gateway | **本期保留** | EventBus / 默认引擎切换另立项；避免双线手术 |
| HTTP 网关 | 不上 | 桌面单消费者；HTTP 只增延迟 |
| 上游源码 | vendor 进 `weixin/runtime/vendor/`，自研进 `transport/` | 见 §4.3。**禁止**作 OC Gateway 插件加载。理想态不 npm、不依赖 openclaw peer。**R1 退路**：npm 传输包 + 禁用 plugin，**须同时保留 openclaw peer**（见 §10） |
| 微信渠道引擎 | **UI 可切换 Claude Agent / SAgent**；绑定模型 `engineType` 默认 `'pi'`，入站按绑定引擎执行 | 与钉钉/Mobile 同一套 session-facade |
| Channels 入口 | **下线所有非钉钉的旧入口**；微信仅保留新 Host Worker 入口 | 去掉企微/QQ/旧 OC 微信等 |
| 微信账号数 | **固定仅 1 个 Bot**；已登录则禁止再扫码绑定第二个；不做多账号 monitor / session 维度 | 产品拍板；降低隔离与产品复杂度 |
| 空闲拆会话 | **复用全局** `channelSessionIdleEnabled` / `channelSessionIdleHours` | 与钉钉同一套，不为微信单开设置项 |
| 会话与侧栏 | 走 `session-facade` → catalog + Supervisor/引擎 transcript；**不**与桌面普通聊天自动双向同步 | 见 §7 |
| 协议应对 | 防腐层 + 版本化 Adapter + 契约测试 | 见第 6 节 |
| Spike 闸门 | Phase 0 未通过（R1/R4）前 **不排期** Phase 1+ | 见 §8 / §10 |

---

## 3. 现状与目标架构

### 3.1 现状（微信）

```
UI 扫码 → weixin/host-login（Host）→ 凭证写入 ~/.stoclaw/weixin/（legacy: openclaw/openclaw-weixin/）
                                      ↓
                         OC Gateway 加载 openclaw-weixin 插件
                                      ↓
                         getUpdates / sendMessage（插件内）
                                      ↓
                         OpenClaw 渠道路由 / session → 仅 OC 引擎
```

### 3.2 目标

```
┌─────────────────── utilityProcess: weixin-worker ───────────────────┐
│  ILinkTransport（版本化）                                             │
│  · Auth/QR（或接收主进程写入的凭证）                                    │
│  · LongPoll Monitor（getUpdates + 退避）                               │
│  · Outbound（sendMessage / typing / CDN）                              │
│  · AccountStore（本机凭证，目录独立于 openclaw）                         │
│  对外只暴露 WeixinWireEvent / WeixinWireCommand（稳定 IPC 契约）        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ MessagePort / postMessage
┌────────────────────────────▼────────────────────────────────────────┐
│  Main: WeixinChannelService                                           │
│  · 生命周期（fork/restart/健康检查）                                    │
│  · Wire → InboundEnvelope 映射                                        │
│  · 调用 session-facade / sendViaFacade（按绑定 engineType）            │
│  · EventBus → 侧栏流式（Supervisor）；Worker 仅收 typing + commit       │
│  · Host API：/api/channels/wechat/*                                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
          session-facade → Claude / Pi / OpenClaw（按绑定 engineType）
                             │
                    ChatRuntimeSupervisor → UI（既有）
```

说明：上图微信路径按绑定 `engineType`（默认 SAgent/Pi，可切 Claude Agent）走 `session-facade`；侧栏正文 **不经** Worker 流式投递。

钉钉 Hub / Mobile **已迁入** `message-channel/{hub,common,mobile}`（见 [`钉钉Hub与Mobile迁入message-channel计划.md`](./钉钉Hub与Mobile迁入message-channel计划.md)）。微信 Host 桥调用同一套 facade，在 **编排层汇合**；出站仍不复用 Hub `delivery`。

---

## 4. 模块设计

### 4.1 目录结构（已定）

```
electron/message-channel/
  README.md
  common/                   # session-facade / session-key / lifecycle / …
  hub/                      # Hub WS/HTTP/binding/ingress/delivery + routes.ts
  mobile/                   # history-facade
  dingtalk/
    README.md               # 说明：实现在 hub/ + common/
  weixin/
    service.ts              # 主进程：fork、IPC、对外 API
    bridge-inbound.ts       # WireEvent → 与 hub 对齐的入站结构
    bridge-outbound.ts      # 主进程 → Worker：typing / commit / cancel（MVP 无全文快照）
    binding.ts              # 账号 ↔ agentId ↔ engineType（单 Bot）
    types.ts                # 主进程可见类型（再导出 shared）

    runtime/                # Worker（vite 可打成 dist-electron/weixin-runtime，对齐 pi-runtime）
      worker-entry.ts
      fork-options.ts
      transport/            # ★ 自研 / 改造后的 ILink 实现（随服务端演进的主战场）
        types.ts            # iLink 原始 DTO（允许变）
        client-v1.ts        # 当前协议（可并存 client-v2）
        monitor.ts
        media-cdn.ts
        account-store.ts
        fixtures/           # 脱敏黄金样本
      adapter/
        normalize-inbound.ts  # 原始 DTO → WeixinWireEvent
        encode-outbound.ts    # WeixinWireCommand → 原始请求
      vendor/
        openclaw-weixin-main/  # ★ 已入库的上游快照（目录名以仓库实际为准）
          README.VENDOR.md     # 待补：来源 tag/commit、裁剪清单、许可证

shared/weixin-runtime-protocol.ts   # 主进程 ↔ Worker 唯一 Wire 契约（对齐 shared/pi-runtime-protocol）
```

原则：

- **Worker 内可以脏，根目录 `shared/` 契约必须稳**；不要使用 `electron/shared/runtime-protocol`（与 Pi 惯例冲突，且命名过泛）。
- 钉钉 Hub / Mobile 已迁入 `common/`、`hub/`、`mobile/`；`dingtalk/` 仅保留说明 README。

`electron/message-channel/README.md` 须包含至少：

1. 本目录为 IM 渠道伞（微信 / 钉钉 Hub / Mobile）。  
2. 钉钉与 Mobile 共用 `hub/`；编排在 `common/`；详见各子目录 README。  
3. 指向本文档与 `shared/weixin-runtime-protocol.ts`。

### 4.2 `shared/weixin-runtime-protocol.ts`（稳定契约）

主进程与 Worker 之间 **禁止** 直接传递 iLink 原始字段名（如 `get_updates_buf`、`ilink_bot_id`）。一律映射为产品语义：

**Worker → Main（事件）**

| 事件 | 用途 |
| --- | --- |
| `runtime.ready` / `runtime.failed` | 进程就绪 |
| `account.status` | 登录/暂停/失效（含 reasonCode） |
| `message.inbound` | 归一化入站消息 |
| `message.ack` / `outbound.result` | 发送结果 |
| `transport.health` | 轮询延迟、连续失败次数 |

**Main → Worker（命令）**

| 命令 | 用途 | MVP |
| --- | --- | --- |
| `runtime.start` / `runtime.stop` | 启停 monitor | 是 |
| `account.upsert` / `account.remove` | 凭证同步 | 是 |
| `outbound.typing` | 输入态；**主进程持节奏**：run 期间约每 **3s** 发一次，`commit`/`cancel` 即止；无 ticket 则跳过 | 是 |
| `outbound.commit` | **微信出站提交**：携带终态全文 + contextToken 等；Worker **仅在此**调用微信 `sendmessage` | 是 |
| `outbound.cancel` | **本地取消**：丢弃未 commit 状态、停 typing、抑制后续 commit；**不是**微信撤回（协议无 recall） | 是 |
| `outbound.sendText` | 全文草稿快照（供未来 GENERATING 中间态；命名上的「L2」仅指预留草稿通道，**勿与 §6.1 的 L2 Wire 层混淆**） | **否**（不实现、不投递；见 §4.4.1 / §11 #9） |
| `outbound.sendMedia` | 媒体 | Phase 3 |

**强制（MVP）**：主进程 → Worker 出站只需 `typing` + `commit`（+ `cancel`）。禁止把每条引擎 delta 打成 MessagePort 全文。`outbound.sendText` 仅作 Phase 3 / GENERATING 探测通过后的 infra 预留，**不进 MVP Wire 实现清单**。

> 命名提示：§6.1 的 L1/L2/L3 指「iLink 传输 / Worker IPC / 产品契约」分层；下文偶发「草稿/快照」不要再叫 L2，以免与 Wire 层号冲突。

`message.inbound` 建议字段（引擎无关）：

```ts
{
  accountId: string;
  peerId: string;
  messageId: string;
  contextToken?: string;      // 回复必须回传时由 transport 保证
  createdAtMs: number;
  text?: string;
  parts?: Array<{ kind: 'text' | 'image' | 'file' | 'voice' | 'video' | 'unknown'; ... }>;
  rawProtocolVersion: string; // 仅诊断，不进业务分支
}
```

### 4.3 `openclaw-weixin` 源码改造放哪里

| 内容 | 路径 | 说明 |
| --- | --- | --- |
| 上游快照 | `message-channel/weixin/runtime/vendor/openclaw-weixin-main/`（已放入） | MIT 拷贝；**删除/不启用** OC plugin 注册入口；剥离 `openclaw/plugin-sdk/*` import |
| 自研传输与改造 | `message-channel/weixin/runtime/transport/` + `adapter/` | 真正跑在 Worker 里的代码；对服务端变更的修改主要落这里 |
| Wire 契约 | `shared/weixin-runtime-protocol.ts` | 与上游无关；禁止把 iLink 字段泄漏到此文件 |
| Host 编排 | `message-channel/weixin/*.ts`（service/bridge…） | 不出现上游包名 import |

**R1 风险确认（已精确化）**：

- `import type` 自 `openclaw/plugin-sdk/*`：**编译期擦除**，不构成运行时耦合。  
- **真正要剥的是值导入**（运行时 `require`），当前 vendor 清单约为：

| peer 依赖 | 引用处 |
| --- | --- |
| `normalizeAccountId`（account-id） | `channel.ts`、`accounts.ts` |
| `resolvePreferredOpenClawTmpDir`（infra-runtime） | `channel.ts`、`logger.ts`、`process-message.ts` |
| `withFileLock`（infra-runtime） | `pairing.ts` |
| `getGlobalHookRunner`（plugin-runtime） | `outbound-hooks.ts` |
| `hook-runtime` 导出块 | `outbound-hooks.ts` |
| `createTypingCallbacks`（channel-message） | `process-message.ts` |
| `command-auth` 导出块 | `process-message.ts` |
| `buildChannelConfigSchema`（channel-config-schema） | `index.ts`（插件入口；可整文件不引用） |

Spike 若只走 **薄传输**（`api` + 自研 monitor/send，不搬 `process-message` / hooks / pairing / channel 插件入口），清单可再缩。理想态彻底剥离 = 为**实际用到的**值导入写本地等价物，才能从依赖里去掉 `openclaw` 与 npm 版 `@tencent-weixin/openclaw-weixin`。多数函数（tmp 目录、accountId 归一、文件锁）体量有限，源码可在 `node_modules/openclaw` 对照——**R1 可估时，不是重写整层传输**。通过前不排 Phase 1+ 工期。

改造策略（由短到长）：

1. **Vendor 入库**：传输相关源码已在 `vendor/openclaw-weixin-main/`；补齐 `README.VENDOR.md`（来源 tag/commit、裁剪清单、许可证）。channel 插件生命周期、OpenClaw session/pairing 等一律去掉或保留但不引用。  
2. **薄封装起步（Phase 0）**：`transport/client-v1.ts` 可暂时 re-export / 包装 vendor 内模块，验证脱离 OC 能收发。  
3. **收敛（Phase 1+）**：把稳定逻辑抄入或改写进 `transport/*`，vendor 降级为对照与 diff 来源；**运行时禁止** `require('@tencent-weixin/openclaw-weixin')` npm 插件形态（R1 失败退路见 §10，属过渡例外）。  
4. **禁止**：在 `vendor/` 里长期堆产品业务（binding、facade、引擎选择）；禁止 Host 层直接 import vendor。

一句话：**上游放 `runtime/vendor/openclaw-weixin-main/`；改造与自研放 `runtime/transport/` + `adapter/`；产品编排放 `weixin/` 根下 Host 文件。**

### 4.4 主进程编排（复用钉钉模型）

| 步骤 | 实现 |
| --- | --- |
| 入站排队 | 按 `peerId` 串行队列（单 Bot；对齐 `ingress` 的 `enqueuePeer`） |
| 会话 | `createOrGetSession({ channelType: 'wechat', peerId, engineType, agentId })` |
| 发送 | `sendViaFacade` / `runMainChatSend`（与页面对话同链） |
| 引擎 | 写入绑定 `engineType`（默认 `'pi'`）；UI 可切换 Claude Agent / SAgent |
| 回写 | MVP：主进程 `outbound.typing`（~3s）+ 终态 `outbound.commit`；**不**投递全文草稿快照（见 §4.4.1）；**不**走钉钉 `delivery` |

`channelType` 统一使用 UI/产品侧 `wechat`（删除对 OC 内部名 `openclaw-weixin` 的依赖；迁移期可读旧配置并改写）。

实现时须扩展 `PlatformChannelType` / `buildChannelSessionKey`（当前仅 `dingtalk | mobile`）以支持 `wechat`；并清理 `session-key.ts` 中 `@deprecated` 的钉钉专用构造函数，避免新代码误用。

#### 4.4.1 跨进程流式回写（R2）

**前置事实（SDK 源码已核实）**：钉钉 `delivery` 靠 `sendDelta` 对**同一 chatUid 卡片原地覆盖**。微信 **没有** 消息编辑/更新/撤回 API——vendor 仅七个 Bot 端点；`MessageState.GENERATING` 有类型定义但 **send 路径从未使用**（一律 `FINISH`）。重复往微信 `sendmessage` 全文 = 多条刷屏。

→ **MVP 结论**：侧栏流式正文由主进程 Supervisor/EventBus **直供 UI**，不经 Worker。Worker 只负责微信侧 typing + 终态一条消息。

**MVP Wire（Main → Worker）——仅两条出站 + cancel**

1. **`outbound.typing`**：run 进行中由主进程约每 **3s** 发一次；`commit` / `cancel` 即止。无 `typing_ticket` 则 Worker 静默跳过。  
2. **`outbound.commit(finalText, …)`**：agent 终态发一次；Worker → 微信单条 `message_state: FINISH`。全文以 commit 载荷为准。  
3. **`outbound.cancel`**：丢弃本地未发状态、停 typing、抑制 commit；**不是**调用微信撤回（协议无 recall）。

**MVP 明确不做**

- **不投递** `outbound.sendText` 全文草稿快照：commit 已带终态全文；草稿缓冲区无消费者；侧栏不走 Worker。450ms delivery 式节流 / MessagePort 全文体积问题 **对 MVP 不适用**。  
- **不做** 微信侧原地覆盖或过程全文；**不复用**钉钉 `delivery` 的卡片覆盖实现。

**预留（非 MVP）**

4. 工具进度气泡（`TOOL_CALL_*`）→ Phase 3。  
5. **`outbound.sendText` 草稿快照** → 仅当可选探测证明 `GENERATING` + 同 `run_id` FINISH 可被客户端合并时，再作为 Phase 3 infra 启用；Spike 可探查，不阻塞 MVP。  
6. 可选 Spike 探测：`GENERATING` + 同 `run_id` FINISH（非文档化行为）。

Phase 1 估时：MessagePort 仅 typing/commit/cancel，**不要**按「复刻 delivery 全文节流」估。

### 4.5 登录与凭证

- 扫码可保留在主进程（现有 `weixin/host-login.ts`），成功后：
  1. 写入 **新目录**（例如 `~/.stoclaw/channels/weixin/`）
  2. `account.upsert` 通知 Worker
- 去掉对 `getOpenClawResolvedDir()` / `qrcode-terminal` 从 OC 包解析的依赖；改为自有依赖或轻量 QR 生成。
- 首次启动：若存在旧路径 `~/.stoclaw/openclaw/openclaw-weixin/`，执行一次性迁移拷贝，并标记 `migratedFrom: openclaw-weixin`。  
- **R4（Phase 0 必测）**：Host 写入的账号文件目前为 `{ token, baseUrl?, userId?, savedAt }`（见 `saveWeChatAccountState`），**未见机器绑定密钥**；但 vendor 侧还有 `sync-buf` / allowFrom 等旁路文件。拷贝迁移 **不得** 以「单次 getUpdates 成功」判过；须满足 §8 Phase 0 的 R4 连续轮次标准。失败则引导重新扫码，并把必需旁路文件列入迁移清单。

### 4.6 与 GatewayManager / Supervisor 的关系

本期 **不删除** OpenClaw Gateway 进程（若产品仍用 OC 引擎做别的事）。

微信路径要求：

- 入站执行按绑定 `engineType`（Claude Agent / SAgent）；流式事件仍进入现有 EventBus（今天的 `GatewayManager`）。
- `WeixinChannelService` 订阅方式与 `delivery.ts` 一致，**不**直接依赖 OC WS RPC。
- 后续抽 `RuntimeEventBus` 时，微信桥只改注入类型，不改协议。

引擎位置不对称 **无阻塞**：微信 Worker 从不加载 Claude SDK / Pi agent。

---

## 5. 删除 OC 渠道：清单与边界

### 5.1 删除 / 停用

| 区域 | 动作 |
| --- | --- |
| `package.json` | 移除 `@wecom/wecom-openclaw-plugin`、`@sliverp/qqbot`（及仅渠道用的依赖）；移除 `@tencent-weixin/openclaw-weixin` 的 **OC 插件 wiring**（打包映射/install 候选源）。**若 R1 走退路**，该包的 **npm 依赖本身须推迟到彻底剥离完成**才能从 `package.json` 删除（退路下 Worker 仍 `import` 它作传输库；见 §8 Phase 0 R1 / §10 R1） |
| `scripts/bundle-openclaw-plugins.mjs` / `after-pack.cjs` | 去掉微信/企微/QQ 打包与映射 |
| `electron/gateway/config-sync.ts` | `CHANNEL_PLUGIN_MAP` 渠道项清空或删除自动升级 |
| `electron/utils/plugin-install.ts` | `ensureWeChatPluginInstalled` / wecom / qqbot 及候选源 |
| `electron/utils/channel-config.ts` / `openclaw-auth.ts` | 渠道插件 enable、legacy wecom id 迁移等死代码 |
| `electron/api/routes/channels.ts` | 去掉「先 install OC 插件再登录」；改为拉起 WeixinChannelService |
| Channels UI / i18n | **下线所有非钉钉旧入口**（企微/QQ/旧 OC 微信等）；仅保留钉钉 + 新微信 Host Worker 连接文案 |
| 测试 | 删除或改写依赖 OC 插件安装的渠道单测 |

### 5.2 明确保留（本期）

- `electron/gateway/**` 进程管理（OC 引擎若仍启用）
- `ChatRuntimeSupervisor`、`electron/message-channel/{common,hub}` 下的 session-facade / 钉钉 Hub
- Claude / Pi / `agent-extensions`
- EventBus 语义（可仍挂在 `GatewayManager` 类上）
- `electron/message-channel/` 物理路径（钉钉 Hub / Mobile 已迁入）

### 5.3 配置迁移

- 读旧 `channels['openclaw-weixin']` / `plugins.entries['openclaw-weixin']` → 写入 Host 侧连接配置 `{ type: 'wechat', engineType: 'pi', agentId, accountId }`（**仅保留一个 accountId**；若旧数据有多账号，迁移时只取第一个或要求用户重选/重扫）。
- 迁移后不再写回 `openclaw.json` 的微信段

---

## 6. 应对微信服务端变化（核心设计）

微信 iLink 属于外部后端，字段、错误码、鉴权头、CDN、登录态机都可能变。目标是：**变化止于 transport，不动引擎与 UI。**

### 6.1 三层隔离

```
┌─────────────────────────────────────────┐
│ L3 产品契约：InboundEnvelope / facade     │  ← 最稳定（对齐钉钉）
├─────────────────────────────────────────┤
│ L2 Worker IPC：WeixinWire*               │  ← 次稳定（semver）
├─────────────────────────────────────────┤
│ L1 iLink Transport：client-vN + raw DTO  │  ← 允许高频变更
└─────────────────────────────────────────┘
```

规则：

1. **L1 禁止 import 到** `session-facade`、Supervisor、前端、engines。
2. L1 变更只改 `electron/message-channel/weixin/runtime/transport/**` 与 `adapter/**`。
3. L2 变更必须 bump `WEIXIN_WIRE_PROTOCOL_VERSION`；主进程拒绝不兼容 Worker。
4. 业务代码只允许依赖 L2/L3 的 `kind` / `reasonCode` 枚举，禁止解析 `errmsg` 字符串做分支（除日志）。

### 6.2 Transport 多版本并存

```ts
interface ILinkTransport {
  readonly protocolId: string; // e.g. "ilink-2026.3"
  startMonitor(accountId: string): void;
  stopMonitor(accountId: string): void;
  send(command: NormalizedOutbound): Promise<void>;
}
```

- 默认 `client-v1`（对齐当前公开协议与 `openclaw-weixin` 行为）。
- 当服务端出现不兼容变更时：**新增 `client-v2`**，用 feature flag / 账号级 `transportProtocol` 切换，而不是原地改 v1。
- 保留 v1 一个发布周期，便于灰度回滚。

配置示例：

```json
{
  "weixin": {
    "transportProtocol": "ilink-2026.3",
    "botAgent": "SClaw/2026.9.10",
    "apiBaseUrlOverride": null
  }
}
```

### 6.3 能力探测与降级（Capability）

不要假设服务端能力永恒。Worker 启动后：

1. 调用 `getConfig`（或等价接口）缓存能力。
2. 归一为 `WeixinCapabilities`：

| capability | 缺失时行为 |
| --- | --- |
| `typing` | 静默跳过 typing 命令（需 `getConfig` 返回 `typing_ticket`） |
| `messageEdit` | **恒为 false**（无 edit/update/recall）；出站为过程中 typing + 终态单条 FINISH（见 §4.4.1） |
| `mediaUpload` | 出站媒体转「文本提示 + 失败原因」；入站 unknown 部分降级文案 |
| `quoteContext` | 不依赖引用缓存即可回复 |
| `multiAccount` | **恒为 false**（产品固定单 Bot）；UI/Worker 拒绝第二个账号登录 |

主进程 UI 只读 capabilities，不解析协议细节。

### 6.4 错误模型稳定化

将 iLink 的 `ret` / `errcode` / HTTP 状态映射为稳定 `reasonCode`：

| reasonCode | 含义 | 产品动作 |
| --- | --- | --- |
| `AUTH_EXPIRED` | token 失效 | 标记账号需重新扫码 |
| `ACCOUNT_PAUSED` | 如历史 `-14` 暂停 | 指数退避 + UI 提示，不杀 Worker |
| `RATE_LIMITED` | 限流 | 退避 |
| `PROTOCOL_REJECTED` | 字段/版本不被接受 | 打点 + 可切换备用 transport |
| `TRANSIENT` | 网络/5xx | 重试 |
| `UNKNOWN` | 未识别 | 日志采样上报，默认 TRANSIENT 策略 |

**禁止** 在 facade/引擎层写死 `-14` 等魔法数；魔法数只存在于 L1 映射表，且表可配置/可热更新（见 6.6）。

### 6.5 登录态机与重定向

服务端登录可能增加 `need_verifycode`、`redirect_host`、`binded_redirect` 等状态。要求：

- 登录态机放在 L1，输出稳定阶段：`wait | scanned | need_user_action | confirmed | expired | rejected`。
- `need_user_action` 携带 `actionType` + 可展示文案；UI 只渲染 actionType。
- API baseUrl 以服务端返回为准，允许运行时切换；覆盖配置仅用于调试。

### 6.6 契约测试与「协议黄金样本」

为降低服务端静默变更风险：

1. **录制样本**：将真实（脱敏）请求/响应 JSON 存入 `electron/message-channel/weixin/runtime/transport/fixtures/`。
2. **契约测试**：normalize/encode 的单测只吃 fixtures；升级 client-vN 时先加失败样本再改代码。
3. **兼容开关**：`STO_WEIXIN_TRANSPORT=ilink-2026.3|ilink-legacy|mock`。
4. **观测（若未来做遥测）**：仅允许 `protocolId` + `reasonCode` + 计数；**禁止** `peerId` / `messageId` / `contextToken` / 正文 / token。本地日志可保留短时诊断字段，不得进上报管道。§6.6 所谓「脱敏」不得理解为「打码后仍可上报 peer/消息标识」。

### 6.7 与上游 `openclaw-weixin` 的关系

详见 **§4.3**。摘要：

| 策略 | 说明 |
| --- | --- |
| 短期 | 源码快照进 `runtime/vendor/openclaw-weixin-main/`；`transport/` 薄封装验证 |
| 中期 | 以自有 `transport/*` 为准；vendor 仅作行为对照与上游 diff |
| 跟踪 | 订阅上游 CHANGELOG / protocol 文档；差异进入 fixtures，而不是运行时 npm 依赖 OC 插件 |
| R1 退路 | npm 传输包 + 禁用 plugin 时 **须保留 openclaw peer**；彻底剥离=替掉实际用到的值导入后才能删包 |

运行时 **不** 将该包 `require` 为 OC Gateway 插件。理想态不依赖 npm 包与 `openclaw` peer；退路下二者可暂时并存（见 §10）。

### 6.8 `bot_agent` 与客户端标识

- `bot_agent` 仅观测用；配置为 `SClaw/<appVersion>`，避免假冒 `OpenClaw` 造成归因混乱。
- `channel_version` / `iLink-App-ClientVersion` 使用 **我们的 transport 版本**，与 App 版本可分开 bump，便于服务端识别协议实现代际。

---

## 7. 会话、绑定、持久化与同步语义

### 7.1 绑定模型

每个微信账号连接：

```ts
{
  channelType: 'wechat';
  accountId: string;          // ilink bot id
  agentId: string;            // base agent
  engineType: AgentEngineType; // 默认 'pi'；UI 可切换 claude / pi / openclaw
  enabled: boolean;
}
```

- 私聊会话键（**单 Bot 固定**）：  
  `agent:{agentId}:wechat:{peerId}:{yyyyMMddHHmmss}:{nonce}`  
  不引入多账号维度；换号须先解绑当前 Bot 再扫码（旧会话可保留在侧栏历史）。
- **contextToken 降级（补明）**：

| 情况 | 行为 |
| --- | --- |
| 入站带有 `contextToken` | 出站必须原样回传 |
| 丢失 / 未带 | **仍调用 sendMessage**（与上游 `send.ts` 一致：warn 后继续发）；同时打 `CONTEXT_MISSING` 本地日志 |
| 若服务端拒绝无 token 的回复 | 映射为 `PROTOCOL_REJECTED` 或 `CONTEXT_REJECTED`；对该 peer **提示用户发一条新消息重开上下文**，不静默重试刷屏 |
| 不降级为 | 不改写到其它 peer、不回落到桌面普通会话、不伪造 token |

### 7.2 消息必须双写：引擎本地 + SQLite 侧栏

微信渠道收发 **不是**「只在微信里看得见」。须与钉钉渠道同一产品语义：

| 层 | 写什么 | 作用 |
| --- | --- | --- |
| SQLite `catalog_sessions` | `session_type=channel`，`channel_type=wechat`，`channel_id`（peer）、`title`、`last_activity_at` | **侧栏会话列表**出现/排序/角标来源 |
| SQLite `session_engine_bindings`（若渠道路径已写） | `engineType`、cwd 等 | 打开侧栏会话时知道用哪个引擎 |
| ChatRuntimeSupervisor + 引擎 transcript | 用户/助手消息正文与 run 状态 | 点进侧栏能看到完整对话；与页面对话同链 |

强制要求：

1. 入站处理必须走 `createOrGetSession` → `upsertCatalogSession`（已有 facade 能力），禁止只调引擎不写 catalog。  
2. 发送必须走 `sendViaFacade` / `runMainChatSend`，从而进入 Supervisor 持久化；禁止 Worker 内自己攒一份「微信专用聊天库」绕过主链。  
3. 入站首条有效文案触发 `ensureChannelSessionTitleFromPrompt`（或等价），避免侧栏标题空白。  
4. MVP 验收：微信来一条消息 → 侧栏出现 `channel/wechat` 会话 → 桌面点开可见历史；桌面在该会话续聊 → 回写微信（若该会话仍是渠道会话）。

「本地存储」在此指：引擎侧会话目录/transcript（Claude/Pi 既有落盘）+ 上述 SQLite；**不是**另起第三套存储。

### 7.3 桌面「同一会话空间」会不会自动同步到微信？

**默认不会。**

| 会话来源 | 是否出现在微信 | 说明 |
| --- | --- | --- |
| 微信 Bot 入站产生的 `channel/wechat` 会话 | 是（回写该 peer） | 渠道会话 |
| 桌面普通聊天 / 钉钉 / 其它会话 | **否** | 另一条 `sessionKey`，不自动推微信 |
| 用户在侧栏打开「微信渠道会话」并续聊 | 是 | 仍是同一渠道 session，delivery/bridge 回写 Worker |

即：SClaw 与微信 **共享的是「渠道会话」这一条线**，不是整个桌面会话空间镜像。  
若产品以后要「桌面某会话一键分享到微信」，须另做显式动作（选 session + 选 peer），**不在本方案默认范围**。

### 7.4 用这个 Bot 对话，是不是永远只有一个会话上下文？

**不是永远一个。** 对齐钉钉渠道策略：

| 条件 | 行为 |
| --- | --- |
| 同一微信账号 + 同一 peer，且未超空闲 TTL | **复用** 最近一条渠道 `sessionKey`（上下文连续） |
| 超过空闲 TTL（**复用全局** channel 空闲设置，与钉钉相同；默认约 24h） | **新建** sessionKey，上下文清空 |
| 用户发送「新对话 / 新会话 / 清空上下文 / `/new` / `/reset`」等（现有 `NEW_SESSION_COMMANDS`） | **强制新建** |
| 渠道绑定改选引擎（claude ↔ pi） | **强制新建**（策略 C） |
| 不同 peer | **天然隔离**，互不共享上下文 |
| 试图登录第二个微信 Bot | **拒绝**；提示先解绑当前账号 |

微信客户端侧可能仍显示为同一个「ClawBot」聊天窗口，但 SClaw 内部可以是多段 `sessionKey`；侧栏会按活跃会话展示（旧会话仍可在历史上保留，除非产品要合并 UI）。

iLink 的 `context_token` 用于 **单次回复对齐微信侧线程**，不等于 SClaw「永远单会话」；内部上下文边界由 `sessionKey` + idle/新会话命令决定。

### 7.5 隔离策略（相对 OC）

替代 OC `session.dmScope`：

- 默认：`per-peer`（单 Bot 下按对端隔离）  
- 换引擎：facade 强制新 sessionKey（策略 C）  
- 与桌面普通 chat：**不自动合并、不自动双向同步**（§7.3）  
- **禁止**同时登录多个微信 Bot

## 8. 分阶段交付

### Phase 0 — Spike（可行性闸门，**不可省 / 通过前不排期**）

- 建立 `electron/message-channel/`：`README.md` + `dingtalk/README.md`（占位）+ `weixin/` 骨架（目录已起步）。
- **R1**：基于 `vendor/openclaw-weixin-main`，验证传输能否在 **不加载 OC Gateway 插件生命周期** 下跑通单账号 `getUpdates` + `sendMessage`。  
  - **薄传输约束（验收必查）**：Spike **不得**为跑通收发而引用 `process-message` / `outbound-hooks` / `pairing` / `channel.ts` 插件入口；只允许 `api` + 自研（或裁剪后的）monitor/send/account-store。否则会把 §4.3 整表值导入拖回，失去「可估时剥离」前提。  
  - **理想态剥离清单**：仅为**实际引用到的** plugin-sdk **值导入**写本地等价（薄路径通常远少于 §4.3 全表）。类型导入可忽略。  
  - **失败退路**：npm 依赖 `@tencent-weixin/openclaw-weixin` + 禁用 plugin 注册，仅调传输 API——**此时 `openclaw` peer 仍须保留**；直至彻底剥离才能从 package.json 移除 `openclaw` 与该 npm 包。退路 = 摆脱 Gateway 插件用法，**不是**摆脱 openclaw 包。  
  - Spike 不得因理想态失败而全盘推翻。
- **R4**：拷贝旧 `~/.stoclaw/openclaw/openclaw-weixin/` 账号相关文件后：  
  - **通过标准**：连续 **≥ 5 轮** 成功的 `getUpdates`（含空轮询），且总观察窗口 **≥ 10 分钟**；不得以单次成功判过。  
  - 失败：记录必需旁路文件清单并走重新扫码。
- **R2**：MVP 仅验证 `typing` + `commit`（+ `cancel`）；**不**测全文草稿快照投递。可选 GENERATING 探测单独记录。
- 验收：脱离 OC **插件生命周期** 稳定跑通扫码（或凭证复用）与一轮收发；R1（含薄传输约束）/R4 达上述标准。
- **不通过且退路也失败** 则停止大范围删渠道与 Phase 1 排期。

#### Phase 0 实测结果（2026-09-15）— **通过**

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 目录骨架 | 通过 | `electron/message-channel/{README,dingtalk/,weixin/}`；`shared/weixin-runtime-protocol.ts`；`runtime/transport/` + `spike/` |
| R1 薄传输 | **通过（理想态，未走 npm 退路）** | vendor 薄路径值导入改为 `src/shims/{account-id,infra-runtime}.ts`；`transport/*` 不引用 process-message/hooks/pairing/`channel.ts`；`getUpdates` smoke ok；`SPIKE_SEND=1` 时 `sendMessage` 成功 |
| R4 凭证迁移 | **通过** | `~/.stoclaw/openclaw/openclaw-weixin` → `~/.stoclaw/weixin`（accounts.json + 账号/sync/context-tokens）；**33** 轮成功 `getUpdates`，观察 **613608 ms（≥10 min）** |
| R2 | 记录完成 | 未测全文草稿快照；MVP 范围确认 typing+commit(+cancel) |
| 报告文件 | — | `electron/message-channel/weixin/runtime/spike/phase0-report.json` |

结论：**Phase 1 可排期**。运行时不依赖 OC Gateway 插件生命周期；当前亦未使用 `@tencent-weixin/openclaw-weixin` npm 退路。

### Phase 1 — MVP

- Worker IPC 契约 + WeixinChannelService（`message-channel/weixin/`）。
- 接 `message-channel/common/session-facade`，按绑定 `engineType` 执行（默认 `'pi'`）。
- **单 Bot（硬约束）**；catalog + Supervisor 双写。已有绑定则 UI/API 拒绝再次 `start` 登录，除非先 unbind。
- 跨进程回写按 §4.4.1（typing + commit；无全文草稿快照；不复用钉钉 delivery）。
- 文本 + typing；凭证新目录 + 旧目录迁移。
- Host API / UI：钉钉 + 新微信；下线非钉钉旧入口。
- 停止安装 OC 微信插件。

#### Phase 1 落地进度（2026-09-15）

| 项 | 状态 |
| --- | --- |
| `shared/weixin-runtime-protocol.ts` + Worker `worker-entry` / Host `WeixinChannelService` | 已落地 |
| `bridge-inbound` → `createOrGetSession`（`channelType=wechat`）+ `sendViaFacade`（Pi） | 已落地 |
| `bridge-outbound` typing(~3s)+commit（不复用钉钉 delivery） | 已落地 |
| 单 Bot：`/api/channels/wechat/start` 409；删除渠道时 unbind | 已落地 |
| 凭证目录 `~/.stoclaw/weixin` + 旧目录迁移 | 已落地 |
| 停止 `ensureWeChatPluginInstalled` / `CHANNEL_PLUGIN_MAP` 微信项 / 启动批量安装微信插件 | 已落地 |
| UI `getPrimaryChannels` = dingtalk + wechat | 已落地 |
| vite `dist-electron/weixin-runtime` | 已配置 |
| 真机端到端验收（扫码→侧栏→回写） | **已通过**（2026-09-15：微信文字收发 + typing 清除） |

### Phase 2 — 清理 OC 渠道

- 删除企微/QQ OC 插件依赖、打包、UI、测试。
- 微信：删除其 **OC 插件 wiring**（`bundle-openclaw-plugins` 微信映射、`ensureWeChatPluginInstalled`、`CHANNEL_PLUGIN_MAP` 微信项、UI 旧入口）。**若 R1 走退路**，`@tencent-weixin/openclaw-weixin` 的 **`package.json` npm 依赖本身不在此期删**——退路下 Worker 仍 `import` 它作传输库，须等彻底剥离完成才能删（见 §8 Phase 0 R1 / §10 R1）。
- Channels UI：仅钉钉 + 新微信；下线企微/QQ/旧 OC 微信等非钉钉入口。
- `CHANNEL_PLUGIN_MAP` 非钉钉渠道项清空（钉钉仍走 OC 插件，待 Phase 4）。

#### Phase 2 落地进度（2026-09-15）

| 项 | 状态 |
| --- | --- |
| 停止打包/安装 OC `openclaw-weixin` / wecom / qqbot | **已落地** |
| 启动时剥离 OC 微信 plugin 注册，避免双通道 | **已落地** |
| 企微/QQ 配置入口拒绝保存 | **已落地** |
| `@tencent-weixin/openclaw-weixin` npm（非退路）保留至彻底剥离 | 暂留 package.json |
| 企微/QQ `package.json` 依赖移除 | **已落地** |


### Phase 3 — 媒体与体验

- 图片/文件入站出站、引用缓存（若需要）。
- 工具进度气泡等体验增强（若需要）。
- capabilities 驱动的 UI 降级。  
- **不做多账号**（见 §2 / §11）。

#### Phase 3 落地进度（2026-09-15）

| 项 | 状态 |
| --- | --- |
| Wire `outbound.sendMedia` + inbound `parts` | **已落地** |
| Worker：本地文件 CDN 上传发图/文件/视频 | **已落地** |
| Worker：入站图片/文件/视频下载解密；语音转写/降级文案 | **已落地** |
| Host：从助手回复 `file://` / 绝对路径抽出媒体并回写 | **已落地** |
| Host：入站 media → `sendViaFacade` | **已落地** |
| 引用缓存 / 工具进度气泡 | 未做（可选） |
| capabilities 驱动 UI 降级 | 未做（可选） |

### Phase 4 — 钉钉目录迁入（**已完成**）

- 见 [`钉钉Hub与Mobile迁入message-channel计划.md`](./钉钉Hub与Mobile迁入message-channel计划.md)：`electron/channels/*` → `message-channel/{common,hub,mobile}`；`api/routes/channel-hub.ts` → `hub/routes.ts`；旧路径已删。
- 行为零变化；与微信功能迭代拆开。

### Phase 5 —（可选，另立项）

- 抽 `RuntimeEventBus`、默认引擎切离 OC、Claude 迁 utilityProcess、删除 OC 引擎。

---

## 9. 测试计划

| 层级 | 内容 |
| --- | --- |
| 单测 | normalize/encode、reasonCode 映射、登录态机、IPC 序列化 |
| Fixture | 脱敏黄金样本；破坏字段的负例 |
| 集成 | mock transport + facade + **Pi** fake adapter（钉钉回归可另含 Claude） |
| 手工 | 真机扫码；微信消息出现在侧栏；点开有历史；空闲/新对话命令拆会话；断网恢复 |
| 回归 | 钉钉 Hub 路径不受影响；桌面普通会话不会自动冒到微信 |

---

## 10. 风险与缓解

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| iLink 服务端不兼容变更 | 高 | L1/L2/L3 隔离、双 client 版本、fixtures、灰度 flag |
| 自研客户端被风控 | 中 | 合规 `bot_agent`、退避、可快速停用渠道开关 |
| 剥离 openclaw-weixin 工作量超预期 | 中 | Phase 0 spike；先文本后媒体 |
| 流式回写（R2） | 低（MVP） | MVP 仅 typing + commit，无全文草稿快照；侧栏走 Supervisor；不复用钉钉 delivery。GENERATING/草稿快照属 Phase 3 预留 |
| vendor 无法脱离 OC（R1） | 高 | 理想态=替换实际用到的值导入函数（§4.3 清单，可估时）。**退路**=npm 传输包 + 禁用 plugin，**须保留 `openclaw` peer 与 `@tencent-weixin/openclaw-weixin` npm 依赖**直至彻底剥离完成才能从 `package.json` 删除（见 §8 Phase 0 R1） |
| 旧凭证拷贝失效（R4） | 中 | Phase 0：连续 ≥5 轮 getUpdates 且观察 ≥10 分钟；失败则重扫 + 补迁移清单 |
| contextToken 丢失 | 中 | §7.1 降级表；禁止伪造 token |
| 误删 EventBus 影响 Claude/Pi | 高 | 本期不拆 GatewayManager；渠道清理与引擎删除解耦 |
| 旧凭证迁移失败 | 低 | 迁移失败则引导重新扫码，不阻断启动 |

---

## 11. 开放问题与已决策项

### 已决策

1. **引擎**：UI **可切换 Claude Agent / SAgent**；`engineType` 写入绑定并走 session-facade，新建默认 `'pi'`。  
2. **Channels 入口**：下线 **所有非钉钉** 的旧渠道入口；微信只保留新 Host Worker 入口。  
3. 钉钉目录：本期仅 `message-channel/dingtalk/README.md` 占位；微信上线后再迁。  
4. 消息进 catalog + 主链 transcript，侧栏可见；与桌面普通会话默认不同步。  
5. **空闲拆会话 TTL：复用全局** channel 设置。  
6. **微信 Bot 数量固定为 1**；不支持多账号并排登录；换号须先解绑。  
7. **一对一 Agent**；**仅私聊**。
8. **reasonCode 暂不上报**；若上报仅允许 reasonCode + 计数，禁止 peerId/messageId/正文/token。  
9. **回写（R2）**：MVP **不投递** `outbound.sendText` 草稿快照；仅 `outbound.typing`（~3s）+ `outbound.commit(终态全文)`（+ `cancel`=本地取消非撤回）。**不复用**钉钉 `delivery`。`sendText` 留作 GENERATING 探测通过后的 Phase 3 infra。  
10. **R1 退路**：npm 传输包 + 禁用 plugin 时 **须保留 openclaw peer**；彻底剥离 = 替掉实际用到的值导入后才能删 `openclaw` / npm 微信包。Phase 0 **薄传输约束**：不得为 Spike 拖入 `process-message` / hooks / pairing / `channel.ts`。  
11. **R4 通过标准**：连续 ≥5 轮 getUpdates 且观察 ≥10 分钟，单次成功不算过。

### 仍待确认

无产品向开放项。**Phase 0 R1/R4 已于 2026-09-15 实测通过**（见 §8 Phase 0 实测结果）；可进入 Phase 1。

---

## 12. 参考

- 上游说明：[Tencent/openclaw-weixin README.zh_CN](https://github.com/Tencent/openclaw-weixin/blob/main/README.zh_CN.md)
- 协议：[protocol_zh_CN.md](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)
- 本仓库：`electron/message-channel/{common,hub,host,mobile,weixin}/`（含 `weixin/host-login.ts`）、`electron/services/pi-runtime-service.ts`
- 扩展架构：`docs/agent-extension-architecture.md`

---

## 13. 一句话

**先立 `message-channel` 做微信（钉钉目录后迁）；Worker 只做 iLink 传输 + typing/commit；侧栏走 facade/Supervisor；微信固定单 Bot + Pi；OC 渠道插件路径删除（npm/peer 按 R1 理想态或退路分阶段去掉）。**
