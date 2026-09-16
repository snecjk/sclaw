# 非钉钉 / 微信 / Mobile 渠道清理计划

> 状态：**待实施**（本文只定范围与落地步骤，不包含代码变更）
> 日期：2026-09-16（修订：§11.2 立刻删微信 npm；vite closeBundle 保留；**钉钉 OC 旁路 vs Hub 已核验可删**；§9 allowlist 单测表述纠正）
> **前置条件（硬门禁）：** [`钉钉Hub与Mobile迁入message-channel计划.md`](./钉钉Hub与Mobile迁入message-channel计划.md) **已完成**（`electron/channels/` 与 `api/routes/channel-hub.ts` 已删除；实现在 `message-channel/{hub,common,mobile}`）。开工清理前仍须：Hub/Mobile/微信冒烟通过。
> 目标：SClaw 消息渠道只保留 **钉钉 Hub、微信 Host Worker、SClaw Mobile App**；删除其余 IM 渠道，并删除钉钉的 **OpenClaw 渠道插件**路径（Hub 保留）。
> 相关文档：[`微信渠道-Host-Worker技术方案.md`](./微信渠道-Host-Worker技术方案.md)（Phase 2 已停止打包企微 / QQ / OC 微信插件，但 Host/UI 残留尚未清完）

---

## 1. 决策

| 项 | 决定 |
| --- | --- |
| 保留 | **钉钉 Hub**、微信（Host Worker）、SClaw Mobile App（`mobile` / `sto-mobile`） |
| 删除（第三方 IM） | WhatsApp、Telegram、Discord、企微、QQ Bot，以及 Signal / iMessage / Matrix / LINE / Teams / Google Chat / Mattermost |
| 删除（钉钉旁路） | **钉钉 OC 渠道插件** `@soimy/dingtalk` 的安装、allowlist、`channels.dingtalk` OC 配置写入、Gateway 插件升级。**禁止动** Hub 实现（见 §2.1 / §2.1.1） |
| 提示与文案 | **硬删，不另留兼容话术。** 凡点名已删渠道的字符串一律去掉 |
| 用户本地旧配置 | **启动时剥离** 第三方渠道；并剥离 `plugins` / `channels` 里的 **OC dingtalk 插件注册**（见第 0 期），不碰 Hub 绑定库表 |
| 依赖 PR-4 | opus / baileys / libsignal 条目 + **立刻删除** `@tencent-weixin/openclaw-weixin` npm（§11.2）；**不等**整体下架 OpenClaw。与[`微信渠道方案`](./微信渠道-Host-Worker技术方案.md)不冲突：该文「须推迟删除 npm」仅适用于 R1 **npm 退路**；Phase 0 结论已写明「当前亦未使用 npm 退路」（约 L568），条件已满足 |
| OpenClaw 引擎 / Gateway | **本期仍保留**（引擎与其它 sto 插件仍用）。整体下架 OpenClaw 另立项 |
| 钉钉 OC 旁路 vs Hub | **已核验安全，可删 OC 旁路。** 证据见 §2.1.1：Hub 不读 `channels.dingtalk` / `CHANNEL_PLUGIN_MAP`、不调 `ensureDingTalkPluginInstalled`；OC 安装调用方仅 `channels.ts` + `ipc-handlers` 的旧 save 路径 |
| Mobile | **完整保留** |

---

## 2. 保留面（禁止改行为）

### 2.1 钉钉 Hub（主路径 — 禁止改行为）

> 路径以 **message-channel 迁入完成后** 为准；迁入前若仍见 `electron/channels/*`，不得按本文开删。

| 位置 | 说明 |
| --- | --- |
| `electron/message-channel/hub/*` | Hub 入站 / 出站 / 绑定 / WS（钉钉+Mobile 共用） |
| `electron/message-channel/common/*` | session-facade / session-key / lifecycle（三渠道共用） |
| `electron/message-channel/hub/routes.ts` | `/api/channels/hub/dingtalk/*`（原 `api/routes/channel-hub.ts`；`server.ts` 注册） |
| `electron/message-channel/hub/hub-api.ts` / `hub-client.ts` / `binding-service.ts` | Hub 协议与绑定 |
| `src/components/channels/DingTalkHubBindModal.tsx` | 扫码绑定 UI |
| `src/assets/channels/dingtalk.svg`、`src/assets/icons/ding.svg` | 品牌图标 |
| `sto-dingtalk-send-guard`（agent-extension + sto-plugin） | **发送守卫 / 提示策略**，不是 `@soimy/dingtalk` 渠道插件；**保留** |

频道页上的「钉钉」只应走 Hub（`mergeHubDingTalkChannel` 已用 Hub 视图覆盖 OC 列表项）。删 OC 插件后 Hub 行为必须不变。

#### 2.1.1 钉钉 OC 插件（旁路 — 本计划删除）

| 位置 | 动作 |
| --- | --- |
| `CHANNEL_PLUGIN_MAP.dingtalk`（`config-sync.ts`） | 清空 map 或删除 dingtalk 项，Gateway 启动不再自动装/升 `@soimy/dingtalk` |
| `ensureDingTalkPluginInstalled()`（`plugin-install.ts`）及所有调用 | 删除函数；调用处改为拒绝或 no-op |
| `POST /api/channels/config` + IPC `channel:saveConfig` 里 `channelType === 'dingtalk'` 的装插件分支 | 删除；钉钉配置写路径只保留 Hub（`channel-hub`）。对旧式 token 表单 save：`410` 或引导「请使用钉钉 Hub 扫码」 |
| `channel-config.ts` 的 `ensurePluginAllowlist` dingtalk 分支、`transformChannelConfig` 里面向 OC 的 dingtalk 字段 | 删除 OC 插件 allowlist / 凭证变换；**不要**删 Hub 用的 catalog / session key |
| sanitize（第 0 期） | 从 `openclaw.json` 删除 `channels.dingtalk`、`plugins.entries.dingtalk`、`plugins.allow` 中的 `'dingtalk'`、bindings 里 match.channel=`dingtalk` 的 **OC 绑定**（若与 Hub 共用 channel 名，以「只清 openclaw.json、不动 Hub SQLite 绑定表」为准） |
| `FORCE_RESTART_CHANNELS` 中的 `dingtalk` | 删除（仅为 OC 插件热重启）；Hub 绑定走既有 hub 路径，不依赖该 Set |
| `docs/WINDOWS_BUILD_PROCESS.md` 等对 `@soimy/dingtalk` 的打包表 | PR-3 文档删除 |
| 根 `package.json` 若仍有 `@soimy/dingtalk` | 当前未见直依；若有则 PR-4 一并删。extensions 目录下用户本机已装的 `dingtalk` 可在 sanitize/启动时 `rm` extensions/dingtalk（可选，建议做） |

