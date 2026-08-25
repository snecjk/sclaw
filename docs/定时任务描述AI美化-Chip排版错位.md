# 定时任务描述 AI 美化 — Chip 排版错位

> 仓库：`sto-claw`  
> 分支基线：`feat/refactor-scheduled-tasks` @ `d2a02184`（此前已合入「任务描述 AI 美化 + 文末 @ + 回车 br」）  
> 日期：2026-08-19  
> 状态：**分析与改造方案（本文不实施代码）**  
> 范围：**仅定时任务创建/编辑弹窗「任务内容」**；不改普通会话 `ChatInput` 发送/换行  
> 关联：
> - [`Composer内联混排-Segment模型与多SkillWorkflow透传.md`](./Composer内联混排-Segment模型与多SkillWorkflow透传.md)
> - [`src/pages/MyTask/components/TaskInstructionComposer.tsx`](../src/pages/MyTask/components/TaskInstructionComposer.tsx)
> - [`src/components/ai-beautify/AiBeautifyButton.tsx`](../src/components/ai-beautify/AiBeautifyButton.tsx)
> - [`electron/scheduled-tasks/scheduled-task-instruction-beautifier.ts`](../electron/scheduled-tasks/scheduled-task-instruction-beautifier.ts)
> - [`shared/scheduled-task-composer-segments.ts`](../shared/scheduled-task-composer-segments.ts)
> - [`src/lib/composer-gateway-text.ts`](../src/lib/composer-gateway-text.ts)

---

## 1. 现象

用户在任务内容里**原地输入**（文件 / 技能 / 工作流 / `@` 与正文混排）后点 **AI 美化**，编辑器被整段重写，chip 错位、堆到段首或段尾，部分工作流名变成黑字。

对照样例（简化）：

| | 结构 |
|---|---|
| **美化前（原地输入）** | `根据 [文件] 和 [文件] 使用 [技能] 生产一份 html 发送给 @申通` → 空行 → `然后 [工作流:合同审核 11:14] 发送给 @侯正亚` |
| **美化后** | `[技能]` 被拽到句首；「合同审核」变成**纯文本**；工作流 chip 与两个文件 chip **堆在段尾**；`@` 仍能留在句中 |

这与「回车后第二行工作流掉行」（Chrome `DIV`/`<br>`）不是同一类问题。后者已用任务描述 Enter→`<br>` 处理；本文只谈 **美化回写把 segment 顺序弄乱**。

---

## 2. 结论（先读）

乱排的根因不是 chip CSS，而是这条链路：

```
segments（真源，有序混排）
  → 只把 snapshot.plainText 发给模型
  → 模型吐「残缺纯文本」
  → reconstructComposerSegmentsFromPrompt 按少数标记猜位置
  → 猜不到的 chip 前置或追加
  → setSegments 整框重绘
```

**只改提示词不够**（文件根本没按文件名织回去）。**只改回写不够**（模型仍会缩写名称、把工作流/技能挪到开头）。必须 **提示词约束占位 + 代码按占位/槽位回写** 一起做。

推荐落地策略：**槽位保序（只润色 text 段）为主；带占位全文为辅（给模型看上下文）**。见 §6。

---

## 3. 当前链路（代码事实）

### 3.1 入口

`TaskCreateModal` 把 `AiBeautifyButton` 的 `value` 绑成表单 `instructions`（即 composer **plainText**），`resolveWorkflow` 只取 `workflows[0]`：

```ts
value={instructions}
resolveWorkflow={() => {
  const wf = composerSnapshotRef.current?.workflows[0];
  return { workflowId: wf?.id, workflowName: wf?.name };
}}
onBeautified={(next) => instructionComposerRef.current.applyBeautifiedText(next)}
```

模型请求体：`{ instruction: trimmedPlainText, type: 'task', workflowId?, workflowName? }`。  
**没有**把 `segments` / 文件名 / 技能标题列表发给模型。

### 3.2 序列化：plainText 不是「看见的排版」

`serializeMentionEditor`（`dingtalk-mention-composer.ts`）：

| segment | 是否写入 `plainText` |
|---------|----------------------|
| text | 是 |
| mention | 是（`@显示名`） |
| workflow | 是（仅展示名，如 `合同审核 11:14`） |
| skill | **否** |
| file | **否** |

因此模型看到的原文接近：

```
根据 和 使用 生产一份 html 发送给@申通sclaw123

然后合同审核 11:14发送给@侯正亚
```

「客户流向…」「HTML页面」「姚磊html网页设计」在字符串里是**空洞**。模型只能瞎补「根据 和 使用」。

Chat 发给 Gateway 的 `gatewayText` 已经会在原位写入 `[文件:]` / `[技能:]` / 工作流执行句（`composer-gateway-text.ts`，阶段 6）。**任务美化没有复用这套 bake**，仍喂残缺 plainText。

