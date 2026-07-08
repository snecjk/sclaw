# 对话流全局稳定化修改方案 · Cursor 执行文档

> 本文档给 Cursor 使用。重点不是修某个局部 bug，而是建立一套全局一致的对话流架构，避免“改好 A 又弄坏 B”。
>
> 适用范围：OpenClaw / Claude 双引擎的思考过程、工具调用、正文展示、完成态判断、等待态、排队、中断、工作流、参数确认、artifact 输出。
>
> 施工前必须遵守项目 `AGENTS.md`、OpenSpec 流程、`docs/sto-design.md`、renderer/main API 边界。不要修改依赖、lockfile、构建配置、CI、脚本。

---

## 0. 现在为什么总是修一个坏一个

当前对话流有三类逻辑互相抢控制权：

1. **运行生命周期**
   - `sending`
   - `activeRunId`
   - `pendingFinal`
   - `lastUserMessageAt`
   - `streamingMessage`
   - `streamingTools`
   - `agent.completed`
   - history poll

2. **消息内容归类**
   - raw assistant text
   - thinking
   - tool_use
   - tool_result
   - phase text
   - final reply
   - workflow card
   - parameter form
   - artifact

3. **UI 展示状态**
   - active thinking 展开
   - completed summary 折叠
   - loading / 正在整理工具结果
   - 正文气泡
   - 复制 icon / 时间
   - 等待用户回复
   - 中断标记

现在这些逻辑分散在多个文件里，并且很多判断是局部的：

- 有的地方看到 assistant text 就认为完成。
- 有的地方等 `agent.completed` 才认为完成。
- 有的地方把 text 当正文。
- 有的地方把同一 text 当 phase text。
- 有的地方用 cache 补工具。
- 有的地方 UI 再 merge 一遍 timeline。

所以必须先统一“运行是否结束”和“内容是什么”，再谈具体 UI。

---

## 1. 总目标

把当前对话流改成四层架构：

```text
RuntimeEvent / HistoryMessage
        ↓
TurnLifecycleReducer 运行生命周期
        ↓
TurnPartNormalizer 内容标准化
        ↓
TurnPartGroupRenderer UI 分组渲染
```

Cursor 不要再在某个组件里临时判断“这个应该是正文还是思考”。所有判断必须经过统一层。

---

## 2. 不变量

下面是不允许被破坏的全局规则。

### 2.1 运行生命周期不变量

1. OpenClaw 多步 agent run 中，**中间 assistant final 不等于整轮完成**。
2. OpenClaw 真正完成以 `agent.completed` 或明确 terminal signal 为准。
3. Claude 真正完成以 runtime result done / agent completed / 明确 terminal signal 为准。
4. history poll 不能仅凭“出现 assistant 非工具文本”就清掉 `sending`。
5. 只要当前 turn 未完成，正文下方不得显示复制 icon / 分享 / 时间。
6. “正在思考 / 正在整理工具结果 / 等待回复 / 执行中”都属于未完成态。
7. Stop 后保留已输出内容，并显示已中断，不把它伪装成正常完成。

### 2.2 内容顺序不变量

1. 按首次出现时间排序。
2. live 看到 A/B/C，history 刷新后仍应是 A/B/C。
3. 不强制 `phase text -> tool group -> final reply`。
4. Claude 先吐正文再吐工具，按真实顺序展示。
5. OpenClaw 中间吐短 text 再继续工具，短 text 不应让整轮结束。

### 2.3 文本不变量

1. 已展示文本只允许同句补全。
2. 不允许语义替换。
3. 用户原问 echo 隐藏。
4. 过程旁白进入思考区。
5. 真正交付内容进入正文。
6. 同一段内容不能同时在思考区和正文重复展示。
7. 用户使用中文提问时，用户可见旁白和正文应优先中文。

### 2.4 工具不变量