**对照：不要删错**

| 是 | 否 |
| --- | --- |
| 删 `@soimy/dingtalk` OC **渠道**插件接线 | 删 `electron/message-channel/hub|common|mobile/*` Hub |
| 清 `openclaw.json` 里 OC dingtalk | 清 Hub `channel_connection` / catalog 钉钉会话 |
| | 删 `sto-dingtalk-send-guard` |

**OC 旁路 vs Hub（已核验，可删）：**

| 检查项 | 结论 |
| --- | --- |
| `ensureDingTalkPluginInstalled` 调用方 | 仅 `channels.ts`（约 L662）与 `ipc-handlers.ts`（约 L1437）的旧 OC/token save；Hub `routes` / `binding-service` / `hub-client` **不调用** |
| Hub 是否读 `channels.dingtalk` / `CHANNEL_PLUGIN_MAP` | **否**；Hub 走 SQLite `channel_connections` + Hub HTTP/WS |
| `FORCE_RESTART_CHANNELS` 含 `dingtalk` | 仅为 OC 插件热重启；删 Set 项不伤 Hub |
| `mergeHubDingTalkChannel` | 列表用 Hub 视图覆盖 OC 项；删 OC 后仍应保留该合并（或简化为只展示 Hub） |
| `ensureStoDingTalkSendGuardPluginInstalled` | **保留**（发送守卫，非渠道插件） |

**盖棺：** 删 §2.1.1 所列 OC 旁路 **不误伤 Hub**。实施时仍按「是/否」对照表执行，并以微信 dangling cleanup 单测 + 钉钉 Hub 绑定冒烟做回归（见 §9）。

### 2.2 微信

| 位置 | 说明 |
| --- | --- |
| `electron/message-channel/weixin/**` | Host Worker + iLink transport |
| `electron/utils/wechat-login.ts` | Host 扫码 |
| `electron/utils/channel-alias.ts` | `wechat` ↔ `openclaw-weixin` |
| `shared/weixin-runtime-protocol.ts` | Worker 契约 |
| `src/assets/channels/wechat.svg`、`src/assets/icons/wechat.svg` | 品牌图标 |

微信存储别名 `openclaw-weixin` **必须继续识别**，不能当成「第三方渠道」删掉。

本期 **保留** `electron/message-channel/weixin/**`（含 vendor 快照与 transport）。根目录 `package.json` 的 `@tencent-weixin/openclaw-weixin` 在 **PR-4 立刻删除**（§11.2；npm 退路未启用，见微信方案 L568）。`vite.config.ts` 里同名合成 package.json **保留**。

### 2.3 SClaw Mobile App

| 位置 | 说明 |
| --- | --- |
| `src/components/channels/MobileAppConfigModal.tsx` | 移动端绑定 UI |
| `electron/message-channel/hub/hub-api.ts` 的 `HubChannelType = 'dingtalk' \| 'mobile'` | Hub 协议 |
| `electron/message-channel/mobile/history-facade.ts` | Mobile 历史 RPC |
| `electron/message-channel/hub/routes.ts` 的 `/api/channels/hub/{dingtalk,mobile}/*` | Hub Host API（不在 `channels.ts`） |
| `src/pages/Channels/index.tsx` 的 mobile 状态 / 开关 | 频道页独立卡片 |
| `tests/unit/channel-mobile-*.test.ts`、`tests/unit/sqlite-migrator-channel-sto-mobile.test.ts` | 移动端测试 |
| `src/assets/channels/sclaw-mobile-app-qr.png`、`src/assets/icons/app.svg` | 资源 |
| 侧栏来源 `app` / `mobile` / `sto-mobile` | 会话徽章 |

Mobile **不要**写进 `ChannelType` 收窄后的联合类型，除非另有重构。它是 Hub 渠道，不是 OpenClaw `channels.<type>`。

---

## 3. 删除面（按实现深度）

当前 `getPrimaryChannels()` 已只返回 `['dingtalk', 'wechat']`，频道页默认不再提供「添加 Telegram」入口。但类型、配置、登录、IPC、校验、i18n、图标、侧栏徽章和测试仍在。企微 / QQ 的 save 已返回 410，插件打包已停；WhatsApp / Telegram / Discord 的 Host 路径仍可被旧配置或 IPC 触发。

| 层 | 渠道 | 代码深度 | 产品面现状 |
| --- | --- | --- | --- |
| A | **WhatsApp** | 独立 Baileys 登录器 + Host API/IPC + `plugins.entries.whatsapp` + `credentials/whatsapp` | 不在主列表；旧配置仍可能出现在「已配置」兜底循环 |
| B | **Telegram、Discord** | `channel-config` 变换 / 在线校验 / Telegram 代理同步 / 表单 | 同上 |
| C | **企微 wecom、QQ qqbot** | save 410；allowlist、legacy id 迁移、侧栏徽章仍在 | 列表已 skip；历史会话侧栏仍显示 |
| D | **Signal、iMessage、Matrix、LINE、msteams、googlechat、mattermost** | 仅 `CHANNEL_META` + i18n + 去重 key | 不展示 |

删除后的 `ChannelType`（前端）应变为：

```ts
export type ChannelType = 'wechat' | 'dingtalk';
```

Host 存储层额外识别：`openclaw-weixin`（微信别名）。Hub 层额外识别：`mobile` / `sto-mobile`。

---

## 4. 明确不在本期范围

不要因为字符串里出现 `discord` / `wecom` / `channel` 就删：

