# 对话流思考过程稳定化 · Cursor 开发文档

> 给 Cursor 的施工依据。目标是稳定 OpenClaw / Claude 双引擎下的对话流，重点解决 Claude 思考过程乱跳、内容消失/替换、正文与思考冲突、工具卡大量“无参数”等问题。
>
> 本文档只描述开发方案。动代码前仍需遵守项目 `AGENTS.md`、OpenSpec 工作流、`docs/sto-design.md`、renderer/main API 边界等项目规则。

---

## 0. 总结

当前问题的本质不是单个 UI 卡片，而是前端在多个来源之间重建同一个 assistant turn：

- assistant message
- streaming message
- tool_result
- streamingTools cache
- done fallback
- chronological entries
- parser 内部 `phase-text / tool-group / finalReplyText` 推断
- UI 层 stable timeline cache / monotonic merge

这些来源都可能补工具、补文本、改顺序。Claude 流式事件时序一变化，就容易出现：

- 已展示的思考被替换或消失
- 思考内容和正文互相抢
- live 顺序和 history 顺序不一致
- 工具先出现无 input 占位，后续真实 input 没合并，最终出现大量“无参数”
- 完成态和流式态走不同路径，刷新后布局变化

推荐方向：**不要重写整个 Chat，也不要继续在旧 parser 上无限打补丁。保留现有 UI 和业务能力，重做思考/工具 timeline 内核：先统一成稳定的 `TurnPart[]`，再由 UI 分组渲染。**

参考 `sai-desktop`：它使用结构化 `message.parts`，按原顺序解析，只合并相邻 reasoning/tool，流式展开、完成折叠，不做过度猜测和重排。StoClaw 不需要照搬组件，但应该借这个数据流思想。

---

## 1. 用户已确认的交互规则

### 1.1 顺序

1. 对话流按事件首次出现的时间顺序展示。
2. 不强制 `phase text -> tool group -> final reply`。
3. Claude 如果先吐正文，再吐思考/工具，也按真实出现顺序展示。
4. live 流式看到 A/B/C，刷新 history 后仍应是 A/B/C。

### 1.2 文本补全

1. 已展示内容只允许同句补全。
2. 不允许语义替换。
3. 已出现 part 不允许因为后续 parser 重新判断而消失。
4. 如果 `nextText.startsWith(currentText)`，可视为补全。
5. 如果不是同句补全，追加为新的 part。

### 1.3 用户原问 echo

有些引擎会把用户刚问的问题作为 assistant text 又吐回来。例如用户问 “A”，助手流第一段也出现 “A”。

规则：

1. 这不是思考，也不是正文。
2. 若 assistant text 与 preceding user text 规范化后一致，应隐藏。
3. 只隐藏完全 echo，不隐藏真实回答中引用用户问题的正常句子。

现有相关代码：

- `src/pages/Chat/thinking/classify-text.ts`
- `isEchoOfUserQuery`
- `dedupePhaseTextsEchoingUserQuery`

### 1.4 思考展开/折叠

1. 思考过程正常向下展开。
2. 如果靠近底部时展开内容看起来弹到上面，优先修滚动容器、输入框间距、scroll anchoring，不要改成“向上展开”。
3. 思考中二级“深度思考”和“调用工具”展开。
4. 二级块结束后收起。
5. 一级思考总结在思考结束或被 phase text 打断时统计并收起。
6. 后续新的思考仍自动展开。
7. 手动展开/收起只影响当前已完成组，不影响后续新流式组。
8. 已完成思考展开时直接展示完整内容，不重放 typewriter。

### 1.5 Phase text / 思考旁白

以下内容优先进入思考过程：

- “我来……”
- “让我……”
- “现在我会……”
- 工具/技能调用前的短说明
- “你还需要我继续吗？”
- 等待用户选择或继续时的过程性旁白

规则：

1. 短 text、思考次数统计、工具调用按时间顺序排。
2. process narration 属于思考旁白。
3. 正文只展示真正交付给用户的回答。
4. 如果思考和正文重复，过程性内容优先留在思考区。

### 1.6 工具调用

1. 工具调用按时间顺序出现。
2. 工具卡不应因为缺 input 占位就显示大量“无参数”。
3. “无参数”只在确认真实工具确实没有参数时显示。
4. streaming 占位、cache fallback、缺失 input 的 tool skeleton 不应渲染成“无参数”。
5. 工具 identity 不应包含 input。
6. 工具 input 是 payload，可被高质量来源补全，但空 input 不能覆盖已有 input。

