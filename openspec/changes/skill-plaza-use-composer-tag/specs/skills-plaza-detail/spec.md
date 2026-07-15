# Capability: `skills-plaza-detail`（本 change 修改）

## 修改需求

### Requirement: 详情弹窗"立即使用"CTA

弹窗底部 MUST 展示"立即使用"按钮。按钮行为 MUST 与卡片"使用"按钮一致（已安装则跳转对话并预填技能标签，未安装则展示安装操作）。已安装时 MUST NOT 自动发送 `defaultPrompt`。

#### Scenario: 已安装技能的立即使用
- **WHEN** 弹窗中的技能已在本地安装
- **THEN** "立即使用"按钮 MUST 可点击
- **AND** 点击后 MUST 调用 `POST /api/skill-plaza/use` 记录一次使用（异步，不阻塞）
- **AND** 系统 MUST 导航至首页 `/?skill=<encodeURIComponent(slug)>`
- **AND** URL MUST NOT 包含 `q=<encodeURIComponent(skill.defaultPrompt)>`
- **AND** 系统 MUST NOT 自动发送消息
- **AND** 弹窗 MUST 关闭

#### Scenario: 预填标签展示 title 而非 defaultPrompt
- **WHEN** 用户通过详情弹窗「立即使用」进入首页
- **THEN** 输入框 skill token 可见文案 MUST 为 `skill.title`
- **AND** MUST NOT 预填或展示 `defaultPrompt` 文本

#### Scenario: 未安装技能的立即使用
- **WHEN** 弹窗中的技能未安装
- **THEN** "立即使用"按钮文字 MUST 变为"立即安装"
- **AND** 点击后 MUST 触发安装流程
- **AND** 安装完成后按钮文本 MUST 更新为"立即使用"
