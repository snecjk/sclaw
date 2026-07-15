# Tasks: `skill-plaza-use-composer-tag`

## 1. 技能广场入口 — 导航与字段职责

- [ ] 1.1 修改 `src/components/skill-plaza/SkillCard.tsx`：`handleUse` 改为 `navigate('/?skill=<slug>')`，删除 `encodeURIComponent(skill.defaultPrompt || skill.title)` 与 `?q=` 导航（Requirement: 技能字段职责分离 / Requirement: 使用技能（跳转对话））
- [ ] 1.2 修改 `src/components/skill-plaza/SkillDetailModal.tsx`：`handleUse` 与卡片保持一致，导航 `/?skill=<slug>`，删除 `?q=<defaultPrompt>`（Requirement: 详情弹窗"立即使用"CTA）
- [ ] 1.3 确认 `newSession()` + `useSkill(slug)` 统计逻辑保持不变，点击「使用」即上报、不等待发送（Requirement: 技能标签预填输入框（不自动发送））
- [ ] 1.4 （可选）扩展 `src/lib/main-chat-navigation.ts`：`extraSearchParams` 支持 `skill` 键，供后续非 Home 深链复用（Non-Goal 本期可不实现）

## 2. Home 深链 — skill seed 与 auto-send 解耦

- [ ] 2.1 修改 `src/pages/Home/index.tsx`：解析 `searchParams.get('skill')` 为 `seedSkillSlug`（Requirement: 技能字段职责分离）
- [ ] 2.2 修改 `Home/index.tsx` auto-send `useEffect`：存在 `seedSkillSlug` 时 MUST NOT 调用 `handleHubSend`；仅 `?q=`（无 skill）保持现有 auto-send（Requirement: 技能标签预填输入框（不自动发送））
- [ ] 2.3 解析 `skill` / 完成 seed 后 `setSearchParams({}, { replace: true })` 清 URL，防止刷新重复插入（Requirement: 技能标签预填输入框（不自动发送））
- [ ] 2.4 将 `seedSkillSlug` 经 `HomeComposer` 传入 `ChatInput` → `DingTalkMentionEditor`（Requirement: 输入框 tag 仅展示 title）
- [ ] 2.5 确认 `HomeSiteSurface`（网点首页）若复用同一 seed 逻辑，同步传入 `seedSkillSlug`（如有独立 composer 封装）

## 3. Composer — skill token 基础设施

- [ ] 3.1 在 `src/lib/dingtalk-mention-composer.ts` 新增 `SKILL_SPAN_CLASS`、`SkillMeta` 类型，扩展 `MentionComposerSnapshot.skill?`（Requirement: Composer skill token 序列化规则）
- [ ] 3.2 实现 `createSkillSpan(slug, title)`：`contentEditable="false"`，`dataset.skillSlug` / `dataset.skillTitle`，可见文案为 `title`（含 Wrench 图标占位或 class hook）（Requirement: 输入框 tag 仅展示 title）
- [ ] 3.3 实现 `insertSkillSpan(root, slug, title)`：插入编辑器首位 + 光标置于 token 后；再次插入时替换旧 token、保留用户 `plainText`（Requirement: 同一时刻最多一个 skill token）
- [ ] 3.4 实现 `removeSkillSpan(root)` 与 Backspace 删除行为（参照 workflow token）（Requirement: Composer skill token 序列化规则）
- [ ] 3.5 更新 `serializeMentionEditor`：walk skill span 时写入 `snapshot.skill`，**不** append `textContent` 到 `plainText`（Requirement: skill token 不计入 plainText）
- [ ] 3.6 更新 `isEmpty` 判定：`!skill && plainText.trim() === '' && mentions.length === 0`（Requirement: 仅有 skill 标签即可发送）
- [ ] 3.7 实现 skill / workflow token 互斥：插入一方时清除另一方（Requirement: skill token 与 workflow token 互斥）

