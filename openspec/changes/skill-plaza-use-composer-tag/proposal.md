## Why

技能广场「使用」按钮当前行为是：创建新会话 → 跳转首页 `/?q=<defaultPrompt>` → Gateway 就绪后**自动发送**纯文本 prompt。这与产品最新交互稿不一致：

- 用户无法在发送前补充或修改任务描述
- 输入框不展示技能上下文，用户不清楚当前正在使用哪个技能
- 会话气泡仅显示纯文本，无法区分「技能标签」与「用户补充内容」

需要将「使用」改为**预填技能标签到输入框、等待用户手动发送**，并在用户消息气泡中以 **[技能标签] + [用户输入]** 的形式展示。

## What Changes

- **技能广场入口**：`SkillCard` / `SkillDetailModal` 的「使用」「立即使用」改为跳转 `/?skill=<slug>`，不再携带 `?q=` 触发自动发送
- **Home 深链解析**：新增 `?skill=` 参数解析；有 `skill` 时仅 seed 编辑器，**不**走现有 `?q=` auto-send 逻辑
- **Composer 技能 Token**：在 `DingTalkMentionEditor` / `dingtalk-mention-composer` 中新增 skill inline token（参照 workflow token），插入输入框首位，光标置于 token 后
- **发送链路扩展**：`MentionComposerSnapshot`、`SendMessageOptions`、`dispatchChatSend` 透传 `skillMeta`；允许「仅有 skill 标签、无用户文本」时发送
- **字段职责分离（核心）**：
  - **标签 / 气泡可见层**：仅展示 `skill.title`（技能名称），MUST NOT 展示 `defaultPrompt`
  - **Gateway 发送层**：在用户点击发送时，按 `skill.slug` 解析 `defaultPrompt` 并注入 RPC `text`；用户无补充输入时 `text = defaultPrompt`，有补充输入时 `text = defaultPrompt + 用户输入` 拼接
  - **导航层**：`SkillCard` / `SkillDetailModal` 仅传 `?skill=<slug>`，MUST NOT 再通过 URL 传递 `defaultPrompt`（删除现有 `encodeURIComponent(skill.defaultPrompt || skill.title)` 逻辑）
- **用户消息气泡**：乐观消息 `content` 仅存用户输入文本；`_skillMeta.title` 驱动技能标签渲染；`defaultPrompt` MUST NOT 出现在气泡正文中
- **样式与 i18n**：新增 composer / message 共用的 skill tag 样式 token（对齐 `docs/sto-design.md` Brand-1 / Brand-6）；补充相关 i18n 键

## Capabilities

### New Capabilities

- `skills-plaza-use-composer`: 技能广场「使用」→ 首页输入框预填技能标签、用户手动发送、用户气泡展示「技能标签 + 用户文本」的完整交互契约

### Modified Capabilities

- `skills-plaza-marketplace`: 「使用技能（跳转对话）」需求变更——由「跳转并预填充 `defaultPrompt` 自动发送」改为「跳转并插入技能标签，不自动发送」
- `skills-plaza-detail`: 详情弹窗「立即使用」CTA 行为与卡片「使用」按钮保持一致

## Impact

- **Renderer**
  - `src/components/skill-plaza/SkillCard.tsx`
  - `src/components/skill-plaza/SkillDetailModal.tsx`
  - `src/pages/Home/index.tsx`、`HomeComposer.tsx`
  - `src/lib/dingtalk-mention-composer.ts`
  - `src/components/dingtalk/DingTalkMentionEditor.tsx`
  - `src/pages/Chat/ChatInput.tsx`
  - `src/pages/Chat/ChatMessage.tsx`
  - `src/hooks/dispatch-chat-send.ts`
  - `src/stores/chat/types.ts`、`runtime-send-actions.ts`
  - `src/stores/message-queue.ts`（排队消息保留 skill 上下文）
  - `src/lib/surfaces.ts`（skill tag 样式 token）
  - `src/i18n/locales/*/skills.json`、`chat.json`（如有）
- **Main Process**
  - 本期**不修改** Gateway 协议；可选在 `/api/chat/send` body 增加 `skillSlug` 透传字段（设计阶段预留，实现时按后端确认）
- **视觉**
  - 技能标签背景 Brand-1、文字/图标 Brand-6 `#FF6F00`，遵循 `docs/sto-design.md`
- **文档**
  - 实现完成后需同步检查 `README.md` / `README.zh-CN.md` / `README.ja-JP.md` 中关于技能「使用」行为的描述

## Out of Scope

- 修改 Gateway / OpenClaw 技能路由协议（除非产品确认必须在 RPC 层显式传 `skillSlug`）
- 历史消息回填 skill 标签（Gateway history 不含 `_skillMeta` 的旧消息保持纯文本展示）
- 输入框内同时存在 skill token 与 workflow token 的组合策略（本期建议互斥，详见 design.md）
- 技能广场「我的技能」列表视图新增「使用」按钮（当前仅卡片视图有；不在本 change 范围）
- 修改 `POST /api/skill-plaza/use` 统计口径（仍为点击「使用」时上报，与是否发送无关）