1. 工具 identity 不包含 input。
2. input 是 payload，不是 identity。
3. 空 input 不能覆盖已有非空 input。
4. `unknown input` 不等于 `无参数`。
5. 只有确认工具真实无参数时才显示“无参数”。
6. cache 只能补充，不能压过真实 `tool_use.input`。

---

## 3. 当前必须统一的关键文件

Cursor 改动前先读这些文件，确认当前工作区已有改动，不要盲目覆盖。

### 3.1 运行生命周期

- `src/pages/Chat/use-chat-display.ts`
- `src/pages/Chat/chat-turn-meta.ts`
- `src/pages/Chat/ChatMessage.tsx`
- `src/stores/chat/run-completion.ts`
- `src/stores/chat/history-actions.ts`
- `src/stores/chat/runtime-event-handlers.ts`
- `src/stores/chat.ts`
- `src/stores/gateway.ts`

重点：

- `resolveAssistantFinalTerminalState`
- `isCurrentUserTurnIncomplete`
- `finalizeOpenClawRunAfterAgentCompleted`
- `shouldAutoCompleteClaudeFromHistory`
- `showAssistantMessageMeta`

### 3.2 内容归类和思考过程

- `src/pages/Chat/AssistantTurnMessage.tsx`
- `src/pages/Chat/thinking-turn-segments.ts`
- `src/pages/Chat/thinking/classify-text.ts`
- `src/pages/Chat/thinking/engine-profiles.ts`
- `src/pages/Chat/thinking/thinking-turn-process.tsx`
- `src/pages/Chat/message-utils.ts`

重点：

- `parseThinkingTurnLayout`
- `isLikelyPlanningNarration`
- `isLikelyDeliverableReply`
- `shouldPromoteTextToFinalReply`
- `finalizeReplyText`

### 3.3 工具调用

- `src/stores/chat/helpers.ts`
- `src/lib/thinking-done-tools.ts`
- `src/lib/thinking-turn-tools-cache.ts`
- `src/lib/thinking-timeline-active.ts`
- `src/components/chat/chat-tool-call-card.tsx`

重点：

- `extractToolUseUpdates`
- `upsertToolStatuses`
- `resolveDoneTurnStreamingTools`
- `thinkingTimelineToolKey`
- `hasDisplayableToolInput`

---

## 4. 全局目标模型

### 4.1 TurnLifecycle

新增或集中维护一个生命周期模型，不要让 UI 自己猜：

```ts
type TurnLifecycleStatus =
  | 'idle'
  | 'connecting'
  | 'thinking'
  | 'streaming'
  | 'finalizing'
  | 'tool_running'
  | 'tool_input_streaming'
  | 'organizing_tool_results'
  | 'waiting_user'
  | 'queued'
  | 'interrupted'
  | 'completed'
  | 'failed';

type TurnLifecycle = {
  turnKey: string;
  engineType: 'openclaw' | 'claude';
  runId?: string | null;
  status: TurnLifecycleStatus;
  isTerminal: boolean;
  canShowMeta: boolean;
  canAutoScroll: boolean;
};
```

核心规则：

- `canShowMeta = isTerminal && status === 'completed'`
- `interrupted` 可以显示中断 meta，但文案必须标记已中断。
- `failed` 可以显示失败原因，不显示成正常完成。
- OpenClaw / Claude 的中间 `final assistant text` 都只是 event fragment，不是 lifecycle terminal。
- 对 agentic run 来说，正文片段出现不等于 turn 完成；只有明确 terminal signal 才能让 `canShowMeta=true`。
- loading 文案必须由 `TurnLifecycle.status` 或同源的 `TurnProcessStatus` 派生，不能由组件里的 `isConnecting/isProcessing/isStillExecuting` 多个布尔值拼出来。
- 只要 `isTerminal=false`，就必须有一个明确的当前状态：连接中、思考中、调用工具中、整理工具结果、生成回复、等待用户、排队、仍在执行、中断或失败。

### 4.2 TurnPart

所有消息内容统一成 part：