### 1.7 工作流与输入

1. 工作流中继续显示 thinking。
2. “参数已确认”折叠摘要保留。
3. “参数已确认”展开后显示完整表单/填写详情。
4. 工作流卡和“参数已确认”之间允许插入说明。
5. 失败可以显示失败原因。
6. artifact 正文优先，预览其次。
7. 等待态文案使用：`等待你的回复…`
8. 发送中再次发送需要排队 UX。
9. Stop 后保留已输出内容，并标记已中断。
10. 用户滚动历史时，不要强制拉到底部。

---

## 2. `sai-desktop` 参考结论

参考项目路径：

`/Users/tiancanyang/Documents/sai-desktop`

相关文件：

- `src/renderer/src/pages/salesAssistant/components/ChatArea.jsx`
- `src/renderer/src/pages/salesAssistant/components/ChatMessageList.jsx`
- `src/renderer/src/pages/salesAssistant/scripts/segmentUtils.js`
- `src/renderer/src/pages/salesAssistant/components/ChartMessageThinking.jsx`
- `src/renderer/src/pages/salesAssistant/components/ThinkingToolsSummary.jsx`
- `src/renderer/src/pages/salesAssistant/components/ChartMessageToolCollapsible.jsx`
- `docs/chat-interaction-style-spec.md`

它稳定的原因：

1. 上游已经给结构化 `message.parts`。
2. UI 不从多个 raw source 里重建同一个 turn。
3. `parseMessageSegments(message)` 遍历 `message.parts`，按原顺序产生 segments。
4. 只合并相邻 text，和连续 reasoning/tool 组。
5. 非 process part 会打断 group，因此不会强行把正文、思考、工具重排。
6. 流式未完成的 group 展开，完成后的 group 折叠成 `思考N次，使用M个工具`。

StoClaw 可借鉴：

- 先把消息标准化成 part。
- part 顺序就是用户看到的顺序。
- UI 只负责分组、摘要、展开折叠。
- live 和 history 走同一个 part 结构。

---

## 3. 当前 StoClaw 关键代码地图

Cursor 开始前必须先读这些文件。

### 3.1 Assistant turn 入口

`src/pages/Chat/AssistantTurnMessage.tsx`

职责：

- 收集 `turnMessages / activeStream / turnToolResults`。
- 调用 `parseThinkingTurnLayout`。
- 读取/写入 streaming tools cache。
- 处理 done turn 的 streamingTools fallback。

风险：

- live 和 done source 不一致。
- streamingTools cache 可能保存低质量无 input 工具。
- done 时 cache 优先级过高，会污染最终展示。

### 3.2 当前 parser

`src/pages/Chat/thinking-turn-segments.ts`

职责：

- 将 raw messages 转为 `phase-text / tool-group / finalReplyText`。
- 根据 engine profile 做 Claude/OpenClaw 差异处理。
- 补充 streamingTools。
- 去重、重排、flush、normalize done segments。

风险：

- 函数过大，规则交织。
- text 是否 phase/final 的判断过多。
- tool identity 当前可能使用 `name + input`，会把同一工具的“无 input 版本”和“有 input 版本”当成两个工具。

### 3.3 工具卡

`src/components/chat/chat-tool-call-card.tsx`

`src/pages/Chat/message-utils.ts`

当前逻辑：

- `hasDisplayableToolInput(null | undefined | {})` 为 false。
- false 时显示 i18n `streaming.toolNoParams`，中文是“无参数”。

风险：

- 对真实无参数工具合理。
- 对“还没拿到参数”的 running placeholder 不合理。
- 对 cache fallback 产生的无 input completed tool 不合理。

### 3.4 工具来源与 cache

`src/lib/thinking-done-tools.ts`

`src/lib/thinking-timeline-active.ts`

`src/lib/thinking-turn-tools-cache.ts`

`src/stores/chat/helpers.ts`

风险：

- `extractToolUseUpdates` 对 Anthropic `tool_use/toolCall` 只提取 id/name/status，没有保存 `block.input`。
- `resolveDoneTurnStreamingTools` 当前 cache 优先。低质量 cache 如果没有 input，会压过 assistant message 里的高质量 `tool_use.input`。
- `mergeTimelineMonotonic` 会保留 cached 更长 timeline；如果 cached 里已有假 tool，后续不容易消掉。

---

## 4. 高优先级 bug：Claude 思考中大量“无参数”工具调用

用户截图现象：

