# Capability: `skills-plaza-marketplace`（本 change 修改）

## 修改需求

### Requirement: 使用技能（跳转对话）

已安装技能的"使用"按钮 MUST 跳转到对话页面，并在输入框预填技能标签（展示 `title`），等待用户手动发送。系统 MUST NOT 自动发送 `defaultPrompt`，且 MUST NOT 通过 URL 传递 `defaultPrompt`。

#### Scenario: 点击使用按钮
- **WHEN** 用户点击已安装技能的"使用"按钮
- **THEN** 系统 MUST 调用 `POST /api/skill-plaza/use` 记录一次使用（异步，不阻塞）
- **AND** 系统 MUST 通过 React Router 导航至应用内首页路由 `/?skill=<encodeURIComponent(slug)>`
- **AND** URL MUST NOT 包含 `q=<encodedPrompt>` 或 `encodeURIComponent(skill.defaultPrompt)`
- **AND** 路由跳转 MUST 使用 `useNavigate`，NOT 使用 `window.open` 或外部链接
- **AND** 系统 MUST NOT 在 Gateway 就绪后自动发送消息

#### Scenario: 预填技能标签而非 defaultPrompt 文本
- **WHEN** 用户通过「使用」进入首页输入框
- **THEN** 输入框 MUST 展示 skill token，可见文案 MUST 为 `skill.title`
- **AND** 输入框 MUST NOT 预填 `defaultPrompt` 纯文本
- **AND** 用户 MUST 可继续在标签后输入补充文本并手动发送

#### Scenario: 发送时 defaultPrompt 隐藏注入
- **WHEN** 用户从预填 skill 标签的输入框点击发送
- **THEN** Gateway RPC `text` MUST 包含 `defaultPrompt`（及可选用户输入拼接）
- **AND** 用户消息气泡 MUST 展示技能标签（`title`）与用户输入
- **AND** 气泡 MUST NOT 展示 `defaultPrompt` 正文