```ts
type TurnPartKind =
  | 'user_echo_hidden'
  | 'process_text'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'final_text'
  | 'workflow_card'
  | 'confirmed_params'
  | 'artifact'
  | 'waiting'
  | 'queued'
  | 'interrupted'
  | 'error';
```

每个 part 必须有：

```ts
type TurnPartBase = {
  id: string;
  kind: TurnPartKind;
  firstSeenOrder: number;
  source: 'live' | 'history' | 'cache' | 'tool_result' | 'ui';
  status?: 'running' | 'completed' | 'error' | 'interrupted';
};
```

工具 part 必须有：

```ts
type ToolInputState = 'unknown' | 'partial' | 'complete' | 'none';

type ToolTurnPart = TurnPartBase & {
  kind: 'tool_call';
  toolIdentity: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
  inputState: ToolInputState;
  output?: unknown;
};
```

注意：

- `inputState: 'unknown'` 是“还没拿到参数”。
- `inputState: 'none'` 才是“无参数”。
- UI 不允许通过 `input == null` 自己判断无参数。

### 4.3 TurnGroup

UI 只消费 group：

```ts
type TurnGroup =
  | { kind: 'process_group'; parts: TurnPart[]; state: 'active' | 'completed' }
  | { kind: 'final_text'; parts: TurnPart[] }
  | { kind: 'workflow'; parts: TurnPart[] }
  | { kind: 'artifact'; parts: TurnPart[] }
  | { kind: 'system'; parts: TurnPart[] };
```

连续 process parts 组成 process group：

- `process_text`
- `reasoning`
- `tool_call`
- `tool_result`
- `waiting`

以下 part 打断 process group：

- `final_text`
- `workflow_card`
- `confirmed_params`
- `artifact`
- `error`
- `interrupted`

---

## 5. 针对当前已知 bug 的全局修法

### 5.1 通用：还在思考/执行，却显示复制 icon 和时间

现象：

- 图一显示正文下出现复制 icon 和“刚刚”。
- 但实际还在思考/工具执行。
- 切换对话再回来又恢复成图二的执行中状态。
- 该问题不只发生在 OpenClaw，Claude 引擎下也会出现；因此不能按某个引擎特例修。

根因方向：

1. history poll 或 final event 看到中间 assistant text，提前清了 `sending/pendingFinal/lastUserMessageAt`。
2. `ChatMessage` 的 meta 展示只看局部 `isStreaming/currentUserTurnIncomplete`，没有统一 lifecycle。
3. OpenClaw / Claude 中间 `assistant final` 被某些路径当成 terminal output。
4. 切换会话后 reload history 又重新识别出 tool/thinking activity，所以状态回来了。
5. Claude 在工具调用、多段正文、runtime result 尚未完成时，也可能先落一段 assistant text；这段 text 不能让 UI 进入完成态。

全局修法：

1. 只允许 `TurnLifecycle` 决定 `canShowMeta`。
2. OpenClaw 未收到 `agent.completed` 或明确 terminal signal 前，`canShowMeta=false`。
3. Claude 未收到 runtime result done / agent completed / 明确 terminal signal 前，`canShowMeta=false`。
4. history poll 不能因为出现 assistant text 就结束 agentic run。
5. `showAssistantMessageMeta` 改为依赖 `turnLifecycle.canShowMeta`，不要局部猜。
6. 中间 assistant text 归为 `process_text` 或暂存为 non-terminal `final_text candidate`，但不影响 lifecycle。
7. `pendingFinal` 只能表达“等待最终结果/整理工具结果”，不能被当作“已有 assistant text 所以完成”的反向信号。

验收：

- OpenClaw 中间输出 text 后继续 tool，复制 icon 不出现。
- Claude 中间输出 text 后继续 thinking/tool/runtime，复制 icon 不出现。
- “刚刚”不出现。
- loading / 正在整理工具结果继续显示。
- 收到对应引擎的 terminal signal 后才显示 meta。