## 4. DingTalkMentionEditor — seed 与 API 暴露

- [ ] 4.1 扩展 `DingTalkMentionEditor` props：`seedSkillSlug?: string`（Requirement: 技能标签预填输入框（不自动发送））
- [ ] 4.2 扩展 editor handle：`insertSkill(slug, title)`、`removeSkill()`（Requirement: 输入框 tag 仅展示 title）
- [ ] 4.3 实现 `seedSkillSlug` useEffect：从 `useSkillPlazaStore` 按 slug 解析 `title`（fallback: slug）；调用 `insertSkillSpan`；Gateway 未就绪也完成 seed（Requirement: Gateway 未就绪时仍可预填）
- [ ] 4.4 若 store 无缓存，`title` / `defaultPrompt` fallback 策略：按需 `GET /api/skill-plaza/skill/:slug`（Requirement: 发送时注入 defaultPrompt 到 Gateway — fallback 链）

## 5. ChatInput — 发送条件与透传

- [ ] 5.1 修改 `ChatInput` `canSend`：存在 `snapshot.skill` 时允许发送（即使 `plainText` 为空）（Requirement: 仅有 skill 标签即可发送）
- [ ] 5.2 修改 `handleSend`：从 snapshot 读取 `skill`，透传至 `onSend` / `onQueue`（Requirement: 发送链路透传 skillMeta）
- [ ] 5.3 扩展 `ChatInput` / `useChatInputBindings` / `use-home-chat-entry-send` 回调签名，增加 `skillMeta?: SkillMeta` 参数（Requirement: dispatchChatSend 透传）
- [ ] 5.4 发送后 `mentionEditorRef.clear()` 一并清除 skill token（Requirement: Composer skill token 序列化规则）

## 6. 发送链路 — Gateway 文本与乐观消息分离

- [ ] 6.1 扩展 `src/stores/chat/types.ts`：`SendMessageOptions.skillMeta?`、`RawMessage._skillMeta?`（Requirement: 气泡不展示 defaultPrompt）
- [ ] 6.2 新增 `resolveSkillGatewayText(slug, userText)` 工具（或内联于 send actions）：按 slug 取 `defaultPrompt`（fallback: `title`），拼接 `` `${defaultPrompt}\n\n${userText}` `` 或仅 `defaultPrompt`（Requirement: 发送时注入 defaultPrompt 到 Gateway）
- [ ] 6.3 修改 `src/hooks/dispatch-chat-send.ts`：接收并透传 `skillMeta` 至 `sendMessage`（Requirement: dispatchChatSend 透传）
- [ ] 6.4 修改 `src/stores/chat/runtime-send-actions.ts`：
  - Gateway RPC `text` = `resolveSkillGatewayText(...)`
  - 乐观 `RawMessage.content` = 用户 `plainText` only（可为空）
  - 乐观 `RawMessage._skillMeta` = `{ slug, title }`（Requirement: 气泡不展示 defaultPrompt / Requirement: 发送链路透传 skillMeta）
- [ ] 6.5 修改 `src/stores/message-queue.ts`：`QueuedMessage` 增加 `skillMeta?`，dequeue 时保持相同语义（Requirement: 消息队列保留 skill 上下文）
- [ ] 6.6 （可选，待后端确认）在 `/api/chat/send` body 增加 `skillSlug` 透传字段（design Decision 7）

## 7. 消息气泡 — SkillTag 渲染与样式