- 思考过程中出现多张“调用工具 - 执行命令 / 联网搜索”。
- 每张展开后都是“无参数”。
- 这通常不是工具真的没有参数，而是 Claude streaming 中工具状态先到、参数后到或参数没有进入 `streamingTools`。

### 4.1 已定位的触发链路

#### Step 1：Claude `tool_use` 进入 store 时丢了 input

文件：

`src/stores/chat/helpers.ts`

位置：

- `extractToolUseUpdates`，约第 784-825 行。

当前代码在 Anthropic/normalized content block 中发现 `tool_use/toolCall` 后，只写入：

- `id`
- `toolCallId`
- `name`
- `status`
- `updatedAt`

没有写入：

- `input`
- `arguments`

结果：`streamingTools` 里出现只有 name/id/status 的工具状态。

同类重复代码还存在于：

`src/stores/chat.ts`

约第 1018 行附近。项目里有一份类似逻辑，改的时候要确认实际导出/调用路径，避免只改一份。

#### Step 2：upsert 时空 input 可能覆盖或保留低质量状态

文件：

`src/stores/chat/helpers.ts`

位置：

- `upsertToolStatuses`，约第 889-912 行。

当前 merge 是：

```ts
next[index] = {
  ...existing,
  ...update,
  name: update.name || existing.name,
  status: mergeToolStatus(existing.status, update.status),
  durationMs: update.durationMs ?? existing.durationMs,
  summary: update.summary ?? existing.summary,
  updatedAt: update.updatedAt || existing.updatedAt,
};
```

风险：

- 如果 `update.input` 是 `undefined`，由于 spread 顺序，已有 input 可能被覆盖掉。
- 即使没有覆盖，早期无 input 工具也可能进入 cache 并在完成态继续被使用。

Cursor 修复原则：

- `input` 必须使用质量合并：`update.input` 有可展示内容才覆盖；否则保留 `existing.input`。
- 空对象、null、undefined 不应覆盖已有非空 input。

#### Step 3：streamingTools cache 直接保存低质量工具

文件：

`src/lib/thinking-turn-tools-cache.ts`

位置：

- `writeTurnStreamingToolsCache`，约第 35-46 行。

当前逻辑会把 `streamingTools.map(normalizeStreamingTool)` 原样写入 cache。

风险：

- 如果 live 期间 `streamingTools` 是无 input 占位，cache 也保存无 input 占位。
- 后续 done 阶段读取 cache 时，这些占位工具会被当作完成态工具补回。

Cursor 修复原则：

- cache 写入时应按 tool identity 合并，保留更高质量 input。
- 不要让无 input 占位覆盖已有有 input 工具。
- cache 里应保存 `inputQuality/inputState`，至少要能区分 `unknown` 和 `none`。

#### Step 4：完成态优先使用 cache，压过真实 message input

文件：

`src/lib/thinking-done-tools.ts`

位置：

- `resolveDoneTurnStreamingTools`，约第 81-90 行。

当前优先级：

1. cache
2. assistant snapshot 里的 `tool_use`
3. tool_result

风险：

- cache 如果有无 input 工具，就直接 return。
- 后面的 `extractStreamingToolsFromTurnMessages` 即使能拿到真实 `tool_use.input`，也不会执行。

Cursor 修复原则：

- 不要 `if (cached.length > 0) return cached`。
- 应合并 `cached + fromMessages + fromToolResults`。
- 同一工具按 input 质量取最高版本。
- 推荐优先级：assistant `tool_use.input` > live streaming input > tool_result metadata input > cache input > unknown。

#### Step 5：工具 key 把 input 当成 identity，导致同一工具变两张卡

文件：

`src/pages/Chat/thinking-turn-segments.ts`

位置：

- `thinkingTimelineToolKey`，约第 82-85 行。

当前逻辑：

```ts
if (isStableToolId(tool.id, tool.name)) return tool.id;
return `${tool.name}::${JSON.stringify(tool.input ?? null)}`;
```

风险：

- 同一弱 id 工具，第一次 input 是 null，第二次 input 是 `{ query: ... }`，key 不同。
- parser 会认为这是两个工具。
- 一个显示“无参数”，另一个显示真实参数，或者只留下无参数版本。

同类问题还在：

- `src/pages/Chat/thinking/adjacent-group-phase.ts`
- `src/pages/Chat/message-utils.ts`

Cursor 修复原则：

- 工具 identity 不能包含 input。
- 稳定 id 优先。
- 没有稳定 id 时，使用 `turnStableKey + toolName + occurrenceIndex` 或 parser 内顺序索引。
- input 是 payload，只能用于 enrich，不用于 dedupe identity。

