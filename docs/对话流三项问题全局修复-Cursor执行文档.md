# 对话流三项问题全局修复 · Cursor 执行文档

> 本文档给 Cursor 使用，只处理三个问题：
>
> 1. 短 text 和正文大量重复。
> 2. 思考过程里的竖线没有和 icon 居中对齐。
> 3. loading 文案没有根据实时状态变化，且思考中可能消失。
>
> 不要把范围扩展成整个对话流重写。不要改输入框、工作流卡、artifact、包依赖、lockfile、构建配置、CI、脚本。
>
> 目标不是打补丁，而是给这三个问题建立各自的唯一来源：
>
> - 文本展示由“文本归属权”决定。
> - 竖线位置由“标题行几何结构”决定。
> - loading 文案由“当前过程状态”决定。

---

## 0. 总原则

这三个问题不能用局部 if 修：

- 不能只在某个组件里 `replace` 或 `includes` 删除重复文本。
- 不能只给竖线加一个临时 `margin-left`。
- 不能只把“正在理解你的问题…”换成另一句固定文案。

必须分别建立三个全局小模型：

```text
TextOwnership      -> 决定同一段文本只能出现在哪里
ProcessRailLayout  -> 决定竖线永远对齐哪个 icon
TurnProcessStatus  -> 决定当前 loading 应显示什么
```

这三个模型可以先作为 adapter 接在现有代码上，不要求一次重写整个消息系统。但 UI 组件最终必须消费这三个模型的结果，不再自己猜。

---

## 1. 修改范围

### 1.1 重点阅读文件

修改前先读这些文件，确认当前工作区已有改动，不要覆盖用户或其他 AI 的改动：

- `src/pages/Chat/AssistantTurnMessage.tsx`
- `src/pages/Chat/thinking/classify-text.ts`
- `src/pages/Chat/thinking/thinking-turn-process.tsx`
- `src/pages/Chat/thinking/turn-part-reducer.ts`
- `src/pages/Chat/thinking/turn-part-adapter.ts`
- `src/components/chat/chat-process-block.tsx`
- `src/components/chat/chat-tool-call-card.tsx`
- `src/components/chat/chat-process-loading-indicator.tsx`
- `src/lib/surfaces.ts`
- `src/pages/Chat/use-chat-display.ts`
- `src/i18n/locales/zh-CN/chat.json`

### 1.2 不要改的范围

- 不要修改依赖、lockfile、构建配置。
- 不要重写整个 `Chat` 页面。
- 不要改输入框能力。
- 不要改 workflow 参数确认逻辑。
- 不要把工具参数、命令、路径强行翻译成中文。
- 不要靠切换会话后 history reload 修正 live UI。

---

## 2. 问题一：短 text 和正文大量重复

### 2.1 现象

同一段助手内容同时出现在：

- 思考区短 text / phase text。
- 正文白色气泡。

截图里的典型表现是上面一段短 text 已经完整展示，下面正文气泡又展示几乎同一段内容。

用户确认过：短 text 也算正文的一种用户可见文本。只要同一段内容已经展示过，就不能再在另一个区域重复展示。

新增复现场景：

- 思考区已经展示了一整段长文本，例如“我来帮你实现客户异常监控功能。为了更好地满足你的需求，我需要了解几个关键信息：……”
- 正文气泡又从同一句开头开始流式展示前几行，例如“我来帮你实现客户异常监控功能。为了更好地满足你的需求，我需要了解几个关键信息：数据源：……”
- 这不是完全相等重复，而是 `final_text` 是 `process_text` 的前缀 / 子集。仍然必须判定为同一文本归属，不能同时展示。

### 2.2 当前风险点

当前代码里至少有这些重复来源：

