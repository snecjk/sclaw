# 钉钉 Hub 与 SClaw Mobile 迁入 `message-channel` 计划

> 状态：**已实施**（2026-09-16：`electron/channels/` 与 `api/routes/channel-hub.ts` 已迁入 `message-channel/{common,hub,mobile}` 并删除旧路径）
> 日期：2026-09-16
> 前置关系：**本迁移已完成**；可继续执行 [`非钉钉微信Mobile以外渠道清理计划.md`](./非钉钉微信Mobile以外渠道清理计划.md)
> 背景：与 [`微信渠道-Host-Worker技术方案.md`](./微信渠道-Host-Worker技术方案.md) §4.1 / Phase 4 一致——微信 / 钉钉 Hub / Mobile 均在 `message-channel/` 伞下

---

## 1. 目标与非目标

### 1.1 目标

1. 将 **钉钉 Hub** 与 **SClaw Mobile（`mobile` / `sto-mobile`）** 的可运行实现迁入 `electron/message-channel/`，与微信同伞。
2. 将 Host API 路由 `electron/api/routes/channel-hub.ts` **一并迁入** `message-channel/hub/`（URL `/api/channels/hub/*` 不变；`server.ts` 只改 import）。
3. **行为零变化**：绑定、WS、入站、出站、session key、catalog、历史 RPC、UI 路由不变。
4. 迁完后 `electron/channels/` **清空或仅留短暂 re-export**，最终删除目录；`api/routes/channel-hub.ts` 同理（可短暂 shim 后删除）。
5. 为后续「删第三方渠道 / 删钉钉 OC 插件」提供干净边界：清理计划只动 OC/第三方，不误伤已迁入的 Hub/Mobile。

### 1.2 非目标

- 不改 Hub 协议、不改 Mobile 对接语义。
- 不迁 UI（`DingTalkHubBindModal` / `MobileAppConfigModal` 仍在 `src/components/channels/`）。
- 不拆 `channels.ts` 里微信/通用列表路由（仍留 `api/routes/`；仅改其对 hub 的 import）。
- 不删 `@soimy/dingtalk`、不删第三方渠道（那是清理计划）。
- 不把微信 Worker 再搬一次。

---

## 2. 现状盘点

### 2.1 `electron/channels/`（14 个文件）