| 项 | 本期 | 原因 |
| --- | --- | --- |
| `shared/preview-href.ts` 的 `discord:` / `slack:` | 保留 | 外链 scheme 分类，不是 IM 渠道；删会误伤链接预览 |
| `shared/quote-bridge-channels.ts` | 保留 | 报价工作台事件名 |
| `scripts/after-pack.cjs` 的 `EXCLUDED_SKILLS` 含 `'discord'` | **保留该排除项** | 继续从发行包排除 OpenClaw **skill** `skills/discord`；不是渠道代码。整体下架 OC 时随 skills 打包逻辑一起消失 |
| `scripts/bundle-openclaw.mjs` 跳过 `@discordjs/opus` | PR-1～3 不动；PR-4 可删跳过项（若仍有 bundle 脚本） | ABI 规避注释可随 opus 依赖删除一起清 |
| `package.json` 的 `onlyBuiltDependencies`（opus / baileys）与 `overrides.libsignal` | **PR-1～3 不动 → PR-4 删除** | 已删渠道相关；**本计划完成后立刻切，不等整体下架 OpenClaw**（§11） |
| 钉钉 OC 插件 `@soimy/dingtalk` | **删除接线**（§2.1.1） | 产品主路径是 Hub；OC 插件为旁路 |
| 钉钉 Hub / `message-channel/hub/routes.ts` / `message-channel/{hub,common,mobile}` | **保留** | 主路径 |
| `sto-dingtalk-send-guard` | **保留** | 发送守卫，不是渠道插件 |
| `@tencent-weixin/openclaw-weixin` **npm 依赖** | **PR-4 立刻删除** | 未走 npm 退路（微信方案 L568）；与「推迟删」条款不冲突。见 §11.2 |
| `vite.config.ts` closeBundle 同名字面量 | **保留** | 合成 Worker package.json，非根依赖；`rg` 命中属预期 |
| `electron/message-channel/weixin/runtime/vendor/` | **长期保留**（直到微信自研完全不引用） | 已改过的传输快照，是微信 Worker 的一部分 |
| **整文件**迁 `api/routes/channels.ts` → `message-channel/` | **本期不做** | 见下方「后续备忘」；本计划只瘦身该文件，不搬家 |

**注意：** 工作流设计器里 `<option value="wecom">企业微信</option>` **要删**（属已删渠道提示，进 PR-2），不再列为「演示例外」。

### 后续备忘：`api/routes/channels.ts` 与 message-channel

> 2026-09-16 讨论结论；**本清理计划不实施搬家**，仅作收口后的可选跟进。

1. **现在不要整文件迁入 `message-channel/`**  
   - 该文件是 Host API **聚合面**（OC 配置 CRUD、微信扫码、WhatsApp、agent binding、Gateway 重启、列表合并 Hub/微信），不是纯 IM 传输。  
   - 与已迁的 `hub/routes.ts`（纯 Hub 绑定/WS）边界不同；整迁会把大量 OC/通用 Host 接线拖进伞目录。  
   - 迁入计划已将其标为非目标；本清理会先大幅删薄该文件，搬家应等瘦身后再评估，避免与 PR-1～2 打架。

2. **清理完成、文件瘦身后，可另开机械 PR 考虑拆迁（可选）**  
   - 微信扫码相关路由 → `message-channel/weixin/routes.ts`（或同类微信 Host 面）。  
   - 通用 `/api/channels/*` 列表 / 配置 / binding，以及 `mergeHubDingTalkChannel` 等 → **仍可留** `api/routes/channels.ts`，或收成薄壳 `message-channel/host-routes.ts`（由 `server.ts` 注册；URL 不变）。  
   - 判定标准：迁完后 `message-channel/` 仍是「IM 编排 + 各渠道传输」，而不是「所有带 channel 字样的 HTTP」。

---

## 5. 分阶段落地

原则：**先让产品面和 Gateway 再也配不上、跑不起来，再删实现，最后收测试与文档。** 每一期可独立 PR。不要在同一提交里又改依赖又删 UI。

### 第 0 期 — 闸门：sanitize + API 拒绝

目的：仓库代码还没删光之前，已装用户也无法再启用被删渠道。

**A. 启动剥离 `sanitizeOpenClawConfig()`（`electron/utils/openclaw-auth.ts`）**

允许保留的 OpenClaw `channels.*` key：**仅** `openclaw-weixin`（及只读兼容的 `wechat` 迁移）。**不再保留** `channels.dingtalk`（那是 OC 插件配置；钉钉产品走 Hub，状态不在此文件）。

同时剥离：

```
plugins.entries.dingtalk
plugins.allow 中的 'dingtalk'（勿误删 'sto-dingtalk-send-guard'）
bindings[] 中 match.channel === 'dingtalk' 的项（仅 openclaw.json；Hub 绑定表不动）
```

可选：删除 `~/.stoclaw/openclaw/extensions/dingtalk` 目录，避免 Gateway 扫到旧插件。

微信 OC 插件 dangling 清理仍在 **`channel-config.ts` 的 `cleanupDanglingWeChatPluginState`**。

从配置中删除：

```
channels.whatsapp / telegram / discord / wecom / qqbot /
         signal / imessage / matrix / line / msteams / googlechat / mattermost
plugins.entries.whatsapp / wecom / qqbot / wecom-openclaw-plugin
plugins.allow 中的同上 id
bindings[] 里 match.channel 属于上表的项
```

可选（建议做）：删除目录 `~/.stoclaw/openclaw/credentials/whatsapp`。

不要误删：`plugins.entries` 里的 `sto-*`（含 **`sto-dingtalk-send-guard`**）、其它非渠道 sto 插件。

**B. Host API 拒绝写路径**

`POST /api/channels/config` 与 IPC `channel:saveConfig`：

- 第三方渠道 → `410`
- `channelType === 'dingtalk'` 的 **旧 OC/token 配置保存** → `410`（或明确错误：请使用钉钉 Hub 扫码）；**删除** `ensureDingTalkPluginInstalled` 分支
- 微信 / Hub 路由不受影响：`/api/channels/wechat/*`、`message-channel/hub/routes` 的 dingtalk/mobile

Mobile / 钉钉 Hub 走 `hub/routes.ts`，不受这条影响。

**C. 测试**

扩展 `tests/unit/sanitize-config.test.ts`：现有用例把 `channels.discord` / `plugins.entries.whatsapp` 当作「应保留」——**必须改成「应被剥离」**。

**完成标准**

- 本地 `openclaw.json` 里放一段 telegram/whatsapp 配置，启动后被清掉。
- 对 `/api/channels/config` POST `channelType: telegram` 得到 410。
- 钉钉绑定、微信扫码、Mobile 开关不受影响（Hub 路径冒烟）。
- Gateway 日志不再加载 `@soimy/dingtalk` / `extensions/dingtalk`（若已清 extensions）。