1. `AssistantTurnMessage.tsx` 会先渲染 `thinkingPanelEl`，再渲染 `replyDisplayMessage`。
2. `thinkingLayout.finalReplyText` 存在时，会构造一个新的 assistant `replyMessage`。
3. `dedupePhaseTextsAgainstFinalReply` 主要只处理 `phase-text`，而且跳过 `phase-text-after-*`。
4. tool-group timeline 里的 thinking/narration 与 final reply 之间没有统一的去重所有权。
5. `TurnPart` 当前还没有完全接管 final text 归属，旧 parser 仍可能把同一段文本同时放进 thinking segments 和 `finalReplyText`。
6. 仅用“完全相等”或“长度比例接近”判断重复会漏掉流式前缀重复：final 气泡可能只是 process 长文本的前 10%-40%。
7. 如果先 strip 掉重复 phase text，再判断 final 是否已由 process 完整展示，可能永远得不到“final 应隐藏”的结论。

参考位置：

- `src/pages/Chat/AssistantTurnMessage.tsx`：`replyMessage`、`thinkingPanelEl`、`replyDisplayMessage` 相关逻辑。
- `src/pages/Chat/thinking/classify-text.ts`：`dedupePhaseTextsAgainstFinalReply`、`finalizeReplyText`。
- `src/pages/Chat/thinking/turn-part-reducer.ts`、`turn-part-adapter.ts`：确认 live/history 是否都走同一文本归属模型。
- `src/pages/Chat/thinking/text-ownership.ts`：如果已有该文件，重点检查它是否只处理 `phase-text`，是否漏掉 tool-group timeline thinking 文本，是否把低比例前缀重复误判为非重复。

### 2.3 全局修法：TextOwnership

新增或集中一个文本归属判断，不要让不同组件分别去重。

建议模型：

```ts
type TextSurface = 'hidden' | 'process' | 'final' | 'preamble';

type TextOwnership = {
  textKey: string;
  normalizedText: string;
  surface: TextSurface;
  firstSeenOrder: number;
  source: 'live' | 'history' | 'parser' | 'tool' | 'cache';
  reason:
    | 'user_echo'
    | 'planning_narration'
    | 'process_update'
    | 'deliverable_reply'
    | 'workflow_preamble'
    | 'duplicate_of_existing_text';
};
```

核心规则：

1. 同一段文本只能拥有一个 `surface`。
2. `surface='process'` 的文本不能再进入 `final`。
3. `surface='final'` 的文本不能再保留在 `process` 中。
4. 用户原问 echo 进入 `hidden`。
5. planning narration 进入 `process`。
6. 真正交付内容进入 `final`。
7. 如果无法判断 text 是过程还是最终正文，live 阶段先作为候选，但只能在一个区域展示，不能两边都展示。
8. live 和 history 必须使用同一套 `TextOwnership` 结果。
9. 如果 `final` 是已展示 `process` 文本的前缀 / 子集，且两者从同一句开头开始，则优先隐藏当前 `final` 气泡，直到 final 与 process 明确分叉，或通过 terminal 重算后只保留一个 surface。
10. 如果 `process` 是 `final` 的前缀，且 final 已完整输出，则移除 process 中对应文本，只保留 final。
11. 不允许使用固定比例阈值作为唯一判断。低比例前缀也可能是重复，因为正文气泡处于流式早期。

### 2.4 文本归一化

去重不能只做原字符串完全相等，需要轻量归一化：

```ts
function normalizeDisplayTextForOwnership(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}
```

可以再做安全的标点归一化：

- 中文冒号和英文冒号可以视为近似。
- 多个空行与单空格视为近似。
- Markdown code fence、路径、命令内容不能被破坏。

禁止：

- 禁止为了去重删除工具命令、JSON 字段、文件路径。
- 禁止大范围模糊匹配导致误删不同段落。
- 禁止把不同批次的短 text 因部分重叠而删掉。

需要新增一个方向性判断，而不是只用对称 duplicate：

```ts
type TextOverlapKind =
  | 'same'
  | 'final_prefix_of_process'
  | 'process_prefix_of_final'
  | 'contains_full_block'
  | 'different';
```

