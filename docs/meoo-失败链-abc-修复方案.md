# 妙悟建站失败链修复方案（A/B/C 施工单）

> 2026-09-07 · Kimi 核查 + 方案，Cursor 施工
> 前置阅读：Cursor 诊断《核心不是「失败了怎么显示」，而是这一轮怎么才能做完》（2026-09-07 实机失败链）
> 本文所有行号基于 `cy/meoo` 分支当前工作区，施工前先比对，漂移以代码为准。

## 0. 失败链回顾与裁定

页面在 `https://meoo.com/chat/...`，composer 是 tiptap ProseMirror `contenteditable`：

1. `bridge_fill` → Element not found：AX 观测的 role 白名单把 `generic` 的 composer 裁掉，没颁 `@e`。
2. `bridge_click @e7` 成功但点错（信息不足，非 click 实现问题）。
3. 导航后 fill → STALE_REF：失败体只有 `{success:false, error, actionHint}`，不附最新观测，模型只能再发同参 snapshot，第 4 次被 loop-guard 拦住。
4. 流正常结束但正文只有控制行 `No response requested.`，被当成 completed 收掉，用户看到"卡住"。

**Kimi 核查结论：三个环节的机制描述全部属实**（行号证据见各节）。Gateway `must NOT have additional properties` 是旁路（根3 已修），不在本单范围。

### 约束（不要做）

- 不加提示词、不收紧 loop-guard、不用「本轮未完成」UI 横幅当产品解法
- 未确认不清 mem0 执行经验（毒经验 purge 另行拍板，不在本单）
- 不把"显示未完成"当主解

---

## A. Composer 必须能进观测、能 fill

### 机制事实（已核实）

- CDP `Accessibility.getFullAXTree` 返回的 AXNode `properties[]` 带 `editable: "richtext"|"plaintext"|"true"`，但没人消费：
  - embed 侧 [ax-observer.ts](../electron/services/browser-automation/ax-observer.ts) L184-195 `collectStates` 只白名单收 8 个属性（disabled/checked/selected/focused/required/readonly/modal/expanded），**不含 editable**
  - L27-45 `AX_INTERACTIVE_ROLES`（17 种 role）无 generic；L281 `interactive` 纯按 role；L441-449 只对 interactive 节点颁 `@e`
  - 扩展侧 [background.js](../browser-extension/background.js) L508-531 `assembleAxObservation` 是**逐字复制的同款白名单**（L516 同一卡点），且不读 `node.properties`
- **fill 写入链路两侧已就绪，本单零改动**：input.ts L267 `isContentEditable → textContent`；background.js L682 逐字同款。只要颁了 ref，fill 就能写。
- DOM 回退路径本来就没这个病：page-agent.js L93-95 选择器已含 `[contenteditable]`。

### 改动（两侧同构，各约 20 行）

**A1. `electron/services/browser-automation/ax-observer.ts`**

- `collectStates`（L184-195）属性白名单加 `'editable'`，收进 `states`
- L281 `interactive` 计算追加：`|| states.editable ∈ {'richtext','plaintext','true'}`——**role 保持原样，不要伪装成 textbox**
- L510-531 投影：`editable` 改为 `AX_EDITABLE_ROLES.has(role) || Boolean(states.editable)`；新增透出 `editableKind`（= states.editable 原值）

**A2. `browser-extension/background.js` `assembleAxObservation`（L508-531）**

- 从 `node.properties` 取 editable；白名单卡点放行；`compactElement` 加 `editableKind`
- 注意 L41 `AX_ELEMENT_LIMIT = 400`：放行 editable 节点后观察是否逼近上限

**A3. 类型**

- [shared/browser-bridge/page-observation.ts](../shared/browser-bridge/page-observation.ts) L16 `PageObservationElement` 与 [shared/browser-bridge/types.ts](../shared/browser-bridge/types.ts) L56-62 snapshot 元素：加 `editableKind?: 'richtext' | 'plaintext' | 'true'`
- 目的：模型拿到 ref 就知道该走 textContent 写入路径

**A4. 防再犯（根3 教训）**

- 新增 `tests/unit/ax-role-tables-sync.test.ts`：断言 ax-observer.ts 与 background.js 的三张 role 表逐字一致（照 `sto-browser-prompts-sync.test.ts` 的既有模式）。两侧是复制维护，不加同步测试下次还会漂。

### 不确定项（如实标注）

Chrome 对 tiptap composer 具体给什么 role、目标节点是否被 ignored 树裁掉，仓内无 PoC 记录。**施工第一步**：在 meoo.com 实机跑一次 `Accessibility.getFullAXTree`，确认 composer 节点的 `properties` 里确实有 `editable`。若没有，备选方案是走 DOM 遍历观测路径（page-agent.js 已支持），不要硬改 AX。