---

### 第 1 期 — 整文件删除

| 文件 | 动作 |
| --- | --- |
| `electron/utils/whatsapp-login.ts` | 删除 |
| `tests/unit/whatsapp-login.test.ts` | 删除 |
| `src/assets/channels/telegram.svg` | 删除 |
| `src/assets/channels/discord.svg` | 删除 |
| `src/assets/channels/whatsapp.svg` | 删除（若仓库中存在） |
| `src/assets/channels/wecom.svg` | 删除（若存在） |
| `src/assets/channels/qq.svg` | 删除（若存在） |
| `src/assets/icons/wecom.svg` | 删除 |
| `src/assets/icons/qq.svg` | 删除 |

`electron/utils/openclaw-proxy.ts`：**不要直接删文件**。该模块现在只写 `channels.telegram.proxy`。第 1 期把 `syncProxyConfigToOpenClaw` 改成 no-op（仍 export），保留调用点。删除或改写 `tests/unit/openclaw-proxy.test.ts`。

**同批硬删的提示 / 模板（并入第 1–2 期 / PR-2，不放到第 4 期）：**

| 文件 | 动作 |
| --- | --- |
| 三语 `settings.json` 的 `proxyAllServerHelp` / `proxyRestartNote` | 去掉 Telegram；改成中性代理说明（见 §2.2） |
| `.sclaw/BOOTSTRAP.md` | 删除 WhatsApp / Telegram 两行引导；Connect 段只留「Just here」或钉钉/微信/SClaw App，**不要**保留已下线渠道话术 |
| `.sclaw/AGENTS.md` | 去掉 `@wecom/wecom-openclaw-plugin` 等已下线包名暗示；改为「已下线，勿加回」或直接删该举例 |
| `docs/WINDOWS_INSTALLER_OPTIMIZATION.md` | 删 WeCom / QQ 验收项 |
| `src/pages/WorkflowDesigner/.../designer-node-type-config.tsx` | 删除 `send_message` 下的 `<option value="wecom">企业微信</option>` |
| `channel-status` / `builtin-tools-manifest` 注释 | 去掉 WeCom 举例 |

原则：**凡用户或 agent 能读到的、点名已删渠道的字符串，与实现删除同一 PR 清掉**；不单独拖到「文档期」。

**完成标准**

- 全仓无 `whatsapp-login` import。
- `pnpm typecheck` 能过到「未改引用」之前的报错已被本期内引用删除覆盖（见第 2 期）。建议第 1、2 期同一 PR，避免中间状态编不过。

> 实施建议：第 1 期与第 2 期合并为一个 PR。拆开只适合「先合 sanitize」的第 0 期。

---

### 第 2 期 — 类型、UI、Host 接线

#### 2.1 前端类型与页面

**`src/types/channel.ts`**

- `ChannelType` 只留 `'wechat' | 'dingtalk'`。
- 删除 `CHANNEL_META` 中除钉钉、微信外的全部条目。
- `CHANNEL_ICONS` / `CHANNEL_NAMES` 同步收窄。
- `getAllChannels()`：实施前再 `rg 'getAllChannels\\(' --glob '*.{ts,tsx}'` 确认；当前全仓仅定义处、**无调用方，可删除**。`getPrimaryChannels()` 保持 `['dingtalk', 'wechat']`。

**`src/pages/Channels/index.tsx`**

- 删除 telegram / discord / whatsapp / wecom / qq 的 SVG import、品牌色、`CHANNEL_ICON_RAW`。
- 删除 `channelListItems` 里对非钉钉/微信「已配置 group」的兜底循环（当前会把 leftover telegram/whatsapp 渲染出来；wecom/qqbot 已 skip）。
- **保留** Mobile 卡片、钉钉 Hub、微信扫码。
- `src/pages/WorkflowDesigner/components/designer-node-type-config.tsx`：删除「发到哪里」里的企微选项（硬删提示，不保留演示占位）。

**`src/components/channels/ChannelConfigModal.tsx`**

- 删除 WhatsApp 成功后 `POST /api/channels/config` 的特殊分支。
- `ChannelLogo` 只处理 `dingtalk` / `wechat`，其余走 emoji fallback 或直接收窄类型后编译器保证穷尽。
- Discord/Telegram 校验结果里的 `botUsername` / `guildName` / `channelName` 展示可删（`validateChannelCredentials` 同步删除后自然无数据）。

**侧栏来源**

- `src/lib/session-channel-source.ts`：`SidebarChannelSource` 改为 `'dingtalk' | 'wechat' | 'app'`。删除 `wecom`、`wecom-openclaw-plugin`、`qq`、`qqbot`。保留 `app` / `mobile` / `sto-mobile`。
- `src/components/layout/sidebar-channel-source-badge.tsx`：删除企微、QQ 图标与文案 key。
- `src/i18n/locales/{zh,en,ja}/common.json`：删除 `sidebar.channelSource.wecom`、`sidebar.channelSource.qq`。

**其它前端**

- `src/pages/Agents/index.tsx`：`CHANNEL_NAMES[group.channelType]` 在收窄类型后对未知 key 用原字符串即可，无需保留企微/QQ 名称。
- `src/stores/channels.ts`：随 `ChannelType` 收窄，无独立第三方分支则只改类型。
- `src/lib/host-events.ts`：删除完整键名 `channel:whatsapp-qr`、`channel:whatsapp-success`、`channel:whatsapp-error`（不是 `…-qr` + 短后缀 `success/error`）。**保留** `channel:wechat-qr` / `channel:wechat-success` / `channel:wechat-error`、`channel:dingtalk-bind-replaced`。

#### 2.2 i18n

`src/i18n/locales/{zh,en,ja}/channels.json`：

- 删除 `toast.whatsappConnected` / `whatsappFailed`。
- 删除 `meta` 下：`telegram`、`discord`、`whatsapp`、`signal`、`wecom`、`imessage`、`matrix`、`line`、`msteams`、`googlechat`、`mattermost`、`qqbot`。
- **保留** `meta.wechat`、`meta.dingtalk`，以及 `hub.mobile` / 钉钉 Hub 文案。

`src/i18n/locales/{zh,en,ja}/cron.json`：删除无消费者的 `discordChannelId` / `discordChannelIdPlaceholder` / `discordChannelIdDesc` / `discordIdRequired`（定时任务 UI 未引用）。

