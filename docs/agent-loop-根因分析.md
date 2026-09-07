# SClaw Agent（Claude Agent · kimi-k3）浏览器任务表现远逊 Kimi · 根因分析

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-04 |
| 状态 | 已评审，待修 |
| 触发 | 用户反馈："sclaw 操作浏览器体验不如 kimi"、"感觉是我们 agent 的问题，k3 模型远不如 kimi" |
| 现场 | 妙悟站点分析任务：截图失败被模型转述为"权限限制"；随后 8+ 回合"重新检查会话状态"死循环；模型自述"流中断"、"The user keeps sending empty messages"；sessionId 中途从 `ext-464165454-fd4e…` 变为 `ext-464165454-f5c3…` |
| 结论一句话 | **主要是 harness 的锅，其次是提示词，模型本身排最后**——同一个 k3，换血 harness 可解决大部分症状 |

---

## 一、三条独立根因链

### 根因 A：bridge 会话"重建即换身份" → 死循环（协议层）

因果链（证据见 §四）：

1. **触发**：MV3 service worker 被挂起（~30s 空闲 / ~5min 硬上限 / 合盖休眠）、SClaw 主进程重启或更新（会话纯内存态，不持久化）、总开关 off→on 吊销 token；
2. **剪枝**：心跳中断 >60s（`BROWSER_BRIDGE_SESSION_STALE_MS`）→ 服务端 `pruneStale` 删会话+删命令队列（browser-bridge-service.ts L427-435）；
3. **重连换 ID**：扩展唤醒 → heartbeat/poll 收 404（或 403→auto-connect→全 tab 重连）→ **现场构建的扩展每次 connect 铸造新 UUID**（`ext-<tabId>-<uuid>`，docs/browser-bridge-extension-plan.md L64 的建议格式；仓内 zip 旧构建是同 tab 复用 ID）；服务端 `connectSession` 同时把同 tab 旧会话直接顶掉（L152-158）——旧 ID 从此永久 404；
4. **模型撞墙**：模型缓存旧 ID → `{"success":false,"error":"Session not found"}`，错误里**不带新 ID、不带 tabId、不带任何重建语义**；`browser:connected` 事件全仓零订阅者；
5. **自救路径被堵**：提示词要求"一直用同一个 sessionId""禁止再 list_sessions"（shared/browser-bridge/prompts.ts L5-6）；显式传 sessionId 时 bridge-client 绝不做 fallback——**协议层 + 提示词层合力制造"ID 变了但谁都不许说、不许查"的死局**；
6. **循环**：模型只能违规 list_sessions 拿新 ID → 重试成功一两次 → 下一次 SW 代际切换又剪枝 → 回到第 3 步。30 分钟任务约经历 6 次 SW 代际切换，每次都是换 ID 赌博。

附带分裂行为：排队中的命令随旧会话静默蒸发（调用方只能等超时）；已派发到扩展的命令结果却能奇迹生还（/result 不校验会话存在性）。

### 根因 B：续跑架构"一回合一次新 query + 空 user turn"（harness 层）

- 聊天路径每条用户消息 = 一次全新 SDK query + `resume: sessionId`（claude-adapter.ts L1321-1325, L1692-1699）。流中断后**没有任何自动 resume**，只有 `turn.failed` 终态（L1130-1138），等用户手动"继续"；
- resume = SDK transcript 重放，但**中断时在途的半个 assistant turn 不落盘**，且**不注入任何中断原因**——模型只看到状态对不上，于是"我先重新检查会话状态"。工作流路径其实已有现成好做法（agent-retry.ts L160-166 把上次失败原因写进重试 prompt），**没有复用到聊天路径**；
- "The user keeps sending empty messages" 的三重来源：① 空 sendText 的"继续"胶囊/手打"继续"（主进程路由不校验非空，gateway.ts L97-107）；② **每个 tool_result 在 transcript 里都是一条无文本 user-role 消息**——8+ 次 resume 后 transcript 充满"没文字的 user 消息"；③ Claude Code 注入的合成 user 消息（用户看不见、模型全看见）。"No response requested." 控制文本（shared/claude-runtime-control-text.ts L5）证实空 user turn 是既成事实；
- **"流中断"的首要嫌疑**：SDK 默认 60s 流关闭阈值（sdk.d.ts L435，`CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`）与 bridge-client 给 read_page/screenshot 的 60_000ms 超时**精确对撞**——工具接近 60s 时 SDK 先掐断整条回合流。仓内两处超时环境变量均未设置（grep 0 命中）。

