# Tasks: `chat-composer-skill-picker`

## 1. SkillPicker 组件与样式

- [ ] 1.1 新建 `src/components/skill-plaza/SkillPicker.tsx`（或 `src/components/chat/SkillPicker.tsx`）：props `open` / `mode: 'inline' | 'toolbar'` / `query` / `onSelect` / `onClose`（Requirement: 星号触发已安装技能列表 / Requirement: 左下角工具 icon 打开技能浮层与搜索）
- [ ] 1.2 列表数据源：`useSkillPlazaStore.mySkills`；`open` 时 lazy `fetchMySkills()`（Requirement: 数据源为已安装技能）
- [ ] 1.3 列表 UI：标题「技能」、wrench 图标 + title + description truncate；`max-h` 限制 **5 行** + `overflow-y-auto`（Requirement: 技能列表最多可见五行并内部滚动）
- [ ] 1.4 toolbar 模式顶部搜索框：Search icon + placeholder「搜索技能」（Requirement: 左下角工具 icon 打开技能浮层与搜索）
- [ ] 1.5 实现 `highlightMatch(text, query)`：Brand-6 `#FF6F00` 高亮命中子串（Requirement: 技能名称与描述模糊匹配及橙色高亮）
- [ ] 1.6 在 `src/lib/surfaces.ts` 补充 picker 容器 / 行 hover token（对齐 `docs/sto-design.md` Grey 阶梯与 WorkflowPicker glass 风格）（Requirement: 技能浮层视觉与无障碍）
- [ ] 1.7 i18n：`chat.json` / `skills.json` 增加 loading、空态、搜索 placeholder、aria-label（Requirement: 技能浮层视觉与无障碍）

## 2. Composer — 星号触发与 inline query

- [ ] 2.1 `ChatInput` `onKeyDown`：检测 `*`（非 composition）打开 `SkillPicker` mode=`inline`（Requirement: 星号触发已安装技能列表）
- [ ] 2.2 确认 `/` 仍仅打开 WorkflowPicker，不与 `*` 冲突（Requirement: 工作流斜杠行为不变）
- [ ] 2.3 在 `dingtalk-mention-composer.ts` 实现 `extractSkillInlineQuery(root)` / `consumeSkillTriggerText(root)`：解析并移除 `*` + filter 文本（Requirement: 星号内联 query 不进入用户正文）
- [ ] 2.4 inline 模式：editor 输入变化时更新 picker `query`，实时 filter + 高亮（Requirement: 星号触发后继续输入筛选）
- [ ] 2.5 选中技能：`consumeSkillTriggerText` → `insertSkillSpan` → 关闭 picker（Requirement: 选中技能插入 composer skill token）

## 3. ChatInput — 工具 icon 入口

- [ ] 3.1 左下角工具栏新增 wrench Button（与 `+`、`@`、Workflow icon 并列）（Requirement: 左下角工具 icon 打开技能浮层与搜索）
- [ ] 3.2 点击 toggle `SkillPicker` mode=`toolbar`；浮层内搜索框控制 `query`（Requirement: 工具 icon 搜索过滤）
- [ ] 3.3 点击外部 / Esc 关闭 picker（参照 WorkflowPicker）（Requirement: 左下角工具 icon 打开技能浮层与搜索）
- [ ] 3.4 已有 skill token 时 icon / `*` 行为与 design 一致（Requirement: 已有 skill token 时不重复触发）

## 4. 互斥与 Home 复用

- [ ] 4.1 选中前清除 workflow token；插入 skill 时清除 workflowId（Requirement: 与 workflow token 互斥）
- [ ] 4.2 确认 `HomeComposer` 使用的 `ChatInput` 自动获得 picker（或透传相同 props）（Requirement: 选中技能插入 composer skill token）
- [ ] 4.3 发送链路不变：选中后不 auto-send；仍走既有 `skillMeta` / `dispatchChatSend`（Requirement: 选中技能插入 composer skill token）

## 5. 单元测试

- [ ] 5.1 新增 `tests/unit/skill-picker-filter.test.ts`：filter title+description、高亮片段、空 query 全量（Requirement: 技能名称与描述模糊匹配及橙色高亮）
- [ ] 5.2 新增 `tests/unit/dingtalk-mention-composer-skill-trigger.test.ts`：`extractSkillInlineQuery` / `consumeSkillTriggerText`（Requirement: 星号内联 query 不进入用户正文）
- [ ] 5.3 扩展 `tests/unit/dingtalk-mention-composer-skill.test.ts`：picker 选择后 `snapshot.skill` 正确且 plainText 无 `*` 残留（Requirement: 从 composer 技能浮层选择技能）

## 6. 手工验证与回归

- [ ] 6.1 输入 `*` → 浮层打开 → 继续输入「异常」→ 列表过滤且橙色高亮（Requirement: 星号触发后继续输入筛选）
- [ ] 6.2 点击 wrench icon → 搜索「异常」→ 同样过滤与高亮（Requirement: 工具 icon 搜索高亮）
- [ ] 6.3 已安装技能 >5 → 浮层内滚动（Requirement: 技能列表最多可见五行并内部滚动）
- [ ] 6.4 选中技能 → 输入框出现 skill tag → 手动发送 → 气泡 tag + 用户文本（Requirement: 选中技能插入 composer skill token）
- [ ] 6.5 `/` 仍打开工作流列表；skill / workflow token 互斥（Requirement: 工作流斜杠行为不变 / Requirement: 与 workflow token 互斥）
- [ ] 6.6 技能广场「使用」`?skill=` 深链仍正常（回归 `skill-plaza-use-composer-tag`）
- [ ] 6.7 实现完成后审查 `README.md` / `README.zh-CN.md` / `README.ja-JP.md`（openspec tasks 规则）