`src/i18n/locales/{zh,en,ja}/settings.json`（**必做，进 PR-2**）：

| key | 动作 |
| --- | --- |
| `proxyAllServerHelp` | 删除 Telegram 点名；改中性 SOCKS/兜底描述 |
| `proxyRestartNote` | 删除「保留 Telegram 频道已有代理」整段语义；只保留 Electron 代理重应用 + Gateway 重启 |

与 `openclaw-proxy` no-op 同一 PR。不必写「请改用钉钉」类替代句。

#### 2.3 Host API / IPC / preload

**`electron/api/routes/channels.ts`**

- 删除 `whatsAppLoginManager` import。
- 删除 `/api/channels/whatsapp/start`、`/api/channels/whatsapp/cancel`。
- `FORCE_RESTART_CHANNELS`：去掉 `whatsapp` **与** `dingtalk`（二者皆为 OC 插件重启语义）。Hub 不依赖该 Set。
- 删除 `ensureDingTalkPluginInstalled` import 与 `channelType === 'dingtalk'` 装插件分支。
- wecom/qqbot 的 410 分支：第 0 期已泛化后删除特判。
- **保留** `/api/channels/wechat/start|cancel`；**保留**列表合并里的 `mergeHubDingTalkChannel`（Hub 视图）。

**`electron/message-channel/hub/routes.ts`**（原 `api/routes/channel-hub.ts`）

- **整文件不动行为**（清理计划不改 Hub Host API 语义）。

**`electron/main/ipc-handlers.ts`**

- 删除 WhatsApp handlers；删除 `ensureDingTalkPluginInstalled` 与 dingtalk 装插件 save 分支。
- `forceRestartChannels` 去掉 `whatsapp` 与 `dingtalk`。
- **保留** Hub / 其它非渠道 IPC。

**`electron/main/main.ts`**

- 删除 `whatsAppLoginManager` 事件转发（约 L936–946）及启动参数里的依赖注入。

**`electron/preload/index.ts`**

- 白名单删除完整键名：`channel:requestWhatsAppQr`、`channel:cancelWhatsAppQr`、`channel:whatsapp-qr`、`channel:whatsapp-success`、`channel:whatsapp-error`。

#### 2.4 配置核心 `electron/utils/channel-config.ts`

这是工作量最大的单文件。按符号拆：

| 符号 / 分支 | 动作 |
| --- | --- |
| `WECOM_PLUGIN_ID` | 删除 |
| `PLUGIN_CHANNELS = ['whatsapp']` | 删除；`save` / `delete` / `setEnabled` 里所有 `PLUGIN_CHANNELS.includes` 一并删 |
| `CHANNEL_UNIQUE_CREDENTIAL_KEY` | 删除整表中的第三方项；**亦删除 `dingtalk: 'clientId'`**（OC 凭证去重）。Hub 不用此表 |
| `ensurePluginAllowlist` 的 `wecom` / `qqbot` / **`dingtalk`** | 全部删除；**保留**微信 dangling 相关调用点所需的清理，勿再往 allow 里加 `'dingtalk'` |
| `transformChannelConfig` 的 discord / telegram / wecom / **面向 OC 的 dingtalk** | 删除 |
| `extractFormValues` 的 discord / telegram 专用结构 | 删除，走通用 string 拷贝即可 |
| `deleteChannelConfig` 的 whatsapp 凭证目录 | 删除 |
| `listConfiguredChannels` 探测 `credentials/whatsapp` | 删除 |
| `validateChannelCredentials` 的 discord/telegram case 及 `validateDiscordCredentials` / `validateTelegramCredentials` | 删除；未知类型返回「无在线校验」或直接拒绝 |
| `validateChannelConfig` 末尾 discord/telegram 必填检查 | 删除 |

**不要删：** `cleanupDanglingWeChatPluginState`、微信账号 index。**不要**再写 dingtalk OC allowlist。

#### 2.5 其它 Host

| 文件 | 动作 |
| --- | --- |
| `electron/utils/openclaw-auth.ts` | 删 wecom legacy 迁移；sanitize 剥离第三方 + **OC dingtalk**；**保留** `sto-dingtalk-send-guard` 的 ensure 配置 |
| `electron/utils/plugin-install.ts` | 删 `ensureDingTalkPluginInstalled`、wecom `MANIFEST_ID_FIXES`；**保留** `ensureStoDingTalkSendGuardPluginInstalled` 及 sto 插件安装 |
| `electron/gateway/client.ts` | `ChannelType` → `'dingtalk' \| 'wechat'`（UI/类型名；实现上钉钉仅 Hub） |
| `electron/gateway/config-sync.ts` | **`CHANNEL_PLUGIN_MAP` 清空**（删除 dingtalk 项）；不再自动升级任何 OC **渠道**插件 |
| `scripts/bundle-openclaw-plugins.mjs` / `after-pack.cjs` | 确认 `@soimy/dingtalk` 仍为注释/未打包；删过时文案；**保留** `sto-dingtalk-send-guard` local 插件打包 |
| `src/lib/channel-status.ts` | 约 L70 注释举例 WeCom → 改为中性表述（如「部分 OpenClaw 集成」） |
| `electron/utils/channel-status.ts` | 同上（与 renderer 侧同源注释） |
| `electron/utils/builtin-tools-manifest.ts` | 约 L30 注释「WeCom 等」→ 中性表述；测试见 §3，**源文件也要改** |

#### 2.6 主题审计例外

`tests/unit/theme-source-audit.test.ts` 的 `authoredSvgExceptions` 删除：

- `src/assets/channels/discord.svg`
- `src/assets/channels/telegram.svg`
- `src/assets/channels/whatsapp.svg`
- `src/assets/channels/wecom.svg`
- `src/assets/channels/qq.svg`

**保留** `dingtalk.svg`、`wechat.svg`。

---

### 第 3 期 — 测试改写

不要用已删除渠道当「快乐路径」fixture。拒绝路径可用 `telegram` 字符串测 410，但不要再 `saveChannelConfig('qqbot', ...)`。