### 5.2 OpenClaw：短 text 和正文大量英文

现象：

- `Now let me query...`
- `Now let me also get...`
- 英文短 text 出现在思考旁白。
- 多段英文又被拼进正文白色气泡。

根因方向：

1. 模型本身没有被强约束中文输出。
2. `isLikelyPlanningNarration` 主要识别中文旁白，不识别英文 planning narration。
3. 多段英文拼长后被 `isLikelyDeliverableReply` 当成正文。
4. phase text 和 final reply 去重只处理部分情况，导致重复。

全局修法：

1. Prompt 层：OpenClaw agent/system prompt 增加中文输出规则：
   - 用户用中文时，所有用户可见正文和过程旁白必须中文。
   - 工具参数、命令、字段名、代码可以保留英文。
2. Parser 层：英文 planning narration 也归为 `process_text`：
   - `Now let me...`
   - `Let me...`
   - `I will...`
   - `I'll...`
   - `Next, I...`
   - `I need to...`
   - `Now I'll...`
3. 正文层：如果 text 已作为 `process_text` 展示，不得再次进入 `final_text`。
4. 不要 UI 强制翻译英文，避免误翻工具命令和字段。

验收：

- 英文过程旁白不再进入正文气泡。
- 用户中文提问时，正常回答为中文。
- 工具命令、JSON 字段、路径仍保留原文。

### 5.3 Claude：大量“无参数”工具调用

全局修法：

1. `extractToolUseUpdates` 必须保留 `input`。
2. `upsertToolStatuses` 使用 input quality merge。
3. `resolveDoneTurnStreamingTools` 合并 cache/messages/toolResults，不要 cache 优先 return。
4. 工具 identity 不包含 input。
5. UI 使用 `inputState`，不要用 `input == null` 判断无参数。

验收：

- running tool 未拿到 input 时不显示“无参数”。
- cache 无 input 不覆盖 message 有 input。
- 同一工具 input 从空变有，不生成两张卡。

### 5.4 通用：停留当前对话时短 text 堆积，切换回来后才拆进思考统计

现象：

- 一直停留在当前对话时，多段短 text 堆在一起，像一大段正文或一大段过程说明。
- 切换到别的对话再切回来后，同样内容被拆成多段，插入到 `思考 N 次，使用 M 个工具` 之间。
- 用户想要的是图二那种“实时就按批次拆分”的效果，而不是靠切换/刷新 history 后才出现。
- 如果该现象仍然出现，说明只修了终态/meta 或 done/history parse，没有真正完成 live/history 统一分段。此项是 P0 阻断项，不能作为“后续优化”处理。

这和 5.1 是同一类全局问题，但更具体：**live 流式路径和 history reload 路径没有使用同一套分段模型**。

根因方向：

1. live 时，`streamingMessage/streamingText/streamingTools` 可能只保留当前 snapshot，短 text 被当成连续正文或 opening text 追加。
2. history reload 后，`turnMessages/chronologicalEntries/toolResults` 更完整，`parseThinkingTurnLayout` 才能看见 text/tool/text/tool 的完整顺序，于是重新拆成多个 process group。
3. live 路径和 history 路径调用的 source 不一致，导致同一 turn 在两个时刻产生不同 segment。
4. UI 层 stable cache / monotonic merge 为了防抖保留旧结构，可能阻止 live parser 及时拆分。
5. `phase-text` 的 flush 依赖“已经看到 tool group / 已 flush / done normalize”等条件，live 时条件不足，history 时条件满足。

全局修法：

