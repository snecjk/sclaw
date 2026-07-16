## MODIFIED Requirements

### Requirement: Composer skill token 序列化规则

`dingtalk-mention-composer` 对 skill token 的序列化 MUST 与 UI / 发送语义一致。

#### Scenario: skill token 不计入 plainText
- **WHEN** 编辑器包含 skill token 与用户输入
- **THEN** `serializeMentionEditor().plainText` MUST 仅包含用户输入
- **AND** `serializeMentionEditor().skill` MUST 包含 `{ slug, title }`

#### Scenario: 同一时刻最多一个 skill token
- **WHEN** 用户再次从技能广场选择另一技能
- **THEN** 系统 MUST 替换现有 skill token
- **AND** MUST 保留用户已输入的补充文本（若存在）

#### Scenario: 从 composer 技能浮层选择技能
- **WHEN** 用户通过 `*` 触发或 wrench 工具 icon 在对话输入框内选择已安装技能
- **THEN** 系统 MUST 调用 `insertSkillSpan(slug, title)` 插入或替换 skill token
- **AND** MUST 遵循与技能广场 `?skill=` 深链相同的唯一 token 与互斥规则
- **AND** MUST NOT 自动发送消息

#### Scenario: skill token 与 workflow token 互斥
- **WHEN** 编辑器插入 skill token
- **THEN** 系统 MUST 清除 workflow token 及 `workflowId`
- **WHEN** 编辑器插入 workflow token
- **THEN** 系统 MUST 清除 skill token 及 `skill` snapshot 字段