### 扩展打包注意

改完 background.js 需重新 pack 扩展并让用户 reload unpacked；**debug session 活着时不要 reload**（Cursor 诊断中已提醒，保留）。

---

## B. STALE_REF / ELEMENT_NOT_FOUND 必须自愈（失败附最新观测）

### 机制事实（已核实）

- **参照模式在仓内已存在**：BA 闸门3 [service.ts](../electron/services/browser-automation/service.ts) L640-656——先 `observeNow` 拿 `observationBefore`，发现换代时返回 `{ success:false, errorCode:'STALE_REF', observation }`。**字段名就是 `observation`**，类型见 [shared/browser-automation/types.ts](../shared/browser-automation/types.ts) L210。
- 但 BA 自己也只附了闸门3：闸门1（L605-618）和 ELEMENT_NOT_FOUND（input.ts L303）不附。
- 扩展侧 4 处失败点全部裸返回 `{success:false, error, actionHint?}`：background.js L579（click STALE）、L631（click NOT_FOUND）、L663（fill STALE）、L676（fill NOT_FOUND）。
- embed driver 3 处同样不附：[sclaw-embed-bridge-driver.ts](../electron/main/services/sclaw-embed-bridge-driver.ts) L290、L323、L327。

### 注入点论证（为什么必须在失败现场组装，而非 routes/插件层补采）

- 扩展侧：debugger 句柄、`axRefMaps`、`documentGenerations` 都在 background.js 进程内，`assembleAxObservation` 是现成同步函数；且新观测的代际 bump 与旧 refMap 失效本就绑定在同一处（L533/L540），分开做无法保证代际自洽
- desktop routes 层手里没有页面句柄；插件层补采等于再发一次 snapshot 命令（多一整轮 HTTP + 扩展轮询，最坏秒级）——正是要消灭的东西
- embed 侧同理：driver 手里有 wc + cdp session，进程内调用零延迟，结构与 BA 闸门3 同款

### 改动清单

| 文件 | 位置 | 改动 |
|---|---|---|
| `browser-extension/background.js` | L579、L631、L663、L676 | 失败分支附 `observation: assembleAxObservation(tabId, ...)` |
| `electron/main/services/sclaw-embed-bridge-driver.ts` | L290、L323、L327 | 失败分支调现成 snapshot 能力附 `observation` |
| `electron/services/browser-automation/service.ts` | L605-618 闸门1 | 附 `observation`（与闸门3 同构） |
| `shared/browser-bridge/types.ts` | 新增 `BrowserBridgeCommandFailure` | `{ success:false; error; errorCode?; actionHint?; observation?: PageObservation }`；`BrowserBridgeCommandResult.result`（L44-50，现为裸 `unknown`）收窄为联合类型 |
| 上述各处 actionHint 文案 | — | 改为「**用本次返回 observation.elements 里的新 @e 直接重试**」，删除「请重新 snapshot」类措辞 |

### 下游零改动（已核实）

- claude 侧 [sto-browser-tool/tools.ts](../sto-plugin/claude/sto-browser-tool/tools.ts) L40-46 `annotateFailedToolPayload` 只加 actionHint、其余原样透传
- openclaw 侧 [tool-envelope.ts](../sto-plugin/openclaw/sto-browser-bridge/tool-envelope.ts) L34-48 `envelopeFromExecuteResult` 的 `data` 原样保留
- 观测随失败体自然到达模型，且以 `isError:true` 呈现（根2 成果在此兑现）

### 与感知预算的关系

失败附带观测会放大上下文占用，但失败是低频路径，可接受；后续感知预算（分页/只回可交互子集）落地后这笔开销自然下降。**B 不必等感知预算。**

---

## C. 控制行成功不能停跑（自动续一轮）

### 机制事实（已核实）

- result 一到就 `emitAgentCompleted`（[claude-adapter.ts](../electron/engines/claude-adapter.ts) L1033-1040），**无任何内容感知分支**；EOF 兜底在 L1183-1190
- `isClaudeRuntimeControlAssistantEntry`（L459-470）已能识别控制行 assistant entry，但**只用于历史加载过滤**（L566），不参与 run 完成判定
- SDK 注入的 `[Your previous response had no visible output. Please continue…]` **全仓无人识别**，会以普通 user 消息漏进 UI
- 现成续跑注入机制：`startClaudeQuery` L1300-1303——resume 且 prompt 为空/继续语时，自动替换为 `buildClaudeResumeContinueUserPrompt(cause)`（[claude-resume-plan.ts](../shared/claude-resume-plan.ts) L30），**机制零新增**
- abort 互斥可查：`peekRunInterrupt(sessionKey)`（[run-interrupt-store.ts](../electron/engines/run-interrupt-store.ts) L23-25）在下一次注册时才被消费，续跑决策点读到的值有效

