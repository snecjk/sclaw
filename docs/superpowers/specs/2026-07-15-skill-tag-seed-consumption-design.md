# 技能 Tag 一次性 Seed 修复设计

## 问题

技能广场通过 `/?skill=<slug>` 向首页输入框注入技能 Tag。`Home` 当前把该参数固化为整个页面生命周期内持续存在的 state；用户删除 Tag 后，点击「新对话」会切换并重新挂载输入框，新实例再次消费旧 seed，导致 Tag 恢复。

## 目标

- 技能广场进入首页时仍只注入一次技能 Tag。
- 清理 URL 后，当前输入框中的 Tag 保持可见，直到用户主动删除或发送。
- 用户删除 Tag 后切换「新对话」，Tag 不再出现。
- 不改变技能发送、消息展示、`?q=` 与 `?workflowId=` 行为。

## 方案

采用最小的一次性 seed 语义：

1. `Home` 不再使用无 setter 的 state 永久保存 `seedSkillSlug`，而是直接从当前 URL 参数派生。
2. 首次渲染把 slug 传给编辑器后，现有 URL 清理 effect 删除 `skill` 参数。
3. 另存首次进入页面时的 slug，仅供既有 `?q=` 自动发送判断使用，避免一次性 editor seed 的消费改变旧深链行为。
4. `DingTalkMentionEditor` 在 seed prop 变为 `undefined` 时保留已经插入的 Tag，与现有 `seedText` 行为一致；并按 slug 记录已应用 seed，使同一实例收到不同 slug 时能够替换 Tag。

不增加跨多层组件的消费回调，也不把输入框草稿写入 chat store。

## 测试

- 编辑器先收到技能 seed，再 rerender 为 `undefined`，当前 Tag 仍存在。
- 删除 Tag 并卸载该编辑器后，以 `undefined` 挂载新实例，新实例不包含技能 Tag。
- 同一编辑器依次收到两个不同 slug 时，使用后一个技能 Tag。
- 技能 seed 消费后，同一 Home 实例中的既有 `?q=` 行为保持不变。
- 保留现有技能 token 序列化、删除和发送测试。

## 文档影响

该修复只纠正既有一次性 seed 生命周期，不改变用户流程或公开接口；无需修改 README 多语言文档。