### 根因 C：给非 Claude 模型套 Claude Code 全家桶（提示词/装配层）

- systemPrompt = `claude_code` preset（CLI 编程 agent 全套，约 1 万 token）+ **10 个 extension 拼接 append ≈ 8-12k 字符**，叠加 **~50 个工具**（bridge_* 11 个与 ba_* 12 个功能大面积重叠）；
- 路由规则三处口径互相矛盾：BRIDGE 提示"简单点击直接 bridge_click，无需先 snapshot" vs BA 提示"操作前必须 ba_observe" vs embed 上下文"不要再调 ba_observe/ba_wait/bridge_snapshot"；embed 上下文块还有逐字重复行（sclaw-browser-embed-context.ts L91-92）；
- 提示词在用"禁止空转、禁止再 list_sessions"补救 harness 的洞——对指令遵循较弱的模型不可靠；
- 每回合固定重税：≥5 个无 matcher 的 PreToolUse hook；遥测 hook 对每次工具调用 **await 两个 5s 超时的 HTTP POST**（sto-agent-telemetry/sdk/runtime-options.ts L237-256, L276-353）；
- 上下文无压缩：transcript 全量累积重放，浏览器工具 payload 极肥（单次 observe 120 元素 10-20KB；read_page 单次最多 24k 字符；embed 会话**每条用户消息**再注入 2.5-4k 页面上下文块）。8 个"继续"回合后上下文超 100k 字符量级，每轮全量重发。

---

## 二、根因排序：为什么 k3 在 SClaw 里远不如在 Kimi 里

| 排名 | 归属 | 内容 |
|---|---|---|
| ① | **Harness** | 续跑架构：中断无自动重试、无中断原因注入、"继续"=新 user turn+全量重放，模型丢失"刚才在做什么/怎么失败的" |
| ② | **Harness** | 零 loop 防护：无 maxTurns、无重复工具调用检测、无进度守卫——"检查状态→叙述→等继续"可无限循环 |
| ③ | **协议** | bridge 会话重建即换身份 + 错误不带新 ID + 提示词禁止自查 → 死循环 |
| ④ | **提示词** | Claude Code preset + 10 段 append + 双工具面路由矛盾 + 重复行，k3 只能抓住最显眼的局部规则，表现为机械复读 |
| ⑤ | **Harness** | 每回合重税：遥测 hook 阻塞工具关键路径、空 user turn 产生无意义控制回合 |
| ⑥ | **模型** | k3 非为 Claude Code harness 训练，对 preset 惯例/Stop 语义/tool_result=user-message 结构适配弱，倾向"做一步说一段收尾"——但在 Kimi 自家 harness 里此短板被补齐，故排最后 |

对照 Kimi 的成熟做法：传输层重试同一模型请求（中断对模型不可见）；不可恢复时注入 system-role 的"上轮在 X 工具中断"摘要；续跑指令是系统注入不是空 user 消息；重复工具调用检测 + 步数预算；工具失败结构化 `is_error+原因` 留在 tool_result；工具结果摘要化；浏览器工具一套、路由由 harness 决定。

---

## 三、修复清单（按投入产出排序）

### 第一梯队（纯仓内、小改动、消灭主要症状）

1. **bridge 会话自愈（根因 A）**：
   - 服务端 `/command` 404 响应带 `{error:'SESSION_STALE', currentSessionId}`；或 heartbeat 对"token 合法但会话不存在"做同 ID 复活（upsert）；
   - bridge-client 收到 Session not found 时自动按 tabId 重选会话重试一次（对模型透明）；
   - 提示词"禁止再 list_sessions"改为"仅在收到 Session not found 时允许查一次"；
   - `browser:connected` 事件接进聊天 UI（至少用户可见）。
2. **失败可操作化 + isError 修正**：runBridgeTool 统一 `success:false → isError:true` + 按 action 附降级建议；define-sto-tool.ts L48-54 的 envelope success 与 data.success 联动（消灭"模型编理由=权限限制"）。
3. **流中断续跑注入（根因 B）**：resume 时注入"上轮中断点 + 最后工具结果摘要"的系统提示（复用 agent-retry.ts L160-166 模式）；设置 `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`（如 300000）+ MCP server 显式 `timeout`（如 180s），保证 SDK 超时 > bridge-client 超时 > 扩展执行预算三级递减。
4. **提示词收敛**：去掉强制"先 list_sessions"（改"直接 navigate/click 自动选会话，失败再排查"）；删 embed 上下文重复行；bridge_*/ba_* 路由规则单源化。