### 改动（全部在 adapter 层——判定依据只在 consume 循环里拿得到）

**C1. 判定**：在 result 分支（L1008-1040）与 EOF 兜底（L1183-1190）加内容检查：

- 本 turn assistant 正文纯控制行（把 `isClaudeRuntimeControlAssistantEntry` 的判定逻辑上移为共享函数复用），或无 tool_use 且正文为空（thinking-only）→ `turnWasContentless = true`

**C2. 续跑触发**：`turnWasContentless` 且三个互斥条件同时满足——

1. `autoResumeCountBySession.get(sessionKey) < 1`（每条用户消息最多续 1 次）
2. `peekRunInterrupt(sessionKey) !== 'user_abort'`（停止按钮后绝不续跑）
3. registry 当前 owner 仍是本 runId（防串轮）

→ **不 emit completed**，内部再调一次 `startClaudeQuery`，prompt 传空串（自动走 resume + continue prompt 替换），cause 落 `'unknown'` 分支。传 `suppressStartedEvent: true, initialSeq: 1`（recovery 路径 L1527-1528 现成用法），UI 不出现第二个空气泡。

**C3. 计数器**：模块级 `Map<sessionKey, number>`（照 `lastClaudeInterruptBySession` L307-318 模式）。

- 清零时机：用户真实新消息 dispatch（`resumePlan.mode === 'new'` 处）、续出真实内容正常完成时
- 键带原 runId 防串轮

**C4. 顺手补识别**：`isClaudeRuntimeControlText`（[shared/claude-runtime-control-text.ts](../shared/claude-runtime-control-text.ts) L4-10）加一条规则识别 SDK 的 "no visible output" 注入句——否则它以 user 消息身份漏进聊天 UI（现有 4 处 UI 过滤点都依赖这个函数，补一处全生效）。

**兜底**：计数上限 1 是第一道；全局 `RUN_HARD_DEADLINE_MS = 6h` 兜底已存在，不新建机制。

---

## 测试清单（随施工交付）

| 测试 | 断言 |
|---|---|
| AX 观测 | `properties` 带 `editable:"richtext"` 的 generic 节点获得 `@e` ref，投影含 `editableKind` |
| role 表同步 | ax-observer.ts 与 background.js 三张 role 表逐字一致（A4） |
| 失败附观测 | 构造 STALE_REF：失败体含 `observation.elements` + `documentGeneration`，actionHint 指向新 elements |
| 失败体类型 | `BrowserBridgeCommandFailure` 编译期约束；envelope 透传后 observation 仍在 |
| contentless 判定 | 纯控制行 turn / thinking-only turn 不 emit completed |
| 续跑互斥 | `user_abort` 后不续跑；owner 变更后不续跑；上限 1 生效；真实新消息清零计数 |
| 控制行识别 | "no visible output" 注入句被 `isClaudeRuntimeControlText` 命中 |

## 验收标准（实机）

1. **A**：meoo.com snapshot 中 composer 出现在 elements 且带 `editableKind:"richtext"`；`bridge_fill` 该 ref 成功写入
2. **B**：点击引起导航后再 fill 旧 ref，失败体含 `observation.elements`；模型下一步用新 `@e` 重试，**不重发同参 snapshot**
3. **C**：复现 thinking-only turn，run 不收、自动续一轮并出真实内容；连点停止按钮后不再续跑
4. 端到端：重跑 2026-09-07 那单妙悟建站任务全程——这是唯一算数的验收

## 工期与顺序

| 项 | 工期 | 说明 |
|---|---|---|
| A | 半天 | 含实机 PoC 确认 + 扩展重打包 |
| B | 一天 | 7 处失败点 + 类型 + 测试 |
| C | 一天 | 判定 + 计数器 + 互斥 + 测试 |

顺序 A → B → C（Cursor 提议，Kimi 同意）。三项都在工作区未提交改动之上施工，注意别覆盖既有修改。

## 明确不在本单

- mem0 毒执行经验 purge（待用户拍板后单独执行）
- 感知预算/分页（bridge_snapshot 上下文瘦身，原计划 A 项，排在本单之后）
- R1b 设计文档（SessionRuntime 状态机 + 续跑协议，并行进行中，交 Kimi 评审）
- commandTimeoutMs ceiling 化（R0 尾巴）
- 渲染层类型错误收尾（ChatMessage.tsx / segmented-markdown.tsx）、openclaw-doctor 等基线测试失败
