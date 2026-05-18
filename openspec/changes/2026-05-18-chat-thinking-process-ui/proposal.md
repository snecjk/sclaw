## Why

当前聊天中的「思考过程」与等待模型响应的占位态采用重卡片、强阴影与工具名直出样式，与 STO 任务场景原型不一致，也难以在思考文本与多次工具调用之间呈现顺序关系。需要对齐原型：轻量灰底连接提示，以及可折叠、按时间线排列的「思考过程 + 工具调用 N」区块。

## What Changes

- 将发送后、尚无流式内容时的占位由大号活动卡片改为「连接模型中…」轻量文案条（对齐 `docs/sto-design.md` Grey-2 背景 + Grey-7/8 次要文本）。
- 将助手消息中的思考内容与 `tool_use` 合并为单一「思考过程」折叠面板，按 `content` 块顺序渲染思考段落与「工具调用 N」子项。
- 流式阶段默认展开思考面板；历史消息默认折叠。
- 在 `showThinking` 关闭时保持现有工具卡片行为，不展示思考面板。

## Capabilities

### New Capabilities

- `chat-thinking-process-surface`: 聊天与任务子项会话中的思考时间线展示、连接态占位与工具调用子项折叠交互。

### Modified Capabilities

<!-- 无既有 openspec/specs 能力文档需整段 MODIFIED -->

## Impact

- `src/pages/Chat/ChatMessage.tsx`、`ThinkingProcessPanel.tsx`（新建）
- `src/pages/Chat/message-utils.ts`
- `src/pages/Chat/index.tsx`、`src/pages/TaskDetail/TaskSubitemChatSurface.tsx`
- `src/i18n/locales/*/chat.json`
- 视觉对齐 `docs/sto-design.md`（Grey-2/3 背景、Grey-8/10 文本层级）
