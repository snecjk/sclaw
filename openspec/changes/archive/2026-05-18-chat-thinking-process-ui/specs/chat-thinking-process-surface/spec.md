# chat-thinking-process-surface

聊天与任务子项会话中，展示模型思考时间线、连接等待态及工具调用子项的 Renderer 能力。主题色与文本层级须符合 `docs/sto-design.md`。

## ADDED Requirements

### Requirement: Connecting model placeholder

在助手回复尚未产生任何流式内容（无思考、无文本、无工具状态）且会话处于发送中时，系统 MUST 展示轻量连接占位，而非大号活动卡片或旋转加载图标作为主视觉。

#### Scenario: User sends message and waits for first token

- **WHEN** 用户已发送消息、`sending` 为真，且尚无任何流式内容块
- **THEN** 消息列表中显示中性灰底条与「连接模型中…」（或当前语言的等价 i18n 文案），且不显示思考过程折叠面板

### Requirement: Thinking process timeline panel

当 `showThinking` 为真且消息含思考块和/或工具调用时，系统 MUST 在单一「思考过程」折叠区域内，按消息 `content` 块顺序渲染思考段落与编号工具子项。

#### Scenario: Assistant message with interleaved thinking and tools

- **WHEN** 助手消息 `content` 数组依次包含 `thinking` 文本、`tool_use`、`thinking` 文本
- **THEN** 思考过程面板内先显示第一段思考正文，再显示「工具调用 1」可折叠行，再显示第二段思考正文

#### Scenario: User disables show thinking

- **WHEN** `showThinking` 为假
- **THEN** 不渲染思考过程面板（工具卡片可仍按既有规则在消息气泡外展示）

### Requirement: Tool call sub-rows

思考过程面板内的每个工具调用 MUST 以「工具调用 N」（N 为从 1 递增的序号）为标题，默认折叠；展开后显示工具入参 JSON 或文本。

#### Scenario: User expands tool call row

- **WHEN** 用户点击「工具调用 2」行
- **THEN** 该行展开并显示对应 `tool_use` 的 `input`/`arguments` 内容

### Requirement: Streaming default expansion

流式生成中的思考过程面板 MUST 默认展开；已完成的历史消息 MUST 默认折叠。

#### Scenario: Streaming assistant turn

- **WHEN** 当前助手消息 `isStreaming` 为真且存在思考时间线
- **THEN** 思考过程面板初始为展开状态

#### Scenario: Historical assistant message

- **WHEN** 用户查看已完成的助手消息且存在思考时间线
- **THEN** 思考过程面板初始为折叠状态

### Requirement: STO theme alignment

思考过程与连接占位的背景、边框与文字层级 MUST 使用与 `docs/sto-design.md` 一致的中性色语义（如 Grey-2 背景、Grey-8/10 文本），不得使用品牌橙渐变作为主容器样式。

#### Scenario: Light theme thinking panel

- **WHEN** 应用处于浅色主题
- **THEN** 思考过程容器使用浅灰中性背景且无重阴影卡片样式