#### Step 6：Claude done fallback 会强制补入无 input 工具

文件：

`src/pages/Chat/thinking-turn-segments.ts`

位置：

- `ensureClaudeDoneSegmentsIncludeStreamingTools`，约第 1688-1728 行。

当前逻辑：

- 遍历 `streamingTools`
- 生成 `candidate = { id, name, input: tool.input ?? null }`
- 如果 key 没见过，就 `appendToolToGroup`

风险：

- cache 里的无 input streamingTool 会被强制补成完成态 tool。
- 补进去后，UI 认为这是一个 completed tool，但 input 为 null，于是显示“无参数”。

Cursor 修复原则：

- done fallback 只能补“确定存在但缺失的工具”，不能补低质量无 input placeholder。
- 如果没有稳定 tool id，且没有 input，且没有 tool_result 证明，不要补。
- 如果要补，也要标记 `inputState: unknown`，UI 不得显示“无参数”。

#### Step 7：UI 只要 input 不可展示就显示“无参数”

文件：

`src/components/chat/chat-tool-call-card.tsx`

位置：

- `ToolInputBody`，约第 74-128 行。

文件：

`src/pages/Chat/message-utils.ts`

位置：

- `hasDisplayableToolInput`，约第 216-223 行。

当前逻辑：

- `input == null` -> false
- `{}` -> false
- false -> 渲染 `streaming.toolNoParams`

风险：

- 它没有区分：
  - 参数未知
  - 参数还在流式输入
  - 工具确实无参数

Cursor 修复原则：

- 给工具卡增加 `inputState` 或等价字段。
- `unknown`：显示 loading/参数待返回，或直接不展示参数 body。
- `partial`：显示已流式内容 + loading。
- `complete`：显示参数。
- `none`：才显示“无参数”。

### 4.2 为什么截图里会“很多张”

不是单纯一张卡文案错了，而是多层放大：

1. Claude 工具状态先到，store 里记录无 input tool。
2. cache 保存无 input tool。
3. done 阶段 cache 优先，真实 message input 被跳过。
4. tool key 包含 input，导致无 input 和有 input 被当成不同工具。
5. `ensureClaudeDoneSegmentsIncludeStreamingTools` 又把缺失工具强制补回。
6. UI 对每个无 input tool 都渲染“无参数”。

所以修复不能只改文案。只把“无参数”改成“参数加载中”会遮住问题，但不会解决重复工具和 cache 污染。

### 4.3 最小止血方案

如果 Cursor 需要先快速降低用户可见 bug，按这个顺序：

1. `extractToolUseUpdates` 带上 `block.input ?? block.arguments`。
2. `upsertToolStatuses` 合并 input 时保留更高质量 input，不让 undefined/null/{} 覆盖已有 input。
3. `resolveDoneTurnStreamingTools` 改为合并 cache/messages/toolResults，不要 cache 优先 return。
4. `ChatToolCallCard` 增加 `inputState` 或至少增加 `suppressNoParams`：
   - running + 无 input：不显示“无参数”，显示 loading。
   - completed + cache fallback + 无 input：不显示“无参数”，可不展开 body。
   - 只有确认无参数才显示“无参数”。

止血方案仍不够完整，因为 tool key 仍可能制造重复卡。

### 4.4 正式修复方案

正式方案必须包含：

1. 新增统一工具 identity 函数。
2. 所有 parser/cache/UI dedupe 都使用同一个 identity。
3. identity 不包含 input。
4. 新增 input quality 合并函数。
5. done fallback 合并所有来源，而不是按 cache/messages/toolResults 单一路径 return。
6. UI 引入 `inputState`。
7. 为 Claude 无 input placeholder 写 fixture 测试。

建议新增工具函数：

```ts
type ToolInputState = 'unknown' | 'partial' | 'complete' | 'none';

function hasMeaningfulToolInput(input: unknown): boolean {
  if (input == null) return false;
  if (typeof input === 'string') return input.trim().length > 0;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.keys(input as Record<string, unknown>).length > 0;
  }
  return true;
}

function mergeToolInput(existing: unknown, incoming: unknown): unknown {
  if (hasMeaningfulToolInput(incoming)) return incoming;
  if (hasMeaningfulToolInput(existing)) return existing;
  return incoming ?? existing;
}
```

注意：`{}` 既可能是真无参数，也可能是“参数未返回”。必须依靠来源和状态判断，不要只靠对象是否为空。