| 文件 | 处理 |
| --- | --- |
| `tests/unit/whatsapp-login.test.ts` | 第 1 期已删 |
| `tests/unit/channel-config.test.ts` | qqbot 去重 / wecom plugin enable 改成 **dingtalk** 等价用例，或只测通用 trim/duplicate |
| `tests/unit/channel-routes.test.ts` | 去掉 `whatsapp-login` mock；telegram list/status fixture 改 dingtalk 或 wechat |
| `tests/unit/agent-config.test.ts` | `assignChannelAccountToAgent(..., 'telegram', ...)` 改 `'dingtalk'` |
| `tests/unit/openclaw-proxy.test.ts` | 随 no-op 改断言或删除 |
| `tests/unit/sanitize-config.test.ts` | 第 0 期已改「应剥离」 |
| `tests/unit/plugin-install.test.ts` | `ensurePluginInstalled('wecom', ...)` 改为某个仍打包的 sto 插件或 dingtalk |
| `tests/unit/builtin-tools-manifest.test.ts` | fallback 里的 `{ dirName: 'wecom' }` 换成 `sto-scheduled-task-tool` 等真实 id；与源文件 `builtin-tools-manifest.ts` 注释一并改 |
| `tests/unit/api-client.test.ts` | `telegram-default` 假数据可改为 `dingtalk-default` |
| `tests/unit/channel-mobile-*.test.ts` | **不改行为** |
| `tests/unit/channel-hub-independent-bind.test.ts` | **不改行为** |

---

### 第 4 期 — 仅历史 / 架构文档收口

用户可见、agent 可见的提示已全部进 **PR-2**（见第 1 期「同批硬删」表）。第 4 期只改不会影响运行时引导的技术文档：

| 文件 | 动作 |
| --- | --- |
| `docs/sqlite/catalog-sessions.md` | `channel_type` 常见值改为 `wechat`、`dingtalk`、`mobile` / `sto-mobile`；注明旧库可能仍有历史值，侧栏对未知类型不展示徽章 |
| `docs/WINDOWS_BUILD_PROCESS.md` | 删除 wecom/qqbot/`@soimy/dingtalk` 渠道插件打包表；**保留** `@discordjs/opus` ABI 说明（PR-4 前） |
| `docs/微信渠道-Host-Worker技术方案.md` | 不改历史决策正文；文首可链到本文档 |

历史会话 SQLite 行里的 `channel_type=telegram` **不必做 DB migration**。侧栏对未知类型返回 `null` 即可。

> **口径（消歧）：** `.sclaw/BOOTSTRAP.md`、`.sclaw/AGENTS.md`、`WINDOWS_INSTALLER_OPTIMIZATION.md`、settings 代理文案、工作流 wecom 选项、源码注释举例 —— **全部属于 PR-2，不属于第 4 期。** 第 4 期不再承载「尽量提前」的张力。
---

## 6. 文件级总表

### 6.1 删除

- `electron/utils/whatsapp-login.ts`
- `tests/unit/whatsapp-login.test.ts`
- `src/assets/channels/{telegram,discord,whatsapp,wecom,qq}.svg`（存在则删）
- `src/assets/icons/{wecom,qq}.svg`

### 6.2 必改（核心）

- `src/types/channel.ts`
- `src/pages/Channels/index.tsx`
- `src/components/channels/ChannelConfigModal.tsx`
- `src/lib/session-channel-source.ts`
- `src/components/layout/sidebar-channel-source-badge.tsx`
- `src/lib/host-events.ts`
- `src/i18n/locales/{zh,en,ja}/channels.json`
- `src/i18n/locales/{zh,en,ja}/common.json`
- `src/i18n/locales/{zh,en,ja}/cron.json`
- `src/i18n/locales/{zh,en,ja}/settings.json`（代理文案去 Telegram）
- `.sclaw/BOOTSTRAP.md`（删 WhatsApp / Telegram 引导）
- `.sclaw/AGENTS.md`（去 wecom 包名举例）
- `docs/WINDOWS_INSTALLER_OPTIMIZATION.md`（删 WeCom / QQ checklist）
- `src/pages/WorkflowDesigner/components/designer-node-type-config.tsx`（删 wecom 选项）
- `electron/utils/channel-config.ts`
- `electron/utils/openclaw-auth.ts`
- `electron/utils/openclaw-proxy.ts`（改 no-op）
- `electron/utils/plugin-install.ts`
- `electron/utils/builtin-tools-manifest.ts`（注释）
- `electron/utils/channel-status.ts`（注释）
- `src/lib/channel-status.ts`（注释）
- `electron/api/routes/channels.ts`
- `electron/main/ipc-handlers.ts`
- `electron/main/main.ts`
- `electron/preload/index.ts`
- `electron/gateway/client.ts`

### 6.3 必改（测试 / 历史文档）

- `tests/unit/channel-config.test.ts`
- `tests/unit/channel-routes.test.ts`
- `tests/unit/agent-config.test.ts`
- `tests/unit/sanitize-config.test.ts`
- `tests/unit/plugin-install.test.ts`
- `tests/unit/builtin-tools-manifest.test.ts`
- `tests/unit/theme-source-audit.test.ts`
- `tests/unit/openclaw-proxy.test.ts`
- `docs/sqlite/catalog-sessions.md`（PR-3）
- `docs/WINDOWS_BUILD_PROCESS.md`（PR-3）

### 6.4 禁止改动（保留渠道）

- `electron/message-channel/hub/**`、`common/**`、`mobile/**`（钉钉 Hub + Mobile，含 `hub/routes.ts`）
- `electron/api/server.ts` 对 `handleChannelHubRoutes` 的注册（只允许改 import 路径，不改语义）
- `electron/message-channel/weixin/**`
- `electron/utils/wechat-login.ts`
- `src/components/channels/DingTalkHubBindModal.tsx`
- `src/components/channels/MobileAppConfigModal.tsx`
- `sto-dingtalk-send-guard` / `ensureStoDingTalkSendGuardPluginInstalled`
- `tests/unit/channel-mobile-*.test.ts`、`tests/unit/channel-hub-*.test.ts`
- `package.json` 的依赖字段（**PR-1～3 禁止改**；**PR-4 按 §11 切除**）
- `shared/preview-href.ts` 的 `discord:` scheme
- `scripts/after-pack.cjs` 的 `EXCLUDED_SKILLS` 中 `'discord'`
- **整文件**把 `api/routes/channels.ts` 迁入 `message-channel/`（本期只删薄；搬家见 §4「后续备忘」）