- [ ] 7.1 在 `src/lib/surfaces.ts` 新增 `skillComposerTagClass` / `skillMessageTagClass`（Brand-1 背景 + Brand-6 `#FF6F00` 文字/图标，对齐 `docs/sto-design.md`）（Requirement: 用户消息气泡展示技能标签与用户文本）
- [ ] 7.2 新建 `src/components/skill-plaza/SkillMessageTag.tsx`（或 `src/components/chat/SkillMessageTag.tsx`）：渲染 wrench 图标 + `title`（Requirement: 用户消息气泡展示技能标签与用户文本）
- [ ] 7.3 修改 `src/pages/Chat/ChatMessage.tsx` 用户气泡：有 `_skillMeta` 时渲染 `<SkillMessageTag />` + 用户 `text`；无 `_skillMeta` 保持原逻辑（Requirement: 旧消息兼容）
- [ ] 7.4 确认 `extractText` / `cleanUserText` / `user-message-display` 不会把 `defaultPrompt` 泄漏到展示层（Requirement: 气泡不展示 defaultPrompt）
- [ ] 7.5 为 composer 内 skill token DOM 复用与气泡一致的视觉 token（CSS class 或 shared component 样式）（Requirement: 输入框 tag 仅展示 title）

## 8. i18n 与文档

- [ ] 8.1 检查 `src/i18n/locales/*/skills.json`：「使用」相关文案是否需要补充说明（如无障碍 `aria-label`）（Requirement: 用户消息气泡展示技能标签与用户文本）
- [ ] 8.2 实现完成后审查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 中技能「使用」行为描述，按需更新（openspec tasks 规则）

## 9. 单元测试

- [ ] 9.1 新增 `tests/unit/dingtalk-mention-composer-skill.test.ts`：覆盖 `serializeMentionEditor` skill token 不计入 `plainText`、`snapshot.skill` 正确、互斥逻辑（Requirement: Composer skill token 序列化规则）
- [ ] 9.2 新增 `tests/unit/skill-gateway-text.test.ts`：覆盖 `resolveSkillGatewayText` 无用户输入 / 有用户输入 / fallback 链（Requirement: 发送时注入 defaultPrompt 到 Gateway）
- [ ] 9.3 新增或扩展 `tests/unit/chat-message-skill-tag.test.tsx`：有 `_skillMeta` 渲染 tag+text、无 meta 兼容、不展示 defaultPrompt（Requirement: 用户消息气泡展示技能标签与用户文本 / Requirement: 气泡不展示 defaultPrompt）
- [ ] 9.4 新增 `tests/unit/skill-plaza-use-navigation.test.ts`：mock `navigate`，断言 `SkillCard` / `SkillDetailModal` 生成 `/?skill=` 且不含 `?q=`（Requirement: 技能广场导航不传 defaultPrompt）

## 10. 手工验证与回归

- [ ] 10.1 技能广场 → 点击「使用」→ 首页输入框出现橙色 tag（`title`）→ **不自动发送**（Requirement: 技能标签预填输入框（不自动发送））
- [ ] 10.2 标签后输入补充文本 → 发送 → 气泡为 `[tag][用户文本]`，无 `defaultPrompt` 正文（Requirement: 有用户补充输入）
- [ ] 10.3 仅 tag 无输入 → 发送 → 气泡仅 tag；Network 中 Gateway `text` 为 `defaultPrompt`（Requirement: 无用户补充输入）
- [ ] 10.4 Gateway 未就绪时点击「使用」→ 仍预填 tag → 就绪后手动发送成功（Requirement: Gateway 未就绪时仍可预填）
- [ ] 10.5 详情弹窗「立即使用」与卡片行为一致（Requirement: 详情弹窗"立即使用"CTA）
- [ ] 10.6 回归：`/?q=` 工作流 / 其他深链 auto-send 不受影响（Requirement: 技能标签预填输入框 — 与 `?q=` 解耦）
- [ ] 10.7 回归：@mention、workflow token、message queue 发送行为正常（Requirement: skill token 与 workflow token 互斥 / Requirement: 消息队列保留 skill 上下文）
- [ ] 10.8 运行 `pnpm run typecheck` 与 `pnpm test`（相关用例）通过
- [ ] 10.9 本 change 不触及通信路径；**无需**运行 `pnpm run comms:replay` / `comms:compare`（除非实现中意外改动 send 通道）
