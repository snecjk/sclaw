# Kimi 浏览器自动化全景实现 vs SClaw 逐层差距定位

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-04 |
| 问题 | "浏览器执行一直在反复调用工具又没成功，页面的分析能力也不行。判断不了是哪里的问题——代码可能有错误实现，md 可能有错误约束" |
| 结论一句话 | **每一层都有问题，但权重不同：感知产物不可用（代码）和失败伪装成功（协议）是主因；提示词（md）的错误约束是次因但最好修；模型本身排最后** |
| 关联 | [agent-loop-根因分析.md](./agent-loop-根因分析.md)、[agent-实现-code-review.md](./agent-实现-code-review.md)、[browser-automation-parity-plan.md](./browser-automation-parity-plan.md) |

---

## 一、现场解读：这张深度思考轨迹暴露了 5 个病理

轨迹：任务"实测妙悟建站并对比 SClaw"，模型思考链——

1. **"Agent 调用被中断了"** → 流中断后没有任何恢复上下文注入，模型靠脑补重建任务状态（它甚至自己总结了 SClaw 的情况代替实测）；
2. **"用户又发空消息 / 用户连续发空消息，我需要立刻继续"** → 空 user turn 不断施压，模型明确表现出"被催促"，于是开始**抄近路**："snapshot 太大，直接尝试 fill"——不看页面就操作；
3. **"snapshot 太大了，我用 read_page 拿到核心内容"** → 感知产物没有体积预算，模型被迫弃读。**这是"页面分析能力不行"的直接证据**：不是模型分析不了，是喂给它的原料它吃不下；
4. **跨中断/会话漂移使用过期 @e30 ref** → fill/click 很可能打在不存在的元素上；
5. **"bridge_click 按 name 试试常见发送按钮名，如果不行就 bash 看 snapshot""用 awk 看 @e28~@e35 区域"** → 工具失败后模型开始**猜测式操作**——它不知道工具失败了（协议层把失败伪装成成功），也不知道该信什么。

**本质：模型在"原料吃不下 + 失败看不见 + 身份会漂移 + 一直被催促"的环境里挣扎。这不是模型笨。**

---

## 二、Kimi 是如何实现的（全景，标注验证等级）

### 2.1 Agent 侧（k3 + daimon 运行时）—— ✅ 已验证（app.asar/daimon-bundle 逆向）

- **工具延迟加载（deferred disclosure）**：浏览器工具注册为 `source:'daimon-core'、disclosure:'deferred'`，配套 k3 的 `dynamically_loaded_tools` 能力。模型初始只看到工具名+一句话描述（"Load the in-app-browser skill for supported actions and parameters"），**需要时才把完整 skill 拉进上下文**。系统提示侧 token 极小；
- **schema 极简、语义在 skill**：工具输入只有 `{action, params}`，25 个 action 的参数、工作流、纪律全部写在一份 SKILL.md 里。模型"先读文档再用工具"，而不是面对 50 个自带冗长中文描述的工具；
- **两条浏览器面分工**：InAppBrowser（内嵌隔离环境，无登录态）/ webbridge（真实 Chrome，带登录态），skill 文档明说路由规则，**一个决策点，没有第二套工具**。

### 2.2 Tools 侧 —— ✅ 已验证（守护进程二进制 + 扩展源码 + app.asar 逆向）

**感知（准与快的主要来源）**：
- CDP `Accessibility.getFullAXTree`，只对 17 种交互 role 发 `@eN` ref，存 `backendDOMNodeId`，`DOM.resolveNode` 还原——抗 React 重渲染、抗 class hash；
- **60k 字符预算 + 三轮降级**：子树折叠标 `collapsed:true` 留 ref 供下钻 → 尾部弹出 → 字段长度减半；`interactive:true` 只留交互路径；
- **`find` 树内检索**：结果带祖先路径 + `interactiveAncestorRef`（直接给可点击祖先）；
- **documentGeneration 代际校验**：导航/crash 后旧 ref 明确报"page changed, run snapshot and retry"，绝不静默点错；
- 快照超 64KB **写临时文件**返回 `{path, bytes, sha256, preview}`。

