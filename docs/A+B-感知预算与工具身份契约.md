# A + B 设计：感知预算与工具身份契约（含 C 规范层）

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-07 |
| 状态 | 待评审（Kimi K3） |
| 前置 | R0 止血、R1a（query owner + 空转防护）、R2 先手（错误契约）均已交付 |
| 关联 | `docs/R1b-运行时内核-状态机补边与续跑协议.md`（C，本文档第一章引用其规范）、`docs/agent-loop-根因分析.md` |
| 一句话 | A 治「模型被自己的感知撑傻」，B 治「同一轮的多次调用被判成一次」；两者都不做局部补丁，而是各立一条全链路契约，规范层统一写在第一章 |

---

## 零、这份文档管什么

前几轮修的是**会让 agent 立刻出错**的东西（错误被伪装成成功、query 生命周期、配置漂移）。A 和 B 是另一类：**不会报错，但会持续降低判断质量**——感知太大把上下文撑爆，身份判错把执行痕迹抹掉。这类问题打补丁没用，因为它们的成因是"同一个语义在多处各自实现"。所以 A 和 B 各自的交付物不是若干处修改，而是**一条契约 + 一个唯一实现点 + 一张穷举测试表**。

第一章是规范层（C），后续任何改动都对照它做自检。第二、三章是 A、B 的施工方案。

---

## 一、规范层：四条契约

到本轮为止，SClaw 的 agent 链路上有四条需要跨层保持同形的契约。前两条已交付，后两条由本文档定义。

### 契约 1（已交付）：错误契约

失败必须以失败的形态到达模型。判据：`{ success: false }` 的返回一律降级为失败信封，MCP `isError: true`，并附 `actionHint` 给出下一步。守卫：`tests/unit/sto-tool-envelope-contract.test.ts` 逐字节钉住 3 份手抄件。

### 契约 2（已出文档，待施工）：运行时契约

见 R1b 文档。四条不变量：abort 必须带 runId 且只关自己那一轮；续跑决策收敛为一个纯函数且中断原因随 run 快照持久化；systemPromptAppend 组装有唯一 owner 和"会话种类 × 段落"期望矩阵；`ALLOWED` 相位表有穷举契约测试且"进相位即武装看门狗"可断言。

### 契约 3（本文档 A 章）：感知预算契约

任何返回页面感知结果的工具，**必须**满足：

1. **有上限**：节点数和字符数都有显式预算，不存在"看页面多大就返回多大"的路径。
2. **降级而不是截断**：超预算时按既定顺序牺牲信息密度（折叠子树 → 丢弃尾部 → 压缩文本字段），而不是从中间一刀切。
3. **超限必须自述**：返回体带 `truncated` 与降级轮次；模型必须能知道自己看到的是不完整视图。
4. **永不返回空**：落盘只能是**附加**手段——落盘的同时必须内联返回可交互子集，让模型仍能继续操作。
5. **载体无关**：DOM 与 AX 两种载体产出同一份观测契约，切换载体不改变调用方代码。

### 契约 4（本文档 B 章）：工具身份契约

"这两条记录是不是同一次工具调用"这个判断，**在整条链路上只允许有一个实现**，且：

1. **身份在摄入处一次性判定**，下游只读不重算。
2. **引擎给的 id 不可信**：既可能与 name 相同（弱 id），也可能形如 `toolu_<Name>_0` 看起来唯一、实则整轮复用。身份判定不得以 id 唯一性为前提。
3. **合并的判据是"能不能合"，不是"像不像"**：input 冲突（双方都有值且不同）即两次调用；一方为空（流式 partial → final）才是同一次的两份快照。
4. **丢调用是数据损坏，不是显示问题**：任何"看起来重复就丢弃"的分支都必须能解释它丢掉的是什么。

---

## 二、A：感知预算

### A0 现场：13.9 万字符是怎么来的

妙悟那次任务跑在 **embed 浏览器**里，走的是 `sclaw-embed-bridge-inject` 的页内快照。它的"可交互"判据是：

```36:38:shared/sclaw-embed-bridge-inject.ts
    var isInteractive = node.matches(
      'a, button, input, textarea, select, [contenteditable], [onclick], [role="button"], [role="link"], [role="tab"], li, span, div'
    );
```