1. live event 和 history message 必须进入同一个 `TurnPartReducer`。
2. reducer 收到新的 `process_text` 时，如果前面已有 active `tool_call/tool_result` 批次，应立即完成前一个 process group，并把该 text 作为下一段 process text。
3. reducer 收到新的 `tool_call` 时，如果前面有 pending process text，应按时间顺序把 text 固化为 process part，而不是等 done normalize。
4. UI 不再等 history reload 才根据完整 messages 重新切段；live 每个事件都应产出和 history 一致的 `TurnPart[]`。
5. stable cache 只能保护已显示 part 的 identity 和展开状态，不能阻止新 part 插入到正确时间位置。
6. `streamingText` 不能作为一个无限增长的大正文块直接渲染；必须先经过 text classifier，分成 `process_text` 或 `final_text candidate`。
7. 切换会话/reloadHistory 后只允许补 payload 和状态，不允许把 live 期间用户看到的结构改成另一套结构。

实现约束：

1. `ChatMessage` / `AssistantTurnMessage` 不允许直接把原始 `streamingText` 当正文气泡渲染；必须先经过 `TurnPartReducer`。
2. `parseThinkingTurnLayout` 如果继续作为 adapter，也只能消费 normalized parts，不能 live 一套逻辑、history 一套逻辑。
3. `history reload` 不能成为“修正布局”的主要机制；它只能补全缺失 payload、状态、工具结果。
4. stable cache 不能以“保留已见结构”为理由阻止实时插入新的 `process_text` group。
5. 当事件序列是 `text -> tool -> text -> tool -> text` 时，live 每一步都必须能产出和最终 history 一致的 group 边界。
6. Cursor 若暂时无法一次切到新 reducer，也必须先加 instrumentation 或测试断言，证明 live 和 history 的 group 边界差异在哪里；不能继续靠手测切换会话验证。

验收：

- 一直停留当前对话时，短 text 实时拆进多段 `思考 N 次，使用 M 个工具` 之间。
- 切换对话再回来，布局与切换前一致，不发生“重新拆分”。
- live 和 history 对同一 fixture 输出相同 part 顺序和 group 边界。
- 多段短 text 不堆成一个正文气泡。
- 正文只在确定是交付内容时出现。
- 不允许用“切换会话后会恢复正确”作为验收通过理由；正确效果必须在当前会话 live 阶段实时出现。

### 5.5 通用：loading 文案只有一种，且思考中会消失

现象：

- 底部 loading 经常只显示“正在理解你的问题…”，不能反映真实阶段。
- 如果当前正在思考，但不是调用工具中，loading 可能直接消失。
- 调用工具后只显示“正在整理工具结果”，但没有区分“正在准备工具参数 / 正在调用工具 / 正在等待工具返回 / 正在生成回复”。
- 这会让用户误以为流程停住或已经结束，尤其会和 5.1 的“复制 icon / 时间提前出现”互相放大。

根因方向：

1. 现有 `ThinkingTurnProcess` 主要通过 `isConnecting/isProcessing/isStillExecuting` 三个布尔值决定 loading。
2. `TimelineBody` 只在三种情况下渲染 `ChatProcessLoadingIndicator`：
   - `isConnecting`
   - `showOrganizingToolResults`
   - `isStillExecuting`
3. `showOrganizingToolResults` 又依赖 `!runningTool` 且最后一个 timeline item 是 tool，无法覆盖“正在思考但没有 running tool”的阶段。
4. `useChatDisplay` 中 `isConnecting = !pendingFinal && !hasAnyStreamContent && !isStillExecuting`，一旦有 thinking/phase text 内容，`isConnecting` 就会变 false。
5. `isProcessing = pendingFinal && sending && !hasLiveStreamContent`，只要 live 已经有内容，也可能变 false。
6. 因此 active thinking text 出现后，既不是 connecting，也不是 processing，也不是 stillExecuting，loading 就自然消失。
7. 当前 UI 缺少一个“当前活动 part 是什么”的状态，组件只能从零散布尔值里猜。

全局修法：

1. 新增或集中一个 `TurnProcessStatus`，与 `TurnLifecycle` 同源计算：