### 第二梯队（中改动）

5. **loop 防护**：聊天路径加 maxTurns + 重复工具调用检测（同工具同参 N 次即注入干预提示）。
6. **bridge_\* 动作后自动附快照**：runBridgeCommand 在 click/navigate 成功后内联合并一次 snapshot（对齐 ba_act 的 service.ts L764-771）。
7. **遥测 hook 移出关键路径**：改 fire-and-forget。
8. **OpenClaw 侧截图 token 炸弹**：bridge_screenshot 同步 image-content 处理或走 artifact 落盘（Claude 侧已修）。

### 第三梯队（扩展仓/较大）

9. **扩展侧**：sessionId 每 (tab, 浏览器会话) 只铸一次（回 zip 语义）；screenshot 区分"自己 attached"vs"Another debugger"（正则放宽是 bug）、`fromSurface:false` 优先不抢前台、错误码标准化（RESTRICTED_PAGE/DEBUGGER_OCCUPIED/SCREENSHOT_FAILED）；核对现场构建 readPage 的 `awaitPromise`（zip:background.js L599-612 为 false，异步实现会返回 undefined）。
10. **失败原文可观测**：/sessions 输出带 lastError，任何"模型转述"可随时核对原文。

### 前序评审遗留（browser-automation-parity 评审的 6 项仓内缺口）

networkIdle 数据源未切换、总开关对 bridge 链路不住、Claude 侧 ba_* 无 feature-off 门、`GET /sessions/:id/dialogs` 缺失、prompt-builder 无代际语义、fill 前 disabled/readonly 检查缺失；扩展文档 6 条技术债（alarms 权限、host_permissions 矛盾、SW 挂起重建路径、click 遮挡探针、tab 组去重、CSP 标记）。

---

## 四、关键证据索引

**根因 A（会话漂移）**：browser-bridge-service.ts L152-158（同 tab 顶替）/ L427-435（60s 剪枝）/ L41（内存态会话）；routes/browser-bridge.ts L258-261（404 Session not found）/ L300-303（错误不带新 ID）；shared/browser-bridge/types.ts L62；zip:background.js L158（zip 复用 ID）vs docs/browser-bridge-extension-plan.md L64（uuid 建议）；prompts.ts L5-6。

**根因 B（续跑架构）**：claude-adapter.ts L1130-1138（turn.failed 终态）/ L1321-1325（resume 新 query）/ L571-606（history bridge 仅 session 丢失时触发）；message-queue.ts L499（出错不自动 drain）；chat-runtime-supervisor.ts L22（135s 看门狗只标终态）；agent-retry.ts L160-166（工作流路径的失败注入）；sdk.d.ts L435（60s 流关闭）；sto-plugin/claude/sto-browser-tool/bridge-client.ts L82-83（60s 工具超时对撞）。

**根因 C（提示词/装配）**：claude-adapter.ts L1242-1311（claude_code preset + append）；claude-runtime-extensions.ts L260-271（10 个 extension）；shared/browser-bridge/prompts.ts L9 vs sto-plugin/openclaw/sto-browser-automation/prompts.ts L10 vs src/lib/sclaw-browser-embed-context.ts L90-92（三处矛盾+重复行）；sto-agent-telemetry/sdk/runtime-options.ts L237-256（遥测阻塞）；sclaw-browser-page-capture.ts L6（每条用户消息 6k 页面摘要）。

**"权限限制"证伪**：扩展 zip 全文 grep 无 permission 文案；cmdScreenshot 走 chrome.debugger + Page.captureScreenshot（zip:background.js L446-467），从未调用 captureVisibleTab；define-sto-tool.ts L48-54 把 {success:false} 包成 success:true 信封。

## 五、未验证项

- 现场扩展真实源码（UUID 铸造点、boot 是否主动 connect、readPage awaitPromise）——需 chrome://extensions 查 Service Worker 或读安装目录；
- SDK 60s 流关闭精确默认值（sdk.mjs 压缩，仅 sdk.d.ts 文档性描述）；
- 失败时的 result.error 原文（复现后 `curl 'http://127.0.0.1:3210/api/browser-bridge/result?commandId=<id>'` 可拿到）。