建议规则：

```ts
function classifyTextOverlap(processText: string, finalText: string): TextOverlapKind {
  const process = normalizeDisplayTextForOwnership(processText);
  const final = normalizeDisplayTextForOwnership(finalText);
  if (!process || !final) return 'different';
  if (process === final) return 'same';
  if (process.startsWith(final) && final.length >= 24) return 'final_prefix_of_process';
  if (final.startsWith(process) && process.length >= 24) return 'process_prefix_of_final';
  if (process.includes(final) && final.length >= 40) return 'final_prefix_of_process';
  if (final.includes(process) && process.length >= 40) return 'process_prefix_of_final';
  return 'different';
}
```

注意：这是“同一句开头 / 完整块包含”判断，不是任意小片段 fuzzy match。阈值只防止几个字误删，不能要求 85% 这种高比例。

### 2.5 具体实现建议

优先做成 parser/adapter 层能力，而不是 UI 层补丁：

1. 在 thinking parser 输出 `segments/finalReplyText` 前，统一执行 `assignTextOwnership`。
2. `assignTextOwnership` 输入所有候选文本：
   - phase text
   - tool-group timeline thinking text
   - final reply candidate
   - preamble message text
3. 输出：
   - 应保留在思考区的 segments。
   - 应作为正文显示的 final text。
   - 应隐藏的重复 text。
4. `AssistantTurnMessage` 只消费结果，不再自己判断一段文本是不是要同时在 thinking 和 reply 出现。
5. 如果短 text 已经作为 process 展示，`replyDisplayMessage` 要么不创建，要么剔除这段文本后再展示。
6. 如果 final reply 已经确定，thinking segments 中对应的完整重复文本必须被移除。
7. 对 `phase-text-after-*` 不再一刀切跳过去重。它可以保留“不同批次短旁白”，但不能与正文完整重复。
8. 不只检查 `segment.kind === 'phase-text'`。tool-group timeline 中的 `thinking` content 也可能承载短 text / 过程旁白，也必须参与 ownership。
9. 在 live 阶段，如果 final 气泡只是 process 长文本的前缀，隐藏 final 气泡；不要等它达到 85% 长度才去重。
10. 在 completed 阶段，重新计算 ownership，最终只保留一个 surface。不能出现“live 隐藏，history 又重复”或反过来。
11. 不要先删除 process duplicate 再判断 final 是否已被 process 覆盖。应先收集所有 process texts，计算 final 与 process 的 overlap，决定保留哪一侧，再执行删除/隐藏。

推荐处理顺序：

```text
collect process candidates from segments and timeline
collect final candidate
classify overlap
decide ownership
apply removal/hide once
return { segments, finalReplyText }
```

当前已有 `text-ownership.ts` 时，请重点修正：

- `stripDuplicatePhaseTexts` 不能只处理 phase-text。
- `finalReplyFullyShownInProcess` 不能在 strip 之后才判断。
- `textsAreOwnershipDuplicates` 不能要求前缀比例接近；流式 early final prefix 也要判定为同一归属。
- `applyTextOwnershipToParsedTurn` 需要能返回 `finalReplyText: null` 来隐藏当前重复正文气泡。

### 2.6 验收

- 同一段完整内容不能同时出现在思考区和正文气泡。
- 短 text 如果就是最终答复内容，只展示一次。
- final 气泡只是 process 长文本前缀时，也只展示一次。
- process 文本是 final 长文本前缀时，最终只保留 final。
- 多段不同短 text 仍按时间顺序保留，不因为局部包含被误删。
- 用户 echo 不显示。
- 中文正文不因为去重被截断。
- Markdown、代码、路径、命令、JSON 字段不被破坏。
- live 阶段和刷新 history 后展示一致。

---

## 3. 问题二：竖线应和 icon 居中对齐

### 3.1 现象

思考过程中的竖线在某些工具块里偏右，没有和标题行左侧 icon 的中心线对齐。

