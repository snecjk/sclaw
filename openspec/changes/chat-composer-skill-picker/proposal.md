## Why

技能广场「使用」已支持将技能 Tag 预填到输入框（`skill-plaza-use-composer-tag`），但用户在**对话进行中**仍缺少快捷入口：无法像工作流 `/` 一样在输入框内直接挑选已安装技能。产品稿要求补齐 composer 内技能入口，降低「离开对话 → 去技能广场 → 再回来」的路径成本。

工作流已占用 `/` 符号；技能入口 MUST 使用 `*` 作为触发符，并与左下角工具 icon 形成双入口。

## What Changes

- **`*` 触发技能列表**：在 `ChatInput` / `DingTalkMentionEditor` 输入 `/` 同级位置，检测 `*` 打开已安装技能浮层；列表最多可见 **5 行**，超出在浮层内部滚动
- **左下角工具 icon**：在现有 `+` / `@` 旁新增 wrench（工具）按钮；点击打开同一套技能浮层，顶部带**搜索框**（placeholder「搜索技能」），列表同样最多 5 行可见 + 内部滚动
- **输入框内联筛选**：在 `*` 触发模式下，用户继续输入关键词（如 `*异常`）时，浮层实时按**技能名称 + 描述**模糊匹配；匹配片段 MUST 以 **Brand-6 `#FF6F00`** 橙色高亮（对齐 `docs/sto-design.md`）
- **选中行为**：选择技能后 MUST 调用既有 `insertSkillSpan(slug, title)`，替换/插入 composer skill token，并关闭浮层；MUST NOT 自动发送
- **数据源**：列表 MUST 仅展示**已安装技能**（`useSkillPlazaStore.mySkills` 或等效 API），与「已安装技能列表」语义一致
- **互斥**：与 workflow token、`/` WorkflowPicker 互斥规则保持不变（沿用 `skills-plaza-use-composer` 既有决策）

## Capabilities

### New Capabilities

- `skills-composer-picker`: 对话输入框内技能入口（`*` 触发、工具 icon、搜索、5 行滚动、匹配高亮、选中插入 skill token）

### Modified Capabilities

- `skills-plaza-use-composer`: 扩展「同一时刻最多一个 skill token」场景——支持 composer 内 Picker 选择（不仅限技能广场 `?skill=` 深链）；移除/修订 design 中「不实现输入框内手动选择技能」Non-Goal

## Impact

- **Renderer**
  - `src/pages/Chat/ChatInput.tsx`（`*` keydown、工具 icon、浮层挂载）
  - `src/pages/Home/HomeComposer.tsx`（若独立封装，同步 props）
  - `src/components/dingtalk/DingTalkMentionEditor.tsx`（`*` 触发时 editor 行为、inline query 提取）
  - `src/lib/dingtalk-mention-composer.ts`（可选：`*` query 解析 helper）
  - **新建** `src/components/skill-plaza/SkillPicker.tsx`（或 `src/components/chat/SkillPicker.tsx`）
  - `src/lib/surfaces.ts`（picker 容器 / 高亮 token，对齐 Brand-1 / Brand-6 / Grey 阶梯）
  - `src/i18n/locales/*/chat.json`、`skills.json`（搜索 placeholder、空态、无障碍文案）
  - `src/stores/skill-plaza.ts`（picker 打开时 ensure `mySkills` 已加载）
- **Main Process**
  - 无 Gateway 协议变更；选中后仍走既有 `skillMeta` 发送链路
- **视觉**
  - 浮层样式对齐产品稿与 `docs/sto-design.md`（Brand-6 匹配高亮、Grey 描述文案）
- **文档**
  - 实现完成后审查 `README.md` / `README.zh-CN.md` / `README.ja-JP.md` 是否需补充「输入框内选技能」说明

## Out of Scope

- 在 Picker 内安装 / 卸载技能（仍去技能广场）
- 展示未安装的技能或全量 plaza 列表
- 修改 `/` WorkflowPicker 行为或工作流触发词
- 修改 Gateway RPC / transcript marker 协议（沿用 `skill-plaza-use-composer-tag` 已落地链路）
- Chat 页独立路由深链 `?skill=`（仍由 Home / 技能广场承担；本 change 仅 composer 内选择）
- 键盘方向键 / Enter 选中（本期可 follow WorkflowPicker；若未实现则列为 follow-up）