**动作（闭环与降级）**：
- click 三级：DOM `el.click()`（首选，快、不要求可见）→ `mouse_click` 坐标真事件（`elementFromPoint` 遮挡检测 + 投递探针验证事件到达）→ 结构化报错；
- fill：原型 value setter（绕 React 受控组件）/ contenteditable 走 Selection+`execCommand('insertText')`（打通 ProseMirror/Lexical）/ 自定义组件明确报错"改用 key_type"；
- **动作后自动附快照**：交互动作带 `snapshot:true`，300ms settle 后自动附增量快照——**一次调用完成"动作+观察"**，模型无需判断是否再看一眼。

**可靠件**：JS dialog 跟踪+熔断（弹窗期间其他 action 快速失败 `IN_APP_BROWSER_DIALOG_OPEN`）；真实输入的可见性守卫（`IN_APP_BROWSER_TAB_NOT_VISIBLE` 并建议降级 DOM click）；同会话 action 串行化；CDP 命令 15s/300s 超时；managed 窗口 `will-prevent-unload`。

**产物**：截图/PDF/大快照全部落盘，返回 `path+sha256`——**base64 零进模型上下文**。

**会话**：session→tab group（用户看得见 agent 在干嘛）；borrowed（用户正在看的 tab，借用不关）/owned（自己开的，close_session 只关这些）；close_session 只在用户明确要求时调用。

**失败语义（最关键的差异）**：每个失败都是结构化错误码 + **下一步建议**——fill 遇自定义组件→"use key_type"；ref 过期→"run snapshot and retry"；tab 不可见→"use click or ask user to open panel"。**模型永远知道失败后该干嘛，永远不需要编理由。**

### 2.3 Kimi harness 内部（loop 检测/续跑注入等）—— ⚠️ 未逆向验证

我们是从 SClaw 的反向差距推断这些成熟做法的存在（传输层重试、重复调用检测、上下文摘要化），Kimi 桌面端的 agent loop 实现未做逆向。本文 §三 对照表中涉及 harness 内部行为的条目以此声明为准。

---

## 三、SClaw vs Kimi 逐层对照：问题到底在哪一层

| 层 | Kimi（已验证） | SClaw 现状（已验证） | 对应症状 |
|---|---|---|---|
| **工具注册** | deferred 加载 + skill 文档，系统侧极瘦 | ~50 个工具全量中文 schema + claude_code preset(~10k token) + 10 段 append | 指令噪声，模型抓不住重点 |
| **感知产物** | AX 树 + 60k 预算 + 下钻 + find | ba_observe 是 DOM 遍历 120 元素硬上限（**AX 已实装但 feature flag production 默认 `dom`**，见 feature-flag.ts）；bridge 侧 readPage 是同步 `body.innerText` **截 8000 字符**，且 `truncated` 判定 >20000 与 slice(0,8000) 不自洽（zip:page-agent.js L279-288） | **"页面分析能力不行"的直接物证** |
| **感知投递** | 超 64KB 落盘回 path+preview | snapshot 内联全量返回（"snapshot 太大了"） | 模型弃读 → 盲操作 |
| **失败协议** | `isError:true` + 错误码 + 下一步建议 | OpenClaw 信封把 `{success:false}` 包成 **`success:true`**（define-sto-tool.ts L48-54）；错误无降级建议 | **"反复调用又没成功"**——模型不知道失败了 |
| **ref 稳定性** | documentGeneration 代际校验（ba_* 已有，**bridge_* 没有**） | bridge ref 无代际，跨导航/中断用旧 ref | "不能准确执行" |
| **动作闭环** | snapshot:true 一次调用完成动作+观察 | bridge_* 动作后无快照，每步多一回合 | 回合数膨胀 |
| **会话身份** | 重建不换身份 | 重建即换 UUID + 旧会话被顶掉 + 不通知模型 + 提示词禁止自查 | 死循环（前次已定论） |
| **续跑** | 传输层重试（推断） | 新 query + 空 user turn + 零中断注入 | "Agent 调用被中断了"后挣扎 |
| **空消息** | 无 | 空 user turn 可直达模型，模型感到被催促而抄近路 | "用户连续发空消息，我需要立刻继续" |
| **提示词** | 一份 skill 文档，单一事实源 | 三处路由规则互相矛盾 + 重复行 + "先 list_sessions" 与 "禁止再 list_sessions" 并存 + embed 块广告未注册工具 | 工具选择混乱 |
| **上下文管理** | 产物落盘（已验证）+ 摘要化（推断） | transcript 全量重放无压缩；embed 每条用户消息再注 2.5-4k 页面块 | 8 回合后 100k+ 字符全量重发 |