`li, span, div` 在列表里，意味着**页面上几乎每个容器节点都算交互元素**，每个都会拿到 `ref / role / name / tag / clickable / editable / boundingBox{x,y,width,height}`，并且递归嵌套保留 `children`。`buildSnapshot` 从 `document.body` 全树 walk，**没有任何 maxNodes / maxChars**。一个真实业务页面产出十万级字符是必然而不是意外。

三处放大器叠加在一起：

| 放大器 | 位置 | 现状 |
|---|---|---|
| 选择器过宽 | `sclaw-embed-bridge-inject.ts:36-38` | `li/span/div` 全量入选 |
| 无节点/字符预算 | `sclaw-embed-bridge-inject.ts:80-90` | 全树 walk，无上限 |
| 工具层 pretty-print | `sto-plugin/claude/sto-browser-tool/tools.ts:23-27` | `JSON.stringify(value, null, 2)`，两空格缩进把体积再抬一截 |

### A1 三条链路的预算现状

| 链路 | 节点上限 | 字符预算 | 降级 | truncated 自述 | 落盘 |
|---|---|---|---|---|---|
| BA / AX（`ax-observer.ts`） | — | **60_000**（`types.ts:350`） | **三轮**（折叠子树 → 弹尾部 → name/value 减半，`ax-observer.ts:369-439`） | ✅ `degradationRound` | — |
| BA / DOM（`observe-script.ts`） | 120（`types.ts:342`） | 无 | 无 | ❌ 通常不置位 | — |
| Bridge / 扩展 DOM | 400（`page-agent.js`） | 无 | 无 | ❌ | — |
| Bridge / 扩展 AX | 无 | 无 | 无 | ❌ | — |
| **Bridge / embed DOM** | **无** | **无** | 无 | ❌ | — |
| BA / read_page | 60 屏 | 24_000/窗（`types.ts:361`） | 分页 | ✅ `nextStart` | ✅ `artifact-writer` |

结论很清楚：**预算模型我们已经有了两个能用的样板**——AX 的三轮降级和 read_page 的分页 + 落盘。A 不需要发明新机制，需要的是把它们提取成共享件，然后让所有感知出口都走同一条路。

### A2 设计

**A2.1 提取共享预算模块**

把 `ax-observer.ts:369-439` 已经过测试的降级逻辑抽成 `shared/browser-automation/perception-budget.ts`，与载体解耦：

```ts
export interface PerceptionBudget {
  maxNodes: number;
  maxChars: number;
  /** 降级顺序固定，便于测试与复盘 */
  rounds: Array<'collapse-subtree' | 'drop-tail' | 'shrink-text'>;
}

export interface BudgetedResult<T> {
  items: T[];
  truncated: boolean;
  degradationRound: number;
  droppedCount: number;
  /** 超预算时给模型的下一步指引，而不是只说"被截断了" */
  hint?: string;
}

export function applyPerceptionBudget<T extends BudgetedNode>(
  nodes: T[], budget: PerceptionBudget,
): BudgetedResult<T>;
```

`ax-observer` 改为调用它，行为逐值不变（现有 `browser-automation-ax-observer.test.ts` 即回归网）。

**A2.2 统一观测契约**

bridge 的 snapshot 从"嵌套 tree"改为与 BA 同形的**扁平 elements 契约**：`{ url, title, timestamp, elements[], documentGeneration, truncated, degradationRound, nextPage? }`。理由有三：扁平结构没有嵌套膨胀；`documentGeneration` 让 bridge 也能有 STALE_REF 语义（现在只有 BA 有，见 R1b 之外的 prompt-builder §引用代际）；两条链路同形之后提示词不用再解释"bridge 和 ba 返回不一样"。

**A2.3 载体无关，AX 优先但不阻塞**

PoC 证明 Electron 侧（`BrowserWindow.webContents` 与 `<webview>` guest）**不开 flag 就能拿到 AX 树**（`reports/browser-bridge/ax-webview-poc-result.json`，22 节点，`withoutEnable.ok = true`）。所以：

- **embed**：直接接 AX 载体，一次到位；
- **外部 Chrome**：AX 要由扩展经 CDP 取，而扩展目前只有壳，因此先在收敛后的 DOM 子集上跑**同一套预算**，等扩展补齐再切载体。