---

## 7. 建议 PR 切分

| PR | 内容 | 风险 |
| --- | --- | --- |
| PR-1 | 第 0 期：sanitize + API/IPC 拒绝 + sanitize 测试 | 低 |
| PR-2 | 第 1–3 期：删第三方渠道实现 + **钉钉 OC 插件接线** + 类型/UI/Host + proxy no-op + 全部提示 + 单测；**不动** Hub / send-guard | 中 |
| PR-3 | 第 4 期：仅历史技术文档 | 低 |
| **PR-4** | **§11：从 `package.json` 删除 opus / baileys / libsignal 相关条目，以及 `@tencent-weixin/openclaw-weixin` npm**（人工改依赖；**不**等整体下架 OpenClaw） | 中（install / 打包回归） |

顺序：PR-1 → PR-2 → PR-3 → **立刻 PR-4**。PR-4 是本计划的收尾，不是另一份「删 OpenClaw」方案。

不建议合并 PR-1 与 PR-2。PR-4 不要与 PR-2 合并（渠道删干净后再动依赖，排障更清晰）。

**排期无张力：** 提示进 PR-2；依赖切除进 PR-4（本计划内），不拖到整体下架 OpenClaw。

---

## 8. 验证清单

### 8.1 自动化

```bash
pnpm typecheck
pnpm exec vitest run tests/unit/channel-config.test.ts \
  tests/unit/channel-routes.test.ts \
  tests/unit/agent-config.test.ts \
  tests/unit/sanitize-config.test.ts \
  tests/unit/plugin-install.test.ts \
  tests/unit/builtin-tools-manifest.test.ts \
  tests/unit/theme-source-audit.test.ts \
  tests/unit/channel-mobile-session-key.test.ts \
  tests/unit/channel-mobile-history-cursor.test.ts \
  tests/unit/channel-hub-independent-bind.test.ts \
  tests/unit/whatsapp-login.test.ts
```

最后一项在第 1 期后应 **file not found**（测试已删），从命令中去掉。

全量 `pnpm test` 在 PR-2 合并前至少跑一轮。

### 8.2 手工（PR-2）

1. 频道页只看到：钉钉、微信、Mobile App。没有 Telegram / Discord / WhatsApp / 企微 / QQ。
2. 钉钉 Hub：扫码绑定、解绑、Agent 切换、消息收发（确认**未**再装 `@soimy/dingtalk`）。
3. 微信：扫码、取消、重扫覆盖单 Bot。
4. Mobile：二维码 / 启用禁用 / 状态刷新。
5. 侧栏：钉钉/微信/App 会话徽章仍在。
6. `openclaw.json` 无 `channels.dingtalk` / `plugins.entries.dingtalk`；`extensions/dingtalk` 若曾存在应已清理。
7. 设置页代理说明：不再出现 Telegram。
8. BOOTSTRAP / AGENTS：不再出现 WhatsApp、Telegram、企微插件包名。
9. 工作流「发到哪里」：无企微选项。
10. 安装优化文档 checklist：无 WeCom / QQ。

### 8.3 不要回归的行为

- 微信 Host Worker 不被 `cleanupDanglingWeChatPluginState`（`channel-config.ts`）误伤（仍要清 OC 微信插件 wiring）。
- **钉钉 Hub** 扫码 / 绑定 / 收发不受影响；`message-channel/hub/routes.ts` 与 `message-channel/{hub,common,mobile}` 行为不变。
- Gateway **不再**安装或加载 `@soimy/dingtalk`；`FORCE_RESTART_CHANNELS` 不再含 dingtalk/whatsapp。
- `sto-dingtalk-send-guard` 仍安装/生效。
- Mobile 不走 `ChannelType`；`hub/routes` 的 mobile 路由仍可用。

---

## 9. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 用户本地仍跑着 Telegram Bot | PR-1 sanitize 剥离配置；无 config 则 Gateway 不连 |
| 历史 catalog 行 `channel_type=telegram` | 不 migration；侧栏忽略未知来源 |
| `channel-config.ts` 误删微信分支或 Hub 相关逻辑 | 按符号表改；带**微信 dangling cleanup 单测** + **钉钉 Hub 绑定冒烟**（勿再要求「钉钉 allowlist 单测」——`ensurePluginAllowlist` 的 dingtalk 分支本身要删，见 §2.1.1 / 约 L334） |
| 中间状态 typecheck 失败 | 文件删除与引用删除同一 PR（PR-2） |
| 误改 `package.json` | 本期禁止 |
| 提示残留（settings / BOOTSTRAP / 工作流 wecom） | **全部进 PR-2 硬删**；PR-2 checklist 必勾 |

回滚：PR-1 可独立 revert。PR-2 revert 会恢复 UI，但若 PR-1 仍在，保存仍 410。

---

## 10. 完成后的目标形状

```
频道页
  ├── 钉钉（Hub 扫码）—— 无 OC @soimy/dingtalk 旁路
  ├── 微信（Host Worker 扫码，单 Bot）
  └── SClaw App（Hub mobile）

文案 / agent 模板
  └── 无 WhatsApp / Telegram / Discord / 企微 / QQ 等引导或举例

Host
  ├── electron/message-channel/{hub,common,mobile}   钉钉 Hub + Mobile（含 hub/routes.ts）
  ├── electron/api/server.ts 注册 handleChannelHubRoutes
  ├── electron/message-channel/weixin/*
  ├── sto-dingtalk-send-guard               发送守卫（保留）
  └── 无 ensureDingTalkPluginInstalled / CHANNEL_PLUGIN_MAP 渠道项

OpenClaw Gateway
  └── 仍作引擎宿主；不再加载 @soimy/dingtalk；不再被写入第三方渠道配置
```

`ChannelType` 不再承担「OpenClaw 全渠道目录」的角色。以后若要加渠道，走 `electron/message-channel/<name>/`，而不是加回 `CHANNEL_META`。

---

## 11. 本计划收尾 PR-4（依赖切除；紧接 PR-1～3，不等下架 OpenClaw）

PR-1～3 只切渠道产品面与 Host。下列依赖 **在 PR-3 合并后立刻做 PR-4**，属于**本计划一部分**，**不要**挂到「整体下架 OpenClaw」专项。

> 改 `package.json` / lockfile 须人工执行（`.sclaw/AGENTS.md` 禁止 AI 自动改依赖）。PR-4 由工程负责人落地。