这通常出现在 thinking process 里的 readonly 工具调用块。

### 3.2 当前风险点

当前竖线由 `ChatProcessContentRail` 渲染：

- `chatProcessIconRailClass = 'flex w-4 shrink-0 justify-center self-stretch'`
- `chatProcessIconRailLineClass = 'w-px bg-border'`
- `chatProcessContentLeadOffsetClass = 'w-5 shrink-0'`

`hasLeadingOffset` 的设计本来是：如果标题行 icon 前面还有 chevron 或 spinner，则内容区竖线也要补一个同等占位，才能对齐真正的语义 icon。

风险点在于 `ChatToolCallCard` 当前可能用 `isRunning` 推导 `hasLeadingOffset`。但 thinking process readonly 工具标题行并没有在 icon 前展示 spinner，只有 tool icon。所以给内容区补 offset 会把竖线推到右边。

参考位置：

- `src/components/chat/chat-process-block.tsx`
- `src/components/chat/chat-tool-call-card.tsx`
- `src/lib/surfaces.ts`

### 3.3 全局修法：ProcessRailLayout

不要用 `isRunning` 直接决定竖线 offset。应该由“标题行 icon 前实际有没有前置控件”决定。

建议模型：

```ts
type ProcessHeaderLayout = {
  hasLeadingControlBeforeSemanticIcon: boolean;
  semanticIconSizePx: 16;
  leadingControlWidthPx: 20;
};
```

核心规则：

1. 竖线永远对齐标题行的语义 icon 中心。
2. 如果标题行结构是 `Icon + Text`，内容区不加 leading offset。
3. 如果标题行结构是 `Chevron + Icon + Text`，内容区加 leading offset。
4. 如果标题行结构是 `Spinner + Icon + Text`，内容区加 leading offset。
5. 是否 running 不能直接决定 offset；running 只有在标题行真的渲染了 spinner 时才影响 offset。
6. thinking process readonly 工具如果标题行只有 `ToolIcon + Label`，竖线必须不加 offset。

### 3.4 具体实现建议

在 `ChatToolCallCard` 中不要再写：

```ts
hasLeadingOffset={!isThinkingProcessCollapsible && isRunning}
```

改成显式根据标题行结构推导，例如：

```ts
const headerHasLeadingControl =
  variant === 'collapsible'
  || (!isThinkingProcess && !isReadonly && isRunning);
```

上面只是表达方向，实际以当前组件结构为准。

更稳的写法是封装：

```ts
function resolveProcessHeaderLayout(props): ProcessHeaderLayout {
  return {
    hasLeadingControlBeforeSemanticIcon: Boolean(/* header really renders chevron/spinner before icon */),
    semanticIconSizePx: 16,
    leadingControlWidthPx: 20,
  };
}
```

然后：

```tsx
<ToolCallContent
  hasLeadingOffset={layout.hasLeadingControlBeforeSemanticIcon}
/>
```

### 3.5 不要做的事

- 不要给某个截图场景加 `ml-*`。
- 不要只调竖线颜色或宽度。
- 不要把所有工具块统一去掉 offset；默认可折叠工具块有 chevron 时仍需要 offset。
- 不要破坏 `ChatProcessBlock` 中 spinner + icon 的对齐逻辑。

### 3.6 验收

- thinking process readonly 工具：竖线与 tool icon 中心对齐。
- thinking process collapsible 工具：展开内容竖线仍与 tool icon 中心对齐。
- 普通可折叠工具卡：有 chevron 时竖线仍与 tool icon 中心对齐。
- 有 spinner 且 spinner 在 icon 前时，竖线仍与 icon 中心对齐。
- 深度思考块和调用工具块的竖线横向位置一致。
- 不同缩放、不同窗口宽度下不偏移。

---

## 4. 问题三：loading 文案要根据实时状态显示

### 4.1 现象

现在 loading 经常只有一种状态，例如：