预算模块与观测契约都不感知载体，所以切换时调用方零改动。**不要给 DOM 单独做一套一次性预算**。

**A2.4 分页与落盘：永不返回空**

超预算时同时做三件事：内联返回**可交互子集**（按预算裁剪后的 elements）、把完整快照写 artifact 返回句柄、给出 `nextPage` 游标。当前 read_page 已有这套（`artifact-writer.ts` + `paginateReadPageText`），复用即可。

这一条是硬要求：妙悟那次之所以崩坏，不是因为快照太大，而是因为**太大之后模型什么都没拿到**，只能去刨自己的 transcript。落盘而不内联子集，等于把同一个坑挖深。

**A2.5 收敛 embed 选择器**

从 `isInteractive` 里去掉 `li, span, div`，与 BA DOM 的白名单对齐（`observe-script.ts:141-146`）；非交互容器沿用现有"有名字才保留、单子节点上提"的合并逻辑。同时给 `buildSnapshot` 加 `maxNodes`。

**A2.6 工具层停止 pretty-print**

`JSON.stringify(value, null, 2)` 改为紧凑序列化。感知结果是给模型读的结构化数据，两空格缩进只是纯开销。

### A3 验收

- 单测：同一份大页面 fixture 在 embed / 扩展 DOM / AX 三条链路下，输出字符数都 ≤ 预算，且都带 `truncated` 与降级轮次；
- 单测：超预算时内联 elements 非空且全部可交互，artifact 句柄可解析；
- 单测：`applyPerceptionBudget` 三轮降级顺序固定，与现有 ax-observer 行为逐值一致（防止提取过程改变行为）；
- 端到端：拿妙悟那单真实任务重跑，单次 snapshot 字符数进预算，且模型不再出现"用 shell 刨 transcript 找 ref"的行为。

---

## 三、B：工具身份契约

### B0 现场

妙悟那份 transcript 里 **83 次工具调用只有 20 个不同的 `tool_use` id**，24 条互不相同的 Bash 命令全部共用 `toolu_Bash_0`。这些 id 不是 Anthropic 原生 id，是 kimi-k3 经 STO 网关做工具调用适配时生成的，**在一次会话里不唯一**。

后果分两层：UI 的工具列表整段丢调用（用户看到"执行了 1 次"，实际 24 次）；更麻烦的是执行快照也按同一套身份聚合，复盘时看不到真实执行序列。

### B1 现状：8 个身份函数，79 个调用点

| 函数 | 位置 | 非测试引用数 |
|---|---|---|
| `isStableToolId` | `src/lib/thinking-timeline-active.ts:25` | 23 |
| `thinkingTimelineToolIdentityKey` | `src/lib/tool-input-merge.ts:34` | 15 |
| `resolveStreamingToolId` | `src/lib/thinking-timeline-active.ts:32` | 11 |
| `thinkingTimelineToolKey` | `src/pages/Chat/thinking-turn-segments.ts:99` | 10 |
| `toolRowKey` | `src/lib/thinking-timeline-active.ts:36` | 7 |
| `streamingToolKey` | `src/lib/thinking-timeline-active.ts:42` | 6 |
| `resolveToolIdentity` | `src/lib/tool-input-merge.ts:21` | 5 |
| `streamingToolCacheKey` | `src/lib/tool-input-merge.ts:98` | 2 |

八个函数、七十九处调用，语义互相重叠又各有细微差别。本轮止血时定位到的四个坍缩点——`mergeRawTurnEvents`、`appendToolToGroup`、`buildToolPartLookup` 的 name 兜底键、`enrichToolItem` 的反向覆盖——**都是各自独立地重算了一遍身份**。修完四个不代表没有第五个。

`isStableToolId` 的判据本身也站不住：

```25:30:src/lib/thinking-timeline-active.ts
export function isStableToolId(id: string | undefined, name: string): boolean {
  if (!id) return false;
  if (id === name) return false;
  if (/^tool-\d+$/.test(id)) return false;
  return true;
}
```

它只能识别"id 等于 name"和"tool-数字"两种形态。`toolu_Bash_0` 两条都不满足，于是被判为稳定 id——恰恰是真实事故里最常见的那种。**id 的唯一性无法从 id 的形状推断**，这是个死路。