```ts
type TurnProcessStatus =
  | 'connecting'
  | 'thinking'
  | 'tool_input_streaming'
  | 'tool_running'
  | 'organizing_tool_results'
  | 'finalizing'
  | 'waiting_user'
  | 'queued'
  | 'still_executing'
  | 'interrupted'
  | 'failed'
  | 'completed';
```

2. loading 文案只允许从 `TurnProcessStatus` 映射：
   - `connecting`：`正在理解你的问题…` 或工作流场景 `正在连接模型…`
   - `thinking`：`正在思考…` 或 `正在深度思考…`
   - `tool_input_streaming`：`正在准备工具参数…`
   - `tool_running`：`正在调用工具…`
   - `organizing_tool_results`：`正在整理工具结果…`
   - `finalizing`：`正在生成回复…`
   - `waiting_user`：`等待你的回复…`
   - `queued`：`已加入队列…`
   - `still_executing`：`仍在执行中…`
   - `interrupted/failed/completed`：不显示普通 loading，改显示对应中断/失败/完成 UI。
3. `TurnProcessStatus` 由 normalized `TurnPart[]` 和 lifecycle 共同推导：
   - 没有任何 part 且 turn 未终止：`connecting`
   - 当前 active part 是 `reasoning/process_text`：`thinking`
   - 当前 tool 已有 tool_call 但 input 还在补：`tool_input_streaming`
   - 当前 tool status 为 running：`tool_running`
   - 收到 tool_result 后等待模型继续：`organizing_tool_results`
   - 当前 active part 是 `final_text` 且 turn 未终止：`finalizing`
   - 当前 part 是 `waiting`：`waiting_user`
   - 当前 part 是 `queued`：`queued`
4. `ThinkingTurnProcess` 不再直接消费 `isConnecting/isProcessing/isStillExecuting` 来决定 loading；这些旧字段最多作为 adapter 输入，最终必须先变成一个 `processStatus`。
5. `ChatProcessLoadingIndicator` 只负责展示，不参与状态判断。
6. “思考中但不是调用工具中”必须显示 `thinking` 文案，不能空白。
7. “调用工具中”与“整理工具结果”不能混用：工具还在 running 时显示调用工具；工具结束、等待模型消化结果时才显示整理工具结果。
8. 若 turn 未 terminal，但当前无法判断具体阶段，兜底显示 `仍在执行中…`，不能直接隐藏 loading。

验收：

- active thinking text 正在流式输出时，底部显示“正在思考…”或“正在深度思考…”，不消失。
- running tool 时显示“正在调用工具…”，不是“正在理解你的问题…”。
- tool result 返回后、模型继续前显示“正在整理工具结果…”。
- final reply 流式生成但 turn 未完成时显示“正在生成回复…”，且不显示复制 icon / 时间。
- waiting user 场景显示“等待你的回复…”。
- queued 场景显示排队样式和排队文案。
- terminal completed 后 loading 消失，复制 icon / 时间才出现。
- OpenClaw 和 Claude 都使用同一套状态映射，不允许引擎内各自写一套 loading 判断。

---

## 6. 推荐施工顺序

不要同时改所有地方。按下面顺序，每一步都必须有测试。

### Phase 0：冻结口径与测试

目标：先建立测试，不先修 UI。

要做：

1. 建 OpenSpec change：`stabilize-chat-turn-lifecycle-and-parts`。
2. 写 fixture：
   - OpenClaw 中间 text 后继续 tool。
   - OpenClaw 英文 planning narration。
   - Claude tool input placeholder。
   - live/history 顺序一致。
   - 当前会话保持不切换时，`text -> tool -> text -> tool -> text` 实时拆分。
   - Stop interrupted。
   - workflow 参数确认。
3. 为 lifecycle、part normalizer、tool merge 分别写单测。

禁止：

- 不要先改 `ChatMessage` 样式。
- 不要先改文案遮丑。

### Phase 1：统一运行生命周期

目标：先解决“还没结束却显示结束态”。

要做：