### 3.3 回写：`applyBeautifiedTextToSegments`

1. 抽出原 chip，把美化纯文本丢进 `reconstructComposerSegmentsFromPrompt`。
2. reconstruct **只认**：
   - `[文件: 标签]`
   - `[技能: 标签]`
   - `执行 id 为：wf_xxx 的工作流 【名称】` / `执行工作流 wf_xxx（名称）`
   - `@已知显示名`
3. 文件：`attachments: []` 传入 reconstruct，随后 **无条件 `files.forEach(push)` 到数组末尾** → 截图底部两个文件 chip。
4. 技能：prompt 对不上时，`weaveStructuredRefsIntoPrompt` 会把剩余技能 **前置** `[技能:]\n\n正文` → 橙色技能跑到第一句。
5. 工作流：`relocateWorkflowsIfNameAppearsInText` **精确包含**全名 `合同审核 11:14`。模型写成 `合同审核` 则对不上 → 黑字留在正文，真 chip 作为 leftover 堆段尾。
6. mention：`@显示名` 能匹配，所以两个 `@` 相对正常。

### 3.4 提示词（`scheduled-task-instruction-beautifier.ts`）

`TASK_SYSTEM_PROMPT` 要点：

- 「只输出优化后的**纯文本**，不要 markdown」
- 「若上下文提供了关联工作流，**可在开头保留或补全工作流引用**」← 直接鼓励把工作流/引用挪到句首
- 用户侧再拼一行 `关联工作流：id=…，名称=…`（且只有第一条）

模型没有「禁止移动 chip / 禁止缩写展示名 / 必须原样保留占位符」的约束。

---

## 4. 提示词侧改法

目标：模型**不许重排结构**，只润色 chip 之间的自然语言。

### 4.1 输入改为带稳定占位的全文

不要喂空洞 plainText。按 segments 原位 bake（与 Chat `gatewayText` 对齐，任务侧可略简）：

```
根据 [文件: 客户流向_….xlsx] 和 [文件: HTML页面] 使用 [技能: 姚磊html网页设计] 生产一份 html 发送给 @申通sclaw123

然后 [工作流: 合同审核 11:14] 发送给 @侯正亚
```

工作流不要只靠「关联工作流放开头」；占位必须出现在「然后」后面。

建议占位规范（回写同一套正则）：

| 类型 | 占位 | 备注 |
|------|------|------|
| 文件 | `[文件: {fileName}]` | `]` 转义为 `］`，复用 `escapeGatewayPlaceholderLabel` |
| 技能 | `[技能: {title}]` | 与 reconstruct 已有规则一致 |
| 工作流 | `[工作流: {name}]` 或保留执行句 | 新标记更短、更不易被模型改写成「执行某工作流」；若用执行句必须保留 **id + 全名** |
| 钉钉 | `@{displayName}` | 已有 |

### 4.2 System 约束（替换/删改现有条款）

应明确：

1. **占位符原样保留**：方括号标签、`@名`、工作流全名一个字符都不能改、不能删、不能换序。
2. **只改占位符之外的中文/英文叙述**（语气、标点、去口语）。
3. **禁止**把工作流/技能/文件挪到段首或段尾；删除「可在开头补全工作流引用」。
4. **禁止**缩写 chip 文案（`合同审核 11:14` → `合同审核`）。
5. **禁止**输出 markdown / 解释；输出必须仍是「带占位的一整段」，便于 tokenize。
6. 多工作流/多文件全部出现在输入里，不要只信 `workflows[0]`。

### 4.3 提示词单独改的上限

即使模型 100% 遵守占位，**现有回写仍会把文件 `push` 到末尾**（reconstruct 的 file 被 `if (seg.type === 'file') continue` 丢掉）。所以提示词改完必须同步改 `applyBeautifiedTextToSegments`，否则文件堆尾问题还在。

---

## 5. 代码侧改法

按稳健程度从高到低。

### 方案 A — 槽位保序（推荐主方案）

**芯片位置以美化前 `segments` 为准，模型只改 `type === 'text'` 的拼接。**

1. 将 text 段编号后交给模型，例如：
   ```
   <<T0>>根据 <<C:file>> 和 <<C:file>> 使用 <<C:skill>> 生产一份 html 发送给
   <<T1>>然后 <<C:workflow>> 发送给
   ```
   或更简单：只发送 `[T0]根据 [T1]和 [T2]使用 …`，chip 用不透明 token `⟦0⟧⟦1⟧…`。
2. 校验：返回中 token 集合、顺序必须与发出时一致；失败则丢弃模型结果、toast 失败、不 `setSegments`。
3. 用返回文本填回各 text 槽，chip 段原样写回。