| 文件 | 角色 | 归属建议 |
| --- | --- | --- |
| `hub-api.ts` | Hub HTTP（钉钉 bind + Mobile register/disable 等） | **hub/**（钉钉+Mobile 共用） |
| `hub-client.ts` | Hub WebSocket 客户端 | **hub/** |
| `hub-config.ts` | Hub base URL / WS URL | **hub/** |
| `binding-service.ts` | `channel_connections`：dingtalk / mobile（含 `sto-mobile` 存储别名） | **hub/** |
| `startup.ts` | 入站监听、ensure connect、钉钉换绑 | **hub/** |
| `ingress.ts` | Hub 入站 → session-facade；区分 dingtalk / mobile | **hub/** |
| `delivery.ts` | Hub 流式出站（钉钉卡片语义为主；Mobile 同链） | **hub/** |
| `history-facade.ts` | **Mobile** 历史列表/详情 RPC | **mobile/** |
| `session-facade.ts` | 三渠道共用编排（dingtalk / mobile / **wechat**） | **common/** |
| `session-key.ts` | `PlatformChannelType = dingtalk \| mobile \| wechat` | **common/** |
| `session-lifecycle.ts` | 空闲拆会话等（钉钉/微信有 TTL；mobile 永不） | **common/** |
| `channel-session-title.ts` | 会话标题推导 | **common/** |
| `stream-content-kind.ts` | think/tool/answer | **common/** |
| `inbound-media.ts` | Hub 入站媒体物化 | **hub/**（仅 Hub 入站用；若微信也复用可放 common） |

另：Host API 路由（当前不在 `channels/`，但属 Hub 面，**本期一并迁**）：

| 文件 | 角色 | 归属建议 |
| --- | --- | --- |
| `electron/api/routes/channel-hub.ts` | `/api/channels/hub/{dingtalk,mobile}/*` | **hub/routes.ts**（导出 `handleChannelHubRoutes`） |

### 2.2 关键依赖（迁完必须改 import）

| 消费者 | 当前 import |
| --- | --- |
| `electron/api/server.ts` | `./routes/channel-hub` → 改为 `../message-channel/hub/routes` |
| `electron/api/routes/channel-hub.ts`（迁入前） | binding / hub-api / hub-client / hub-config / ingress / startup |
| `electron/api/routes/channels.ts` | binding / hub-client / startup（列表合并 Hub 钉钉） |
| `electron/api/routes/auth.ts` | hub-client / startup |
| `electron/message-channel/weixin/bridge-inbound.ts` | → hub `ingress` + common `session-facade` / `session-lifecycle` |
| `electron/message-channel/weixin/binding.ts` | → hub `binding-service` |
| `electron/channels/startup.ts` | 动态 import weixin service |
| 单测 `channel-hub-independent-bind` | routes + **6×** `@electron/channels/{binding-service,hub-api,hub-client,hub-config,ingress,startup}` mock |
| 单测 `sclaw-hub-client-connect` | **2×** mock `hub-config`/`binding-service` + **2×** `await import(hub-client)` |
| 其它单测 | 相对路径 `electron/channels/*`：`channel-mobile-*`、`dingtalk-session-lifecycle`、`inbound-media`、`stream-content-kind`、`channel-ingress-session-title` 等 |

### 2.3 为何不能只塞进 `dingtalk/`

钉钉与 Mobile **共用同一条 Hub WS / refreshToken / syncChannels**（见 `startup.ensureSclawHubConnected`、`binding-service.resolveSharedHubRefreshToken`）。  
若把 Hub 客户端塞进 `dingtalk/`，Mobile 会反向依赖钉钉目录，边界错误。

因此：**Hub 传输层独立成 `hub/`**；`dingtalk/` / `mobile/` 只放渠道特有薄层（或 README + re-export）。

---

## 3. 目标目录

```
electron/message-channel/
  README.md                         # 更新：三渠道均在伞下
  common/                           # 编排共用（微信也依赖）
    session-facade.ts
    session-key.ts
    session-lifecycle.ts
    channel-session-title.ts
    stream-content-kind.ts
    index.ts                        # 可选：再导出
  hub/                              # SClaw Hub（钉钉 + Mobile 共用）
    hub-api.ts
    hub-client.ts
    hub-config.ts
    binding-service.ts
    startup.ts
    ingress.ts
    delivery.ts
    inbound-media.ts                # 若确认仅 Hub 用；否则改放 common
    routes.ts                       # 原 api/routes/channel-hub.ts（Host API）
    README.md                       # 说明与 dingtalk/mobile 关系
  dingtalk/
    README.md                       # 实现说明；可再导出 hub 钉钉相关符号（可选）
  mobile/
    history-facade.ts
    README.md
  weixin/                           # 已有，不动结构
    ...
```

迁完后：

```
electron/channels/                      # 删除，或临时留一层 re-export（≤1 个 PR 周期）
electron/api/routes/channel-hub.ts      # 删除，或临时 re-export → message-channel/hub/routes
```

`electron/api/server.ts`：`import { handleChannelHubRoutes } from '../message-channel/hub/routes'`。  
HTTP 路径仍为 `/api/channels/hub/...`，不改协议面。

---

## 4. 原则

1. **机械迁移优先**：`git mv` + 改相对路径；不改逻辑。
2. **微信 import 同步改**（两套目标，不可只指 common）：
   - → `../common/*`：`session-facade`、`session-lifecycle`（及同类编排）
   - → `../hub/*`：`ingress`（`bridge-inbound`）、`binding-service`（`binding.ts`）
   - hub **不**静态回引 weixin；weixin 方向解环靠动态 import（见 §9）
3. **一层兼容 re-export（可选但推荐）**：
   - `electron/channels/foo.ts` → `export * from '../message-channel/...'`
   - `electron/api/routes/channel-hub.ts` → `export { handleChannelHubRoutes } from '../../message-channel/hub/routes'`
   - 第二阶段删 shim、改所有调用方（含 `server.ts`、单测）。避免大爆炸。
   - **注意：** `@electron/channels` 是前缀别名（`vitest.config.ts` / `tsconfig`），删掉 `electron/channels/` 后 **无法** 用单个别名同时映射 `hub/` + `common/`；测试里的 `vi.mock` / `await import('@electron/channels/...')` **必须逐条**改成 `@electron/message-channel/hub/...` 或 `.../common/...`。
4. **测试路径跟着改**；行为断言不变。
5. **不与清理计划混 PR**：本迁移合完且冒烟通过后，再开「非钉钉微信外渠道清理」。

---

## 5. 分阶段落地

### 第 0 期 — 目录骨架（无行为变更）

1. 创建 `message-channel/common/`、`message-channel/hub/`、`message-channel/mobile/`（空或仅 README）。
2. 改写 `message-channel/README.md`、`dingtalk/README.md`：状态改为「迁移中 / 目标结构如下」。
3. 新建 `hub/README.md`、`mobile/README.md`、`common/README.md`（各 10～20 行说明职责）。

**完成标准：** 目录存在；无业务代码搬迁；`pnpm typecheck` 仍绿。

---

### 第 1 期 — 搬 `common/`（微信依赖面）

`git mv`：

- `session-facade.ts`、`session-key.ts`、`session-lifecycle.ts`
- `channel-session-title.ts`、`stream-content-kind.ts`

步骤：

1. 移入 `message-channel/common/`。
2. `electron/channels/` 留 re-export shim（同名文件 `export * from '../message-channel/common/xxx'`）。
3. **必改边：** `session-facade.ts` 现有静态 `import { getChannelConnection } from './binding-service'`（hub-bound）。迁入 common 后须改可达路径：
   - 若本 PR 尚未搬 hub：临时 `../../channels/binding-service`（经 shim）；
   - 最终态（hub 已就位）：`../hub/binding-service`。
   - **漏改则 typecheck 才报错**——implementer 不得假设「common 不依赖 hub」。
4. 微信侧：仅把 **common 归属** 的 import 改到 `../common/...`（`session-facade`、`session-lifecycle`）。`ingress` / `binding-service` 仍指 `../../channels/...` 或留到第 2 期改 `../hub/...`。
5. 跑：lifecycle / stream-content-kind / weixin bridge 相关单测 + 微信扫码冒烟（若环境允许）。

**动态 import（解 weixin 环）：** `session-facade` → weixin binding，迁后改为 `../weixin/binding`，勿写回 `channels/`。

---

### 第 2 期 — 搬 `hub/`（钉钉 + Mobile 共用）+ Host API 路由

`git mv`：

- `electron/channels/`：`hub-api.ts`、`hub-client.ts`、`hub-config.ts`、`binding-service.ts`、`startup.ts`、`ingress.ts`、`delivery.ts`、`inbound-media.ts`（若仅 Hub 用）
- `electron/api/routes/channel-hub.ts` → `electron/message-channel/hub/routes.ts`

步骤：

1. 实现文件移入 `message-channel/hub/`，修正包内相对 import。
2. `routes.ts` 内对 `HostApiContext` / `parseJsonBody` / `sendJson` / `logger` 的 import 改为指向 `../../api/...`、`../../utils/logger`（路径变深一层）。
3. `channels/` 留 shim；`api/routes/channel-hub.ts` 留 re-export shim（可选）。
4. 改 `server.ts` 直接或经 shim 引用 `message-channel/hub/routes`；改 `channels.ts`、`auth.ts` 对 hub 实现的 import。
5. **单测别名逐条改写**（`@electron/channels` 前缀别名删目录后不可复用为双目录映射）：
   - `channel-hub-independent-bind.test.ts`：
     - `@electron/api/routes/channel-hub` → `@electron/message-channel/hub/routes`
     - 同文件 **6×** `vi.mock('@electron/channels/...')` 一并改为 `@electron/message-channel/hub/...`：
       - `binding-service`、`hub-api`、`hub-client`、`hub-config`、`ingress`、`startup`
   - `sclaw-hub-client-connect.test.ts`（本期末或第 3 期必须改完，**§8.1 必跑**）：
     - 2× `vi.mock`：`hub-config`、`binding-service` → `@electron/message-channel/hub/...`
     - 2× `await import('@electron/channels/hub-client')` → `@electron/message-channel/hub/hub-client`
   - 相对路径单测（如 `../../electron/channels/session-key`）随文件归属改为 `.../message-channel/common|hub/...`
6. `startup` 内动态 import weixin → `../weixin/service`。
7. 微信侧剩余 hub 边：`bridge-inbound` → `../hub/ingress`；`binding.ts` → `../hub/binding-service`。
8. 跑：`channel-hub-independent-bind`、`sclaw-hub-client-connect`、`inbound-media`、`channel-ingress-session-title`、钉钉 Hub 扫码绑定、Mobile 开关、双端共用 refreshToken。

**完成标准：** Hub 钉钉收发、Mobile 入站、换绑通知 UI 与迁前一致；`/api/channels/hub/*` 仍由同一 handler 处理。

---

### 第 3 期 — 搬 `mobile/history-facade.ts` + 收口 hub 单测别名

1. `git mv` → `message-channel/mobile/history-facade.ts`。
2. 修正其对 `session-key` / catalog 的 import（指向 `../common`）。
3. 找到 RPC 注册处（若在 gateway / api）改 import。
4. **若第 2 期未改完：** 收口 `sclaw-hub-client-connect.test.ts` 全部 `@electron/channels/*`（见第 2 期 step 5）。
5. 跑 `channel-mobile-history-cursor`、`channel-mobile-session-key`、`sclaw-hub-client-connect`。

---

### 第 4 期 — 去掉 shim，删除旧路径

1. **清零检查（须覆盖 mock / 动态 import，勿假绿）：**
   ```bash
   rg "@electron/channels|from ['\"][^'\"]*channels/" --glob '*.{ts,tsx}'
   ```
   - 仅 `from '...channels/...'` **匹配不到** `vi.mock('@electron/channels/...')` 与 `await import('@electron/channels/...')`。
   - 命中须为 0（UI 的 `@/components/channels`、`@/assets/channels` **不在**本模式内；若误伤再收窄为 `electron/channels|@electron/channels`）。
2. `rg "api/routes/channel-hub|@electron/api/routes/channel-hub" --glob '*.{ts,tsx,md}'` 清零或改指向 `message-channel/hub/routes`。
3. 删除 `electron/channels/**`。
4. 删除 `electron/api/routes/channel-hub.ts`（及任何 shim）。
5. 确认 `server.ts` 只从 `message-channel/hub/routes` 注册 handler。
6. 更新：
   - `message-channel/README.md`
   - `dingtalk/README.md`（实现已在 hub + common）
   - `docs/微信渠道-Host-Worker技术方案.md` 文首「延后迁入」改为「已迁入，见本迁移文档」
   - `docs/SClaw移动端-申懂懂-消息格式对接文档.md` 等写死 `api/routes/channel-hub.ts` 的路径
   - 清理计划文档保留表改为 `message-channel/hub|common|mobile`（含 `hub/routes.ts`）

**完成标准：** 无 `electron/channels` 目录；无 `api/routes/channel-hub.ts`；上列 rg 无业务命中；typecheck + 相关 unit 绿。

---

## 6. 建议 PR 切分

| PR | 内容 | 风险 |
| --- | --- | --- |
| M-PR-1 | 第 0～1 期：骨架 + common + shim | 低 |
| M-PR-2 | 第 2 期：hub 整包 + `hub/routes.ts` + server + **independent-bind 6× mock** + weixin→hub 边 | 中 |
| M-PR-3 | 第 3～4 期：mobile + **sclaw-hub-client-connect 别名收口** + 删 shim + 强化 rg 清零 + 文档 | 低～中 |

不建议与「渠道清理」PR 合并。

---

## 7. 与清理计划的衔接

迁移完成后，更新 [`非钉钉微信Mobile以外渠道清理计划.md`](./非钉钉微信Mobile以外渠道清理计划.md)：

| 原表述 | 迁后表述 |
| --- | --- |
| 保留 `electron/channels/**` | 保留 `electron/message-channel/{hub,common,mobile,weixin}/**` |
| 保留 `api/routes/channel-hub.ts` | 保留 `message-channel/hub/routes.ts`；`server.ts` 注册不变语义 |
| Hub ↔ OC 旁路 | **已核验可删 OC**（见清理计划 §2.1.1）；迁入后路径变为 `message-channel/hub|common`，实施清理时按迁后路径改引用即可，无需再开「交叉依赖确认」门禁 |

清理计划开工前检查清单：

- [x] `electron/channels/` 已不存在（或仅文档声明已删）
- [x] `electron/api/routes/channel-hub.ts` 已不存在（或仅文档声明已删）
- [x] 钉钉 Hub / Mobile / 微信三路径冒烟通过
- [x] `rg "@electron/channels|from ['\"][^'\"]*electron/channels/" ` 无业务命中
- [x] `rg "api/routes/channel-hub|@electron/api/routes/channel-hub"` 无业务引用

---

## 8. 验证清单

### 8.1 自动化

```bash
pnpm typecheck
pnpm exec vitest run \
  tests/unit/channel-hub-independent-bind.test.ts \
  tests/unit/sclaw-hub-client-connect.test.ts \
  tests/unit/channel-mobile-session-key.test.ts \
  tests/unit/channel-mobile-history-cursor.test.ts \
  tests/unit/dingtalk-session-lifecycle.test.ts \
  tests/unit/channel-ingress-session-title.test.ts \
  tests/unit/inbound-media.test.ts \
  tests/unit/stream-content-kind.test.ts \
  tests/unit/sqlite-migrator-channel-sto-mobile.test.ts
```

（若有 weixin bridge 单测一并跑。相对路径引用 `electron/channels/*` 的单测须在改路径后仍绿。）

### 8.2 手工

1. 钉钉 Hub：扫码绑定、解绑、换机抢绑提示、发消息/流式回复。
2. Mobile：启用/禁用 App 绑定、与钉钉共用 refreshToken、新会话 / 续聊、历史列表。
3. 微信：扫码、收发（确认仍走 `common/session-facade`）。
4. 退出登录 / 重登后 Hub 重连兜底（`channels.ts` 列表合并路径）。

### 8.3 不要回归

- `sto-mobile` DB 存储名 ↔ `mobile` 逻辑名映射仍在 `binding-service`。
- Mobile 空闲永不拆会话；钉钉空闲 TTL 不变。
- 微信出站仍不走 Hub `delivery` 卡片语义。

---

## 9. 风险

| 风险 | 缓解 |
| --- | --- |
| **common ↔ hub 既有静态环** | 事实：`session-facade`(common) 静态 import `binding-service`(hub)；`ingress` 等 hub 文件静态 import `session-facade` / `session-key` / `session-lifecycle` / `channel-session-title`；`hub-api` / `hub-client` / `delivery` → `stream-content-kind`。机械迁移把目录内环搬成跨目录环，**TS 允许、运行时初始化序不变（今天就在跑）——不阻断**。迁后 `session-facade` 须显式改为 `../hub/binding-service`。**动态 import 解不了此环，也不试图解**；禁止把它写成「common 不 import hub」目标。 |
| **weixin → hub 静态边（非环）** | `bridge-inbound` → `ingress`；`binding` → `binding-service`。hub 不静态回引 weixin。迁后须指向 `../hub/` **与** `../common/`，不能只指 common。 |
| **weixin 方向解环** | 仅靠动态 import：`session-facade` → weixin binding；`startup` → weixin service（§5 第 1/2 期已列）。 |
| `hub/routes.ts` ↔ `api/context` | 允许 routes 依赖 `api/context` + `route-utils`；避免 api 层与 hub 实现形成新静态环。 |
| 漏改 `@electron/channels` 测试 mock | M-PR-2 按 §5 step 5 逐条改写；第 4 期用含 `@electron/channels` 的 rg，勿用仅 `from ...channels/` 的假绿检查 |
| 漏列 `sclaw-hub-client-connect` | §8.1 / 第 2～3 期必跑、必改别名 |
| 与清理计划抢同一文件 | 本迁移先合主干；清理计划以迁后路径为准 |
| 误把 Hub 放进 dingtalk/ | 强制 `hub/` 平级目录 |

---

## 10. 修订记录

| 项 | 说明 |
| --- | --- |
| 初版 | 钉钉 Hub + Mobile 迁入 message-channel；common / hub / mobile / weixin 四分；先于渠道清理执行 |
| 与微信方案 | 落实原 Phase 4「机械迁入」；补充 Mobile（原方案未单列 Mobile，但实现与钉钉共用 Hub） |
| `channel-hub.ts` 一并迁入 | 原非目标改为目标：`api/routes/channel-hub.ts` → `message-channel/hub/routes.ts`；`server.ts` / 单测改 import；HTTP 路径不变 |
| 依赖事实与测试缺口 | §9 纠正：保留 common↔hub 静态环、weixin→hub 静态边；§5/§8.1 补 `sclaw-hub-client-connect` 与 independent-bind 的 6× mock；第 4 期清零 rg 含 `@electron/channels` |
| OC vs Hub | 与清理计划对齐：旁路删除 **已核验安全**；§7 不再保留「交叉依赖待确认」门禁 |
| 实施收口 | 第 0～4 期一次落地；冒烟通过后补漏 `main.ts` 动态 import `../message-channel/hub/startup`；§7 清单全勾；**下一步仅**开清理计划，勿与本迁移混 PR |