### B2 设计：身份在摄入处判定一次

**B2.1 摄入处发放调用唯一号**

在引擎侧解析 `tool_use` / `toolCall` 块时（`claude-stream-content.ts:67`、`claude-execution-snapshot.ts:83,101`、`openclaw-execution-snapshot.ts:74,99`），为每次调用发放一个**本轮唯一**的 `callUid`：

- 引擎给的 id 在本轮内首次出现 → `callUid = id`；
- 再次出现且 input 与已记录的那次冲突 → 判定 id 撞车，`callUid = ${id}#${序号}`；
- 再次出现且 input 不冲突（流式 partial → final） → 复用同一个 `callUid`。

`callUid` 随消息一路带下去。**下游（timeline、segments、UI、执行快照）只读 `callUid`，一律不再重算身份。**

**B2.2 收敛为两个函数**

八个函数收敛为：`resolveCallUid(tool, turnState)`（唯一的身份判定，只在摄入处调用）和 `isSameInvocation(a, b)`（唯一的合并判据，即本轮已落地的 `isConflictingToolInput` 取反）。其余六个改为薄封装或直接删除，禁止新增。

**B2.3 与本轮止血的关系**

本轮已交付的四处修改是**止血**：它们让 `isConflictingToolInput` 在四个坍缩点上生效，测试转绿，用户能看到 24 次调用。B2.1/B2.2 是**根治**：把判定挪到摄入处，从此下游不可能再算错，也不需要每发现一个坍缩点补一次。止血保留，根治后它们自然退化为无害的冗余检查，再逐个删除。

### B3 验收

- 穷举测试：`(id 形态 × 出现次数 × input 关系)` 的组合表，至少覆盖弱 id（`id === name`）、网关复用 id（`toolu_<Name>_0`）、真实唯一 id、流式 partial → final、历史重解析五种；
- 回归：`tests/unit/thinking-claude-done.test.ts` 保持绿；
- 真实数据：用妙悟那份 transcript 做 fixture，断言解析出 83 次调用而不是 20 次；
- 契约测试：`src/lib` 下身份相关的导出函数数量不得增长（防止第九个 key 函数出现）。

---

## 四、交付顺序

| 步 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| 1 | D 搭车：`commandTimeoutMs` 改 ceiling + 与流关闭窗口（300s）显式对齐 | 无 | 低，配置语义 |
| 2 | A2.5 + A2.6：收敛 embed 选择器、去掉 pretty-print | 无 | 低，立竿见影（体积先降一档） |
| 3 | A2.1：提取 `perception-budget`，`ax-observer` 改为调用 | 现有 AX 测试 | 低，行为逐值不变 |
| 4 | A2.2 + A2.4：统一观测契约 + 分页落盘 | 步 3 | 中，改 bridge 返回结构，需同步提示词 |
| 5 | A2.3：embed 切 AX 载体 | 步 4 | 中，PoC 已证可行 |
| 6 | B2.1 + B2.2：`callUid` 摄入处判定 + 函数收敛 | 无（可与 A 并行） | 中，触及引擎与渲染两侧 |

D 和第 2 步可以同一批带走。第 6 步与 A 无依赖，可并行。

## 五、不在范围

- **仓外扩展**（MV3 轮询、borrowed tab、E0–E6）：`browser-extension/` 目前只有壳，"连外部 Chrome"的完整体验不在本文档；A 的外部 Chrome 分支因此先跑 DOM 载体。
- **上下文累计成本**（artifact digest、历史窗口、每轮 resume 的累计开销）：归 R2/L3。A 只治"单次感知太大"。
- **R1b 施工**：本文档第一章只引用其规范，施工按 R1b 文档自身的顺序走。
- **基线债**：166 个 node 侧类型错误、15 个 renderer 类型错误、3 个基线红测试（`openclaw-cli` Windows 分支、`chat-engine-resolution`、`chat-display-dingtalk`），单独立项。

## 六、验收总口径

沿用既定标准：同一个妙悟建站任务，对照 Kimi 轨迹——回合数 ≤ 2 倍、零假执行、零死循环、失败时模型自述的错误 = 原始 error 原文、停止按钮一次生效且不误杀下一轮。A 和 B 各自的单测是必要条件，**这一条端到端实测才是唯一算数的验收**。