- `正在理解你的问题…`
- `正在整理工具结果`

但真实流程可能是：

- 正在连接模型。
- 正在思考。
- 正在准备工具参数。
- 正在调用工具。
- 正在整理工具结果。
- 正在生成回复。
- 等待用户回复。
- 排队中。

另一个问题是：如果正在思考但不是调用工具，loading 可能消失。

新增复现场景：

- Claude 引擎下，同一个思考区同时出现两条 loading：
  - `正在整理工具结果`
  - `正在调用工具...`
- 这不是 Claude 真的有两个并行主状态，而是 UI 内外两层组件都在渲染 loading。
- 典型代码形态是：外层 `ThinkingTurnProcess` 根据 `TurnProcessStatus` 渲染一条全局 loading；内层 `PhaseTextBlock` 在 `isStreaming=true` 时又硬编码渲染 `streaming.processingTitle`。

### 4.2 当前风险点

当前 `ThinkingTurnProcess` 主要靠这些布尔值：

- `isConnecting`
- `isProcessing`
- `isStillExecuting`
- `runningTool`
- `showOrganizingToolResults`

在 `TimelineBody` 中，只在下面几种情况下显示 loading：

- `isConnecting`
- `showOrganizingToolResults`
- `isStillExecuting && !runningTool`

这导致一个空洞：

```text
active thinking text 正在流式输出
但不是 connecting
也不是 processing
也不是 stillExecuting
也没有 runningTool
=> loading 消失
```

另一个相反问题是“双 loading”：

```text
PhaseTextBlock 认为自己正在 streaming
=> 内部硬编码显示“正在整理工具结果”

ThinkingTurnProcess 也认为 turn 正在 live
=> 外部根据 TurnProcessStatus 显示“正在调用工具...”

=> 同屏两条 loading
```

根因仍然是一样的：loading 展示权没有唯一归属。

参考位置：

- `src/pages/Chat/use-chat-display.ts`
- `src/pages/Chat/AssistantTurnMessage.tsx`
- `src/pages/Chat/thinking/thinking-turn-process.tsx`
- `src/pages/Chat/thinking/phase-text-block.tsx`
- `src/components/chat/chat-process-loading-indicator.tsx`
- `src/i18n/locales/zh-CN/chat.json`

### 4.3 全局修法：TurnProcessStatus

新增或集中一个 `TurnProcessStatus`。UI 不再用多个布尔值拼 loading 文案。

建议类型：