1. 新增或集中 `TurnLifecycle` 计算函数。
2. OpenClaw 终态只认 `agent.completed` 或明确 terminal。
3. Claude 终态只认 runtime result done / agent completed / 明确 terminal。
4. history poll 只负责补 history，不负责因为 assistant text 随意清 `sending`。
5. `showAssistantMessageMeta` 改为读 lifecycle 的 `canShowMeta`。
6. 从 lifecycle 和 active part 派生唯一的 `TurnProcessStatus`，替代 UI 层零散 loading 布尔值。

关键验收：

- 图一场景不会再出现复制 icon / 刚刚。
- 切换会话前后状态一致。
- 当前 turn 未 terminal 时，loading/等待/排队/中断/失败必须有且只有一个主状态。

### Phase 2：统一 TurnPart normalizer

目标：解决 text / thinking / tool / final reply 抢位置，以及 live/history 分段不一致。

要做：

1. 新增 `turn-parts.ts`、`turn-part-reducer.ts`、`turn-part-groups.ts`。
2. raw live event 和 history message 都转成 `TurnPart[]`。
3. 旧 `parseThinkingTurnLayout` 先作为 adapter，不要马上删除。
4. UI 继续用旧组件，但数据来源逐步切到 groups。
5. live 每个 delta/final/tool_result 都进入 reducer，实时产生和 history 相同的 group 边界。
6. 为 `text -> tool -> text -> tool -> text` 写 fixture，断言 live 与 history 的 `TurnGroup[]` 完全一致。
7. 将当前 UI 对 `streamingText` 的直接正文渲染改为消费 `TurnGroup[]`；无法一次完成时，用 adapter 生成旧 `ThinkingTurnSegment[]`，但 adapter 的输入仍必须是 normalized parts。
8. 增加 debug snapshot：同一 turn 同时输出 live groups 与 history groups，用于定位不一致来源。

关键验收：

- live 顺序和 history 顺序一致。
- 已展示内容不消失、不语义替换。
- 停留当前对话时就能实时拆分短 text，不需要切换会话触发重排。
- 若切换会话后布局发生变化，则 Phase 2 未通过。

### Phase 3：统一工具模型

目标：解决 Claude 无参数、重复工具、cache 污染。

要做：

1. 单一 tool identity 函数。
2. 单一 input quality merge 函数。
3. cache 写入/读取都走 merge。
4. UI 使用 `inputState`。

关键验收：

- 不再批量“无参数”。
- 同一工具不重复。

### Phase 4：文本语言和正文归类

目标：解决英文旁白进正文、旁白和正文重复。

要做：

1. 扩展 planning narration 分类。
2. 添加中文输出 prompt 约束。
3. `process_text` 一旦展示，不再进入 `final_text`。
4. final reply 只收真正交付内容。

关键验收：

- OpenClaw 英文 planning narration 不进正文。
- 中文问题优先中文回答。

### Phase 5：UI 展开折叠和状态

目标：UI 只按 group state 渲染。

要做：

1. active process group 展开。
2. completed process group 折叠。
3. 等待用户回复显示 `等待你的回复…`。
4. interrupted 显示已中断。
5. queued 显示排队样式。
6. loading 文案从 `TurnProcessStatus` 映射，不再在组件内用 `isConnecting/isProcessing/isStillExecuting` 自行拼判断。
7. active thinking、tool running、tool result 整理、finalizing 都必须有对应 loading 文案。

关键验收：

- 手动展开不影响后续 active 自动展开。
- completed 展开不重播 typewriter。
- 思考中但没有调用工具时，loading 不消失。
- 工具调用中、整理工具结果、生成回复三个阶段文案不同。

### Phase 6：删除旧兜底和重复判断

目标：减少未来互相打架。

要做：

1. 清理 parser 中重复的补工具逻辑。
2. 清理 UI 层自行 merge timeline 的业务判断。
3. 清理 history poll 里的终态猜测。
4. 保留必要 adapter，逐步迁移。

---

## 7. Cursor 具体改造边界