### 4.5 必须补的测试

至少覆盖：

1. Claude `tool_use` block 带 input，`extractToolUseUpdates` 后 `streamingTools` 保留 input。
2. 先收到无 input tool status，后收到同 id 有 input tool，最终只有一个 tool 且 input 存在。
3. cache 有无 input tool，turnMessages 有同 id/tool name 的有 input tool，done 阶段最终取 turnMessages input。
4. 弱 id 工具 input 从 null 变 `{ query: 'x' }`，不生成两张卡。
5. running tool 无 input 时不显示“无参数”。
6. completed 真实无参数工具只显示一次“无参数”。
7. `ensureClaudeDoneSegmentsIncludeStreamingTools` 不补入没有稳定 id、没有 input、没有 tool_result 证明的 placeholder。

---

## 5. 推荐架构：TurnPart 标准化层

### 5.1 核心原则

1. 所有来源先转为 `TurnPart`。
2. `TurnPart` 只追加，不随意删除。
3. 已显示 part 只能同句补全，不能语义替换。
4. 工具 input 是可补全字段，不参与工具 identity。
5. live 和 history 使用同一个 normalizer + reducer。
6. UI 不再从 raw message 里猜顺序。

### 5.2 建议类型

建议新增：

`src/pages/Chat/thinking/turn-parts.ts`