```ts
type TurnProcessStatus =
  | 'idle'
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

文案映射：

```ts
const processStatusLabelKey: Record<TurnProcessStatus, string | null> = {
  idle: null,
  connecting: 'streaming.understandingQuestion',
  thinking: 'streaming.thinkingNow',
  tool_input_streaming: 'streaming.preparingToolInput',
  tool_running: 'streaming.runningTool',
  organizing_tool_results: 'streaming.processingTitle',
  finalizing: 'streaming.finalizingReply',
  waiting_user: 'streaming.awaitingReply',
  queued: 'streaming.queued',
  still_executing: 'streaming.stillExecuting',
  interrupted: null,
  failed: null,
  completed: null,
};
```

如果工作流场景需要 `connectingModel`，可以在 `connecting` 状态下由 context 决定使用 `connectingModel` 还是 `understandingQuestion`，但不要让 context 重新发明一套状态机。

### 4.4 状态推导规则

`TurnProcessStatus` 应从统一的 active turn 数据推导，优先级建议：

1. terminal failed：`failed`
2. terminal interrupted：`interrupted`
3. terminal completed：`completed`
4. waiting user：`waiting_user`
5. queued：`queued`
6. running tool：`tool_running`
7. tool input 正在补齐：`tool_input_streaming`
8. 刚收到 tool result，等待模型继续：`organizing_tool_results`
9. final reply 正在流式生成但 turn 未完成：`finalizing`
10. active thinking / process text 正在流式输出：`thinking`
11. 没有任何可见内容但 turn 未完成：`connecting`
12. 超时仍未 terminal：`still_executing`

注意：

- `thinking` 不要求有 running tool。
- `finalizing` 不等于 completed。final text 正在流式输出时仍不能显示复制 icon / 时间。
- `organizing_tool_results` 只用于工具返回后、模型消化结果时，不要覆盖 running tool。
- 如果无法判断但 turn 未结束，兜底 `still_executing`，不要隐藏 loading。

### 4.5 具体实现建议

1. 在 active turn adapter 中新增 `processStatus`。
2. `AssistantTurnMessage` 把 `processStatus` 传给 `ThinkingTurnProcess`。
3. `ThinkingTurnProcess` / `TimelineBody` 只根据 `processStatus` 渲染一个 `ChatProcessLoadingIndicator`。
4. 保留旧字段 `isConnecting/isProcessing/isStillExecuting` 作为过渡输入可以，但不能再由 UI 直接用它们决定文案。
5. i18n 增加缺失文案：
   - `thinkingNow`: `正在思考…`
   - `preparingToolInput`: `正在准备工具参数…`
   - `runningTool`: `正在调用工具…`
   - `finalizingReply`: `正在生成回复…`
   - `queued`: `已加入队列…`
   - `awaitingReply`: `等待你的回复…`
6. `ChatProcessLoadingIndicator` 保持纯展示组件，不做状态判断。
7. `PhaseTextBlock` 不允许自己渲染过程 loading 文案。它最多只负责展示 phase text 内容和文本流式效果。
8. 如果确实需要在 phase text 后显示 loading，也必须由父级传入同一个 `processStatus`，且整棵思考面板同一时刻只能有一个主 loading。
9. 不允许同时出现 inline loading 和 panel-level loading。选择一个统一位置，推荐由 `ThinkingTurnProcess` 在 segments 之后渲染。

### 4.6 验收

- 刚发送、没有任何内容时：显示 `正在理解你的问题…` 或工作流场景 `正在连接模型…`。
- 思考 text 正在输出、没有工具 running：显示 `正在思考…`，不消失。
- 工具参数正在补齐：显示 `正在准备工具参数…`。
- 工具执行中：显示 `正在调用工具…`。
- 工具结果返回后、模型继续前：显示 `正在整理工具结果…`。
- 正文流式生成但 turn 未完成：显示 `正在生成回复…`。
- 等待用户：显示 `等待你的回复…`。
- 排队中：显示排队文案和排队样式。
- completed/interrupted/failed 不显示普通 loading，而显示对应完成/中断/失败 UI。
- 同一个 assistant turn 同一时刻最多显示一条主 loading。
- Claude phase text streaming + tool running 时，只显示 `正在调用工具…` 或更高优先级状态，不再额外显示 `正在整理工具结果`。

---

## 5. 三个问题之间的关系

这三个问题要一起考虑，但不要互相污染：

### 5.1 文本重复与 loading 的关系

不能为了避免重复，把 active thinking text 隐藏后导致 loading 也消失。

正确关系：

```text
TextOwnership 决定文本展示在哪
TurnProcessStatus 决定 loading 显示什么
```

文本被归到 `process` 后，loading 仍然应根据 active 状态显示 `thinking`。

### 5.2 文本重复与正文完成态的关系

不能因为 final text 出现，就认为 turn completed。

正确关系：

```text
finalizing 是未完成状态
completed 才能显示复制 icon / 时间
```

因此去重时要避免把 final text 的存在当作完成信号。

### 5.3 竖线对齐与 loading 的关系

竖线 offset 只由标题行前置控件决定，不由 running/loading 状态直接决定。

如果 running 状态没有在标题行 icon 前实际渲染 spinner，就不能因为 running 给内容区加 offset。

---

## 6. 推荐施工顺序

### Step 1：加测试和 fixture

先加失败用例，不先改 UI：

1. 短 text 与 final reply 完全重复。
2. 短 text 与 final reply 只有空白/换行差异。
3. 多段不同短 text 按时间顺序出现，不能误删。
4. thinking process readonly tool 竖线对齐。
5. running tool / thinking / finalizing 三种 loading 文案切换。
6. thinking 中没有 running tool 时 loading 不消失。

### Step 2：实现 TextOwnership

先解决重复文本所有权：

- parser/adapter 统一归属。
- UI 只消费结果。
- live/history 使用同一结果。

### Step 3：实现 TurnProcessStatus

再解决 loading：

- active turn 推导 `processStatus`。
- UI 根据状态显示唯一 loading。
- 补 i18n 文案。

### Step 4：实现 ProcessRailLayout

最后修竖线：

- 用标题行实际结构推导 offset。
- 不用 `isRunning` 直接控制 offset。

### Step 5：回归验证

三个问题一起回归：

- 不重复。
- 不偏线。
- loading 不空白且文案正确。
- live/history 一致。
- OpenClaw / Claude 都过。

---

## 7. 禁止方案

这些方案不要做：

1. 只在 `AssistantTurnMessage` 里用字符串 `includes` 删除正文。
2. 只删除 `phase-text-after-*`。
3. 只在某个卡片上写死 `ml-5` 或 `-ml-5`。
4. 只把“正在理解你的问题…”改成“正在思考…”。
5. 只针对 OpenClaw 或 Claude 单独写分支。
6. 靠切换会话后 history reload 修复展示。
7. 让 `ChatProcessLoadingIndicator` 自己判断状态。
8. 让组件各自判断“这段文本是不是正文”。
9. 让 `PhaseTextBlock` 硬编码显示 `正在整理工具结果`。
10. 同屏保留两条 loading，然后试图通过文案区分它们。

---

## 8. 最终验收清单

### 8.1 短 text / 正文重复

- [ ] 同一段完整文本只展示一次。
- [ ] phase text 与 final reply 完全重复时只保留一个 surface。
- [ ] 空白/换行/中英文冒号差异不会造成重复。
- [ ] 不同批次短 text 不被误删。
- [ ] 用户 echo 隐藏。
- [ ] live 与 history 展示一致。

### 8.2 竖线对齐

- [ ] 深度思考块竖线与 icon 中心对齐。
- [ ] 调用工具块竖线与 icon 中心对齐。
- [ ] thinking process readonly 工具不因 running 被错误加 offset。
- [ ] 可折叠工具块有 chevron 时仍正确 offset。
- [ ] 有 spinner 且 spinner 在 icon 前时仍正确 offset。

### 8.3 loading 实时状态

- [ ] connecting：显示连接/理解问题文案。
- [ ] thinking：显示思考文案，不消失。
- [ ] tool input streaming：显示准备工具参数。
- [ ] tool running：显示调用工具。
- [ ] organizing tool results：显示整理工具结果。
- [ ] finalizing：显示生成回复。
- [ ] waiting user：显示 `等待你的回复…`。
- [ ] queued：显示排队文案和样式。
- [ ] completed/interrupted/failed 不显示普通 loading。
- [ ] 同一 turn 同一时刻最多一条主 loading。
- [ ] Claude phase text streaming 时不会额外硬编码显示 `正在整理工具结果`。

---

## 9. 交付要求

Cursor 完成后需要说明：

1. `TextOwnership` 在哪里实现，哪些 UI 已经改为消费它。
2. `TurnProcessStatus` 在哪里推导，loading 文案映射在哪里。
3. `ProcessRailLayout` 或等价逻辑在哪里实现，为什么不会再受 running 状态误导。
4. 跑了哪些测试。
5. 还有哪些旧 adapter 暂时保留，后续是否可清理。

一句话目标：

```text
同一段文本只有一个归属，竖线只对齐真实标题 icon，loading 只由当前过程状态决定。
```