### 7.1 可以改

- 新增 normalized part / lifecycle 文件。
- 为旧 parser 增加 adapter。
- 改终态判断。
- 改工具 identity / input merge。
- 改 planning narration 分类。
- 改 meta 展示条件。
- 增加测试 fixture。

### 7.2 暂时不要改

- 不要重写整个 Chat 页面。
- 不要重写输入框。
- 不要重写 WorkflowCard。
- 不要改包依赖。
- 不要改构建配置。
- 不要删除旧 parser，先 adapter 迁移。

### 7.3 必须拆提交

建议拆为：

1. tests + fixtures
2. lifecycle
3. TurnPart normalizer
4. tool model
5. text classification + language prompt
6. UI group rendering
7. cleanup

每个提交都要能独立解释，不要混一个大 diff。

---

## 8. 测试矩阵

### 8.1 OpenClaw

- [ ] 用户中文提问，模型中间输出英文 planning text，再继续 tool。
- [ ] 中间 assistant text 出现后，复制 icon 和时间不显示。
- [ ] 未收到 `agent.completed` 前，turn 不进入 completed。
- [ ] 收到 `agent.completed` 后，显示复制 icon 和时间。
- [ ] tool_result 后显示“正在整理工具结果”。
- [ ] active thinking 期间显示“正在思考…”或“正在深度思考…”，不空白。
- [ ] running tool 期间显示“正在调用工具…”，不误显示“正在理解你的问题…”。
- [ ] final reply 流式生成但未 terminal 时显示“正在生成回复…”，且不显示复制 icon / 时间。
- [ ] history reload 后顺序不变。
- [ ] 停留当前对话时，多段短 text 实时拆进思考统计之间，不堆积成一大段。
- [ ] 切换会话再回来，布局不发生二次重排。
- [ ] 禁止以“切换回来后正确”为通过标准；必须 live 过程中就正确。

### 8.2 Claude

- [ ] 中间 assistant text 出现后，复制 icon 和时间不显示。
- [ ] runtime result done / agent completed 前，turn 不进入 completed。
- [ ] terminal signal 到达后，才显示复制 icon 和时间。
- [ ] tool status 先到、input 后到，最终一个工具且有参数。
- [ ] cache 无 input、message 有 input，最终取 message input。
- [ ] completed 真无参数工具，只显示一次“无参数”。
- [ ] Claude 先正文后 thinking/tool，按时间顺序展示。
- [ ] done history 不重排 live。
- [ ] active thinking / running tool / organizing tool results / finalizing 都走同一套 `TurnProcessStatus` 文案映射。

### 8.3 通用

- [ ] 用户 echo 隐藏。
- [ ] phase text 打断时，前组收起。
- [ ] live 与 history 对同一 turn 输出相同 group 边界。
- [ ] active 二级 thinking/tool 展开。
- [ ] completed 展开直接显示完整内容。
- [ ] Stop 后保留内容并标记已中断。
- [ ] 发送中再次发送显示排队。
- [ ] 排队状态显示排队文案和样式。
- [ ] 等待用户回复显示 `等待你的回复…`。
- [ ] 工作流参数确认正常。
- [ ] artifact 正文优先、预览其次。

---

## 9. 验收原则

一个改动只有同时满足下面条件才算完成：

1. OpenClaw 和 Claude 都过测试。
2. live 和 history 过测试。
3. streaming 和 completed 都过测试。
4. 有工具和无工具都过测试。
5. 中文旁白和英文工具参数都过测试。
6. 复制 icon / 时间只在真正完成后出现。

---

## 10. 最重要的一句话

不要再让各个组件自己判断“是不是结束、是不是正文、是不是无参数”。

统一改成：

```text
Runtime lifecycle 决定是否结束
TurnPart 决定内容类型
ToolInputState 决定参数展示
TurnGroup 决定 UI 展开折叠
```

这样后续修某个 bug 时，只改对应层，不会把其它层带坏。
