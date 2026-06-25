# Cursor 提示词套件 · sto-claw 样式改造

> 用法：每个代码块是一段**独立提示词**，按顺序粘进 Cursor 对话。
> 通用前提：① 已装 `.cursor/rules`（01-code-rules / 02-styles）② 已配 MasterGo MCP ③ 对应开发文档在 `docs/` 下。
> 工作模式铁律（所有提示词通用）：**先差异分析 → 我确认 → 再写码**；视觉值先用 MasterGo MCP 取；碰 🟥 红线先停下来问。

---

## P0 · 开场锚定（每个任务会话开始先发一次）

```
你在改 sto-claw 项目的样式。严格遵守以下工作模式，违反任意一条即失败：

1. 唯一施工依据 = 我指定的开发文档（@docs/...）+ @.cursor/rules/01-code-rules.mdc + @.cursor/rules/02-styles.mdc。三者冲突时以更严格者为准。
2. 只改样式与文档明确写出的结构项；不改接口/props 既有签名/hooks/store/事件 handler/收发/业务逻辑。新增可选 prop 可以。
3. 所有精确视觉值（色/字号/间距/圆角/阴影/icon/高度/动画）一律用 MasterGo MCP 读设计稿节点取，再映射到 02-styles 的 token；token 里没有的值不要发明，列出来等我确认。
4. 写法：只用 Tailwind + cn()；禁止 inline style、模板字符串拼 className、无注释裸 hex、其它样式方案；现有 dark: 原样保留不新增；品牌色统一 #FF6700 / text-primary，不用 #FF6F00。
5. 要"删"的元素改为命名布尔常量条件隐藏 + 注释（为什么/何时/怎么恢复/对应文档章节），不真删 JSX/常量/i18n。
6. 文档里标 🟥 的项、以及任何文档没写明的结构/逻辑改动，必须停下来问我，不许自行决定。
7. 流程分两阶段：先只输出"差异/实施分析"等我确认，再动代码；动代码时逐文件给 diff。

收到请回"已就绪"，然后等我贴具体任务。不要现在就改任何代码。
```

---

## P1 · 任务一 · 阶段1（差异分析，不写码）

```
任务：按《对话流改造-任务一：思考过程 + 云端思考 + 工作流卡》实施。

输入：
- 开发文档：@docs/对话流改造-任务1-思考过程与工作流.md（逐状态规格、术语口径、文件清单都在里面）
- 规则：@.cursor/rules/02-styles.mdc @.cursor/rules/01-code-rules.mdc
- 设计稿：MasterGo MCP（地址我已配；下面每个状态我会给/已给截图作证，精确值以 MCP 节点为准）

阶段1（现在只做这个，不写代码）：
A. 先读文档 §3 涉及文件，逐个打开 ThinkingProcessPanel.tsx / ChatMessage.tsx / AssistantTurnMessage.tsx / WorkflowCard.tsx，确认文档里写的现状（行号/构件/i18n key）和真实代码一致；不一致的列出来。
B. 按文档 §5 的 13 个状态（A1-A4 / B1-B5 / C1-C4），逐状态输出对照表，每行：
   | 状态 | 代码构件(文件+大致位置) | 文案口径(代码现值→统一用词) | 需从 MasterGo 取的值 | 风险/影响范围 |
C. 列出"文案口径"涉及的所有 i18n 改动（新增 understandingQuestion / awaitingReply、改折叠摘要/深度思考/调用工具），确认要 zh/en/ja 三语同步。
D. 标出 🟥 项（完成态反馈行 赞/踩/重新生成）和任何你发现的、文档没覆盖的结构/逻辑风险，等我决策。
E. 确认共享影响：ThinkingProcessPanel/ChatMessage/WorkflowCard 还被 Chat/index、HomeMainConversation、TaskSubitemChatSurface 用到，你的样式改动是否会波及它们。

输出以上分析后停下，等我确认再进阶段2。
```

---

## P2 · 任务一 · 阶段2（按确认实现）

```
阶段1已确认。进入阶段2，按《对话流改造-任务1》§9 施工顺序实现：

1. 先落 i18n 文案（zh/en/ja 三语）：折叠摘要"思考 N 次，使用 N 个工具"、思考块"深度思考"标签、工具行"调用工具 – {工具名}"、新增 understandingQuestion / awaitingReply。
2. A 组（普通对话思考过程 4 态）→ C 组（工作流卡三态）→ B 组（创建工作流：白卡/等待行/回填只读卡/产物卡）。
3. 每个状态的精确视觉值用 MasterGo MCP 取，映射 02-styles token；取不到或 token 无对应就停下来问。
4. 🟥 完成态反馈行：按我在阶段1给的结论做（只占位 / 接逻辑 / 不加）。
5. 逐文件给 diff；改到共享组件时，确认 Chat/index、HomeMainConversation、TaskSubitemChatSurface 三处视觉无回归。

每改完一个组（A/C/B）暂停给我看 diff + 截图，再继续下一组。
```

