## 1. OpenSpec 与解析

- [x] 1.1 新增 `extractThinkingTimeline`（`### Requirement: Thinking process timeline panel`）
- [x] 1.2 工具仅存在于 `tool_calls` 时回退并入时间线

## 2. UI 组件

- [x] 2.1 新建 `ThinkingProcessPanel` 与 `ConnectingModelIndicator`（`### Requirement: Connecting model placeholder`、`Tool call sub-rows`、`STO theme alignment`）
- [x] 2.2 `ChatMessage` 在 `showThinking` 时接入面板并移除重复工具卡（`### Requirement: Thinking process timeline panel`）
- [x] 2.3 主聊天与任务子项替换等待态（`### Requirement: Connecting model placeholder`）
- [x] 2.4 流式/历史默认展开策略（`### Requirement: Streaming default expansion`）

## 3. i18n

- [x] 3.1 增加 `connectingModel`、`thinkingProcessTitle`、`toolCallLabel` 等键（zh/en/ja）

## 4. 验证

- [x] 4.1 `pnpm run typecheck`
- [x] 4.2 `pnpm run lint`（若环境允许）