### 11.1 删除已删渠道相关的原生 / 传递依赖条目

| 项 | PR-4 动作 |
| --- | --- |
| `pnpm.onlyBuiltDependencies` 中的 `@discordjs/opus`、`@whiskeysockets/baileys` | 从数组删除 |
| `pnpm.overrides.libsignal` | 删除该 override |
| `scripts/bundle-openclaw.mjs` 里对 `@discordjs/opus` 的 `SKIP_PACKAGES` 注释块 | 可一并删除（依赖都没了则无需再跳过） |

**仍留给「整体下架 OpenClaw」专项（PR-4 不碰）：**

- `openclaw` 包本体、Gateway 启动、`bundle-openclaw*` 整套脚本（引擎仍需要）
- `EXCLUDED_SKILLS` 整表（含 `'discord'` skill 排除）
- **`sto-dingtalk-send-guard`**（发送守卫，不是渠道插件）

**本计划已删、勿加回：** `@soimy/dingtalk` OC **渠道**插件接线（见 §2.1.1；在 PR-1～2 代码删除，非 PR-4 依赖项）。

**注意：** 若 `openclaw` 仍把 baileys/opus 声明为传递依赖，PR-4 删掉 `onlyBuiltDependencies` / `overrides` 后，`pnpm install` 可能仍拉到它们，或构建脚本告警变化。验收：`pnpm install`、开发启动、钉钉/微信/Mobile 回归。若 install 因缺 override 失败，在 PR-4 内修到绿，仍不拖延到下架 OC。

### 11.2 删除 `@tencent-weixin/openclaw-weixin` npm（立刻删，条件已满足）

与[`微信渠道-Host-Worker技术方案.md`](./微信渠道-Host-Worker技术方案.md) **不冲突**：该文多处「npm 须推迟到彻底剥离完成才删」仅约束 **R1 走 npm 退路**（Worker 仍 `import` 该包作传输库）时的情况。Phase 0 结论（约 L568）已写明：**「当前亦未使用 `@tencent-weixin/openclaw-weixin` npm 退路」**。故本计划 **PR-4 立刻从根 `package.json` 删除该依赖**，不必等整体下架 OpenClaw，也不必再等「彻底剥离」专项。

| 项 | PR-4 动作 |
| --- | --- |
| 根 `package.json` 的 `"@tencent-weixin/openclaw-weixin"` | **删除** |
| `message-channel/weixin/**`（vendor + transport） | **保留**（运行时走这里） |
| `vite.config.ts` `closeBundle` 写入的合成 `package.json`（约 L227 `name: '@tencent-weixin/openclaw-weixin'`） | **不要改、不要当依赖引用**。这是给 Worker 产物补 `name`/`version`/`ilink_appid` 的字面量，供 vendor `buildBaseInfo` 解析；删根 npm 依赖后此字面量仍应保留 |
| 残留注释 / AGENTS 里对该 npm 的举例 | 改为「已切除，勿加回」或删举例 |

**前置检查：**

```bash
rg '@tencent-weixin/openclaw-weixin' --glob '!**/node_modules/**'
```

预期命中（**属正常，不阻塞删除根 npm**）：

- `electron/message-channel/weixin/runtime/vendor/**` 自描述 / package.json
- **`vite.config.ts` 的 `closeBundle()` 字面量**（合成 dist package.json；非依赖引用）
- 文档 / AGENTS 举例（PR-4 顺手改文案）

不应再命中：业务 `import` / `require`、打包映射、install 候选源。然后：`pnpm typecheck`、微信扫码收发回归。

### 11.3 PR-4 完成标准

- [ ] `package.json` 无 `@tencent-weixin/openclaw-weixin`、无 baileys/opus 的 onlyBuilt、无 libsignal override
- [ ] lockfile 已更新且 CI install 通过
- [ ] 钉钉 / 微信 / Mobile 冒烟通过
- [ ] **未**删除 `openclaw` 包本体与 Gateway
- [ ] **未**误删钉钉 Hub / `sto-dingtalk-send-guard`
- [ ] `@soimy/dingtalk` 渠道插件接线已在 PR-1～2 删除（本 checklist 回归确认）

---

## 12. 修订记录

| 项 | 修正 |
| --- | --- |
| 提示策略 | **硬删**：凡点名已删渠道的用户/agent 可见字符串一律去掉，不另写兼容引导 |
| BOOTSTRAP / AGENTS / 安装 checklist / settings / 工作流 wecom | 从第 4 期 / PR-3 **上移到 PR-2**；§7 与 §4 口径一致，无「尽量提前」张力 |
| §4 范围外 | 工作流 wecom 选项改为必删；`preview-href` 的 `discord:` scheme 仍保留；`EXCLUDED_SKILLS` 的 `'discord'` 继续排除 skill |
| 微信 npm vs 技术方案 | **不冲突**：推迟删除仅针对 R1 npm 退路；L568 已确认未走退路 → §11.2 **立刻删**根 npm |
| §11.2 前置检查 | 注明 `vite.config.ts` `closeBundle` 字面量命中属预期，删 npm 不碰该文件 |
| 钉钉 OC 插件 | **删除** `@soimy/dingtalk` 接线；**保留** Hub 与 `sto-dingtalk-send-guard`。OC vs Hub **已核验可删**（§2.1.1） |
| §9 vs §2.1.1 | 「带钉钉 allowlist 单测」改为微信 dangling cleanup 单测 + 钉钉 Hub 绑定冒烟（allowlist dingtalk 分支本身要删） |
| Hub 交叉依赖敞口 | 由「待确认」定稿为「已核验安全」；文首 / §1 / §2.1.1 / §12 口径一致 |
| 依赖与微信 npm | **PR-4 立刻切，不等下架 OpenClaw**：opus/baileys/libsignal 条目、`@tencent-weixin/openclaw-weixin` npm；保留 vendor 与 `openclaw` 本体。见 §11 |
| 初版漏项 | settings、BOOTSTRAP、WINDOWS_INSTALLER、事件全名、channel-hub 归属、cleanup 位置、FORCE_RESTART、getAllChannels |
| `channels.ts` 搬家 | §4 增「后续备忘」：本期不整迁；清完瘦身后可选拆微信 routes / 薄壳 host-routes；§6.4 同步禁止本期搬家 |