---

## P3 · 任务二 · 阶段1（差异分析，不写码）

```
任务：按《对话流改造-任务二：选项卡（固定浮层 + 三模式）》实施。

输入：
- 开发文档：@docs/对话流改造-任务2-选项卡.md
- 规则：@.cursor/rules/02-styles.mdc @.cursor/rules/01-code-rules.mdc
- 设计稿：MasterGo MCP

阶段1（只分析，不写代码）：
A. 打开 ParameterFormCard.tsx / OptionCardList.tsx / FormFieldRenderer.tsx，核对文档现状描述与真实代码；确认 ParameterFormCard 当前内联挂载在 ChatMessage.tsx 第 ~447 行。
B. 针对"固定浮层"（文档 4.1）：grep 出所有同时渲染 ChatMessage + ChatInput 的容器（Chat/index、HomeMainConversation、TaskSubitemChatSurface），给出每处的固定浮层挂载方案；明确你倾向 Portal 还是 store 只读 selector，并说明是否能做到"不改表单 state/store 写入逻辑"。若做不到 → 这是 🟥，停下来问我。
C. 针对三模式（文档 4.2）：列出徽章未选/选中、卡描边底色、步进器(在现有 number 字段上改)、区间字段、卡内填写 各自要从 MasterGo 取的值。
D. 确认 gate：FormFieldRenderer / OptionCardList 被 UserFormModal 等复用，样式改动如何用可选 prop/variant 隔离、保证默认形态不变。

输出分析 + 🟥 问题后停下，等我确认。
```

---

## P4 · 任务二 · 阶段2（按确认实现）

```
阶段1已确认。进入阶段2，按《对话流改造-任务2》§8 施工顺序实现：

1. 先做 4.2 三模式样式（徽章未选灰描边/选中实心橙、卡描边底色、− 数值 + 步进器、区间字段、卡内填写）——组件内样式，精确值用 MasterGo MCP 取。
2. 再做 4.1 固定浮层：先在 Chat/index 跑通（用阶段1确认的 Portal 或 store 只读 selector），把 ChatMessage 内联挂载改为条件隐藏 + 注释；动画滑入滑出、仅有待处理表单时出现且只一张、提交后收起留摘要。
3. 覆盖 HomeMainConversation / TaskSubitemChatSurface，确认浮层在三处都正常；UserFormModal 等复用处视觉无回归。
4. 不改 ChatInput 本体、不改表单字段类型/onChange/校验/提交/store 写入逻辑。碰红线先停。

逐文件给 diff，4.2 与 4.1 各做完暂停给我看 diff + 截图。
```

---

## P5 · 自检 / 验收（每个任务阶段2收尾发）

```
对刚才改的所有文件跑一遍自检，逐条 ✅/❌，❌ 直接修：

1. 按 @.cursor/rules/02-styles.mdc 末尾"AI 生成样式后必须自检"清单全跑一遍。
2. 专项检查：
   - 没改接口/props 既有签名/hooks/store/事件 handler/收发/业务逻辑（git diff 佐证）
   - 没出现 inline style / 模板字符串拼 className / 无注释裸 hex / 新增 dark: / #FF6F00
   - 状态色用语义 token（success/destructive/warning/primary），品牌色 #FF6700
   - 字号 6 档 / 圆角 13 档 / 阴影 4 档 / 间距阶梯，无发明值
   - 要"删"的都是命名 flag 条件隐藏 + 注释，没真删
   - 共享组件改动未波及其它调用方（逐一确认）
3. 跑 pnpm dev，按对应文档"手测"清单逐项验，附 1200×800 / 1440×900 截图与设计稿对比。
4. git diff src/ 输出摘要：改了哪些文件、各自改了什么类型（应只在 className / 文案 / 新增可选 prop / 新挂载容器）。
```

---

## P6 · 首页改造（HomeComposer，复用同模式）

```
任务：按《总部首页样式改造》实施。
输入：@docs/总部首页样式改造-开发文档.md + @.cursor/rules/02-styles.mdc + @.cursor/rules/01-code-rules.mdc + MasterGo MCP。
工作模式同 P0。先做阶段1：按文档 §5 六项改动逐项输出差异对照表（文件/行号/当前 className→新 className/对应 token/MasterGo 待取值/🟥 待确认项），确认共享组件 gate（ChatInput 被 4 处用、引擎模型选择器多处用），并把文档 §7 待确认清单里没定的抛给我。输出后停下，等我确认再进阶段2。
```

---

## 用法小结

- 新会话：先发 **P0** 锚定 → 再发对应任务的"阶段1" → 我 review → 发"阶段2" → 收尾发 **P5**。
- 任务一、任务二**分开会话**做，互不干扰；任务二建议在任务一合并后再开（见任务二文档 §8）。
- 每次 Cursor 想"顺手"扩大范围或跳过 MCP 直接猜值，回它一句："按 P0 第 3/6 条，停下来问"。