优点：结构不可能被模型打乱。  
缺点：模型看见的是 token 而不是「根据 文件 和 文件」，润色质量略受影响；应用 **B 的带占位全文** 给模型看可读句子，校验仍按槽位/占位顺序。

### 方案 B — 带占位全文 + 同一套 tokenize（与 Chat bake 对齐）

1. 美化请求改传 `buildComposerGatewayPayload` 同类字符串（或 Task 专用 `buildBeautifySourceFromSegments`），**不要**只用 `instructions` plainText。
2. `applyBeautifiedTextToSegments`：
   - **删除**「reconstruct 的 file 丢弃后再把原 files 全部 append」；
   - 按 `[文件:]` / `[技能:]` / `[工作流:]` / `@` **原位**还原 chip（文件要用 `attachmentsById` / 原 file 段对齐，不要 `attachments: []`）；
   - 工作流/技能匹配改为 **全名优先，其次包含/去时间后缀**（`合同审核` 能对上 `合同审核 11:14`），匹配成功后 **删掉正文里的重复名称**，避免「黑字 + chip」双份；
   - leftover 未匹配才允许追加，并 toast「部分标签未能对回原文位置」。
3. `resolveWorkflow` 改为传 **全部** workflows（或干脆只信 bake 字符串，不再单独传一条）。

优点：模型能读通顺的中文。  
缺点：仍依赖模型不打乱占位；必须加「占位多重集合校验」，失败则回退。

### 方案 C — 不推荐

继续在现有 `plainText` + leftover dump 上打补丁（stickChips、按名字模糊搜）。无法修复「文件从未出现在模型输入里」。

---

## 6. 建议实施顺序（仍不在本文改代码）

| 阶段 | 做什么 | 验收 |
|------|--------|------|
| **0** | 保持现状：不点美化时的原地混排、文末 `@`、Enter 后 chip 同行 | 回归不回退 |
| **1 提示词** | 换 system；user 改为占位全文；去掉「工作流放开头」 | 抽样看模型是否还缩写/挪位置 |
| **2 请求体** | `AiBeautifyButton` / Modal 传 bake 后的 instruction（或新增 `markedInstruction` 字段），文件/技能/全部工作流进字符串 | 抓包不再出现「根据 和 使用」空洞 |
| **3 回写** | 重写 `applyBeautifiedTextToSegments`：原位 tokenize + 模糊名 + **禁止无条件文件堆尾**；占位顺序校验失败则不落盘 | 美化后顺序与美化前一致，仅叙述变化 |
| **4 单测** | 用本文 §1 样例：file×2 + skill + mention + newline + workflow + mention | 见 §8 |

会话 `ChatInput`、`submitMode: 'send'`、Gateway 发送契约不在本改造范围。

---

## 7. 非目标 / 不要混进本次

- 不在本文重做「回车第二行 chip 掉行」（已用任务描述 `insertLineBreak` + trailing BR 前插入处理）。
- 不改普通会话美化（快捷输入 `type: 'prompt'` 可另文；不要误改 Chat Enter 发送）。
- 不把美化结果泄漏进聊天气泡 `displayText`。
- 不扩大到 NL 创建任务 / 云端同步字段。

---

## 8. 验收用例（实施时）

用与用户截图同构的 segments 点美化：

1. 文件 chip 仍夹在「根据 … 和 …」之间，不得出现在段尾一排。
2. 技能 chip 仍在「使用」之后，不得跑到全文最前。
3. 「然后」后是工作流 **chip**（不是黑字「合同审核」），全名仍为 `合同审核 11:14`。
4. 两个 `@` 仍在「发送给」之后。
5. 段落空行可被模型收成一段，但 **chip 相对顺序不变**。
6. 模型失败或占位校验失败：编辑器内容与点击前一致，并有 toast。

单测应覆盖 `applyBeautifiedTextToSegments`（或后继函数）对上述结构的往返，不依赖真实 LLM。

---

## 9. 风险

- 模型仍可能改写占位：必须有 **硬校验 + 回退**，不能「尽量 weave」。
- 模糊匹配过宽（短名「合同」）会误伤正文：优先全名，其次「名称去掉末尾时间」这类规则，禁止过短前缀。
- bake 字符串变长，注意现有 `BEAUTIFY_INPUT_MAX_CHARS = 4000` 截断是否切到占位中间。

---

## 10. 修订记录

1. **2026-08-19**：根据「原地输入正常、美化后文件/技能/工作流错位」现象整理根因（plainText 空洞 + 提示词鼓励段首引用 + reconstruct leftover 堆两端），给出提示词与代码双侧方案；推荐槽位保序 + 占位全文，本文不实施代码。