```ts
export type TurnPartKind =
  | 'process_text'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'final_text'
  | 'workflow_card'
  | 'confirmed_params'
  | 'artifact'
  | 'waiting'
  | 'error'
  | 'interrupted';

export type ToolInputState = 'unknown' | 'partial' | 'complete' | 'none';

export type TurnPartBase = {
  id: string;
  kind: TurnPartKind;
  firstSeenOrder: number;
  source: 'live' | 'history' | 'cache' | 'tool_result';
  status?: 'running' | 'completed' | 'error' | 'interrupted';
};

export type ToolTurnPart = TurnPartBase & {
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

- `inputState: 'unknown'` 表示“还没拿到参数”，不是“无参数”。
- `inputState: 'none'` 才表示“确认无参数”。
- `toolIdentity` 不包含 input。

### 5.3 工具 identity 规则

优先级：

1. 稳定 `tool_use.id` / `toolCallId`。
2. 没有稳定 id 时，用 `turnStableKey + toolName + occurrenceIndex`。
3. 不得使用 `JSON.stringify(input)` 作为 identity。

需要重点改：

- `src/pages/Chat/thinking-turn-segments.ts`
- `src/pages/Chat/thinking/adjacent-group-phase.ts`
- `src/pages/Chat/message-utils.ts`
- `src/lib/thinking-timeline-active.ts`

### 5.4 工具 input 质量优先级

同一工具的 input 合并优先级：

1. assistant message 中真实 `tool_use.input`
2. live streaming tool input
3. tool_result metadata input
4. cache input
5. unknown

规则：

- 高质量 input 覆盖低质量 input。
- 空 object / null / undefined 不能覆盖已有非空 input。
- cache 只能补充，不能压过 assistant message/tool_use。
- completed + input unknown 不得直接渲染“无参数”。

---

## 6. UI 分组规则

连续出现的以下 part 合并成 process group：

- `process_text`
- `reasoning`
- `tool_call`
- `tool_result`
- `waiting`

遇到以下 part 打断 group：

- `final_text`
- `workflow_card`
- `confirmed_params`
- `artifact`
- `error`
- `interrupted`

完成后的 process group 折叠为一级摘要：

`思考 {reasoning/process_text 数量} 次，使用 {tool_call 数量} 个工具`

流式中：

- `reasoning` 展开。
- `tool_call` 展开。
- 当前 active 块 shimmer/loading。

完成后：

- 二级块默认收起。
- 用户展开一级摘要后，直接显示完整内容。
- 已完成内容不重新 typewriter。

---

## 7. 分阶段施工计划

### Phase 0：OpenSpec 与测试准备

按项目 OpenSpec 规则建 change：

`stabilize-chat-thinking-timeline`

先补 fixture 测试，再改逻辑。

### Phase 1：先止血“无参数”bug

目标：

- 工具 input 不再丢。
- cache 不再压过真实 input。
- UI 不再把 unknown 参数显示成“无参数”。

建议改动：

1. `extractToolUseUpdates` 写入 input。
2. `upsertToolStatuses` 使用 input quality merge。
3. `resolveDoneTurnStreamingTools` 合并所有来源。
4. `ChatToolCallCard` 支持 `inputState` 或临时 suppress no params。
5. 补测试。

### Phase 2：新增 TurnPart normalizer

新增：

- `src/pages/Chat/thinking/turn-parts.ts`
- `src/pages/Chat/thinking/turn-part-reducer.ts`
- `src/pages/Chat/thinking/turn-part-groups.ts`

职责：

1. 从 raw messages 提取候选 events。
2. 按 chronological order 输入 reducer。
3. reducer 输出稳定 `TurnPart[]`。
4. live/history 使用同一套 reducer。
5. 对旧 `ThinkingTurnSegment` 提供 adapter。

### Phase 3：统一工具 identity 与 cache 合并

目标：

- tool identity 不含 input。
- 同一工具无 input 占位 + 有 input 正式块，最终只有一个工具。
- cache 只补充，不污染。

### Phase 4：统一 live/history

目标：

- `AssistantTurnMessage` live 和 done 走同一 normalized parts。
- done fallback 只补缺口，不重新排序。
- `mergeTimelineMonotonic` 只保护已见顺序，不承担业务重建。

### Phase 5：UI 适配

尽量保留现有组件：

- `ThinkingTurnProcess`
- `ChatProcessBlock`
- `ChatToolCallCard`
- `ChatProcessLoadingIndicator`
- `ChatMessage`
- `WorkflowCard`

### Phase 6：排队与中断样式

等 timeline 稳定后再做，避免混进一个大 diff。

---

## 8. 验收清单

### 8.1 数据顺序

- [ ] live 出现 A/B/C，history 刷新后仍是 A/B/C。
- [ ] Claude 先正文后工具，不强制工具跑到正文前。
- [ ] phase text、thinking、tool、final reply 都按首次出现时间展示。
- [ ] 已展示内容不会消失。
- [ ] 已展示内容不会语义替换。

### 8.2 思考过程

- [ ] 正常向下展开。
- [ ] 二级 active thinking 展开。
- [ ] 二级 active tool 展开。
- [ ] 二级完成后收起。
- [ ] 一级完成后显示 `思考N次，使用M个工具`。
- [ ] phase text 打断时，前一组完成并折叠。
- [ ] 手动展开不影响后续 active group 自动展开。
- [ ] 完成态展开直接显示完整内容，无 typewriter 重播。

### 8.3 工具调用

- [ ] 同一个工具不会因为 input 从空变有而重复两张卡。
- [ ] running tool 未拿到 input 时不显示“无参数”。
- [ ] completed tool 确认无参数时才显示“无参数”。
- [ ] cache 无 input 不覆盖 message 有 input。
- [ ] tool_result 可以补充状态/结果，但不破坏顺序。
- [ ] Claude 执行命令/联网搜索不再批量出现“无参数”卡。

### 8.4 正文与旁白

- [ ] 用户原问 echo 隐藏。
- [ ] “我来/让我/现在我会”等过程旁白进入思考区。
- [ ] 真正回答进入正文。
- [ ] 重复内容不在正文和思考里双份展示。
- [ ] “你还需要我继续吗？”进入思考旁白。

### 8.5 工作流与输入

- [ ] thinking 在工作流执行中继续显示。
- [ ] “参数已确认”折叠摘要保留。
- [ ] 展开后显示完整表单/填写详情。
- [ ] 工作流卡和参数确认之间允许插入说明文字。
- [ ] 失败显示失败原因。
- [ ] artifact 正文优先、预览其次。
- [ ] 等待态文案为 `等待你的回复…`。
- [ ] 发送中再次发送有排队样式。
- [ ] Stop 保留已有输出并标记已中断。

---

## 9. 建议测试命令

按改动范围选择，不要跑安装命令。

```bash
pnpm test
pnpm run typecheck
pnpm run lint
```

如果改动涉及通信路径、runtime send/receive、fallback、gateway event：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

---

## 10. Cursor 禁止事项

1. 不要只把“无参数”文案换掉来掩盖问题。
2. 不要让 `thinkingTimelineToolKey` 继续包含 input。
3. 不要让 done cache 无条件优先于 assistant message。
4. 不要在 UI 层根据当前 rendering 长度决定业务顺序。
5. 不要为了 Claude 特例破坏 OpenClaw。
6. 不要重写输入框现有功能。
7. 不要修改依赖、lockfile、构建配置、CI、脚本。

最后记住：

**流怎么来，就按首次出现顺序落成 parts；后续只能补全状态和 payload，不能重新发明顺序和语义。**
