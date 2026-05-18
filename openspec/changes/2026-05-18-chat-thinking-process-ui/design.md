## Context

助手消息 `content` 为块数组，可交错 `thinking` 与 `tool_use`。现有 UI 将 `extractThinking` 合并为单块 `ThinkingBlock`，工具则独立 `ToolCard`，等待态使用 `AssistantActivityCard`。原型要求扁平灰底、顺序化展示，并在首包前仅显示「连接模型中…」。

## Goals / Non-Goals

**Goals**

- 连接态与思考过程视觉对齐原型及 `docs/sto-design.md` 中性色阶梯。
- 按 content 顺序渲染思考段落与编号工具子项。
- 流式 `streamingTools` 与已入消息的 `tool_use` 在思考面板内统一展示运行/完成态。

**Non-Goals**

- 不改变 Gateway 消息协议或 `showThinking` 开关语义。
- 不改造 `AssistantActivityCard` 用于工具结果整理阶段（`pendingFinal`）— 仅替换「尚无流式内容」的等待态。

## Decisions

### 1. 时间线解析放在 `message-utils`

新增 `extractThinkingTimeline(message)`，单次遍历 `content` 数组产出 `thinking | tool` 段，并给 tool 分配 1-based 序号。

**理由**：与现有 `extractThinking` / `extractToolUse` 同源，便于单测与 `ChatMessage` 复用。  
**备选**：在组件内内联遍历 — 拒绝，不利于任务子项与主聊天共用。

### 2. 新建 `ThinkingProcessPanel` + `AssistantTurnMessage` 分组

工具调用时 Gateway 会把中间 `thinking+tool_use` 快照写入 `messages[]`，若每条快照各渲染一块「思考过程」会出现多块卡片。`buildChatDisplayItems` 将同一用户消息后的连续 assistant 快照合并为 `assistant-turn`，`mergeThinkingTimelines` 按顺序拼接思考段与「工具调用 N」；流式阶段通过 `useChatDisplay` 将 `activeTurn` 与最后一条 turn 合并展示。

**理由**：与录屏原型一致——单头像、单思考面板、最终回复在其下。  
**备选**：改快照写入逻辑 — 影响面大且不利于历史回放。

### 3. 连接态：`ConnectingModelIndicator`

无头像、无边框卡片，仅 `Grey-2`（`bg-muted` / `--canvas-via`）条 + `Grey-7` 文案，替换 `TypingIndicator` 及任务子项中的 `Loader2` 行。

**理由**：对齐原型图 1。  
**备选**：保留 spinner — 与原型不符。

### 4. 默认展开策略

`defaultExpanded={isStreaming}`；用户可手动折叠，状态仅存于组件内。

**理由**：流式时默认可见思考；历史消息减少噪音。

## Risks

- **[Risk]** 部分模型仅通过 `tool_calls` 根字段传工具、content 无序 → **Mitigation**：保留 `extractToolUse` 回退，在时间线为空但有工具时追加工具段。
- **[Risk]** 暗色主题对比不足 → **Mitigation**：使用语义 token（`muted`、`muted-foreground`、`foreground`），避免固定 `#999` 硬编码。

## UI Tokens（sto-design.md）

| 用途 | Token |
|------|--------|
| 连接态 / 思考容器底 | Grey-2 `#F5F6F7` → `bg-muted` |
| 次要文案 / 工具行 | Grey-7～8 → `text-muted-foreground` |
| 思考正文 | Grey-10 → `text-foreground` |