---

## 四、定位方法论：以后怎么判断是哪里的问题

按这个顺序查，每层都有确定的检查点，10 分钟内能定位：

**L0 · 工具本身对不对（代码层）**——绕过模型直接调：
```bash
# bridge 会话列举与命令直达
curl -s http://127.0.0.1:3210/api/browser-bridge/sessions | jq .
curl -s -X POST http://127.0.0.1:3210/api/browser-bridge/command \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<id>","action":"snapshot","payload":{}}' | jq .
# 拿失败原文（模型转述的唯一对账本）
curl -s "http://127.0.0.1:3210/api/browser-bridge/result?commandId=<id>" | jq .result.result.error
```
工具直接调用就对 → 问题在上层；直接调用就错 → 工具/扩展实现问题。

**L1 · 模型看到的和工具返回的是否一致（协议层）**：看 transcript 里工具结果 `success`/`isError` 字段与 L0 的原始返回是否一致——`success:true` 但内容里有 `error` → 协议伪装问题（模型一切"编理由"行为的根源）。

**L2 · 模型输入质量（装配/提示词层）**：数一下系统提示总量（字符）、工具数量、矛盾规则（grep prompts 里的"先/禁止"）；看 embed 注入块是否与已注册工具一致。

**L3 · 节奏异常（harness 层）**：数 transcript 里"中断/继续/空 user turn"次数；resume 后模型是否丢失任务上下文（表现为"重新检查状态"）；sessionId 是否中途变化（会话漂移）。

**L4 · 才是模型**：同一任务把 L0-L3 的问题都修掉或绕过（例如手动提供正确 ref），模型仍然选错工具/语法错误 → 才是模型适配问题。

**对照实验（终极手段）**：同一任务在 Kimi 里跑一遍记录完整轨迹（每步调了什么工具、返回了什么），与 SClaw 轨迹逐步 diff——轨迹第一次分叉的位置就是问题层。

---

## 五、针对你截图症状的根因排序与修复地图

| 排名 | 根因 | 层 | 对应症状 | 修法 | 量 |
|---|---|---|---|---|---|
| 1 | bridge readPage=innerText 截 8000 字符 + snapshot 无预算无落盘 | 感知（代码） | 页面分析能力不行 | 扩展侧感知层重建（AX/预算/下钻/artifact），或短期：snapshot 超阈值落盘回 path | 扩展仓，中 |
| 2 | `{success:false}` 包成 `success:true` | 协议（代码） | 反复调用又没成功 | define-sto-tool envelope 与 data.success 联动 + isError:true + 降级建议 | 仓内，小 |
| 3 | bridge ref 无代际 + 会话重建换 ID 不通知 | 协议（代码） | 不能准确执行 | 404 带 currentSessionId 自动重试；ref 代际校验 | 仓内，小 |
| 4 | 空 user turn + 中断零注入 | harness | 模型被催促抄近路 | L1 续跑方案（见 agent-loop-根因分析 §三.3） | 仓内，中 |
| 5 | 提示词矛盾/强制 list_sessions/广告未注册工具 | md | 工具选择混乱 | prompts 单源化 + 矛盾规则合并 + embed 块按实际注册生成 | 仓内，小 |
| 6 | 50 工具全量 schema + preset 10k | 装配 | 指令噪声 | 工具面按任务动态裁剪（中期：迁移 deferred loading） | 仓内，中 |
| 7 | feature flag production 默认 `dom` | 配置 | 已实装的 AX 没生效 | 灰度打开 `ax`（先做 §六 的实机 PoC） | 配置，小 |

**代码 vs md 的锅**：都有，但代码层（1/2/3/4）是主因——md 的错误约束（5）是次因，不过它最便宜，可以先修。

---

## 六、必须先做的一个验证（卡在所有修复之前）

`Accessibility.getFullAXTree` 在 Electron 40 embed webview 上的实机 PoC 至今未做（parity-plan §十.2，全计划最大技术不确定点）。AX 模式已实装且有 DOM 自动回退，但"flag 开到 ax 后真实页面表现如何"没有实测数据。**建议下一步：启动应用，对一个复杂页面分别跑 dom/ax 两种 mode 的 ba_observe，对比输出质量与体积**——这一步决定了感知层修复（排名 1/7）的最终形态。
