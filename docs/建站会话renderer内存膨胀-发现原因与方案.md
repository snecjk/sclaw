# 建站右侧会话 renderer 内存膨胀：发现过程、原因与修改方案

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-09 |
| 状态 | 已改代码（增量 IPC + overlay 块数组、过程中不 join 全文；**不截断思考全文**） |
| 现场 | 建站工作台右侧会话，超长思考一轮 |
| 结论一句话 | 不是页面重绘，是主窗口 renderer 把上万份**累计全文快照**留在 JS 堆里；修复应去掉重复拷贝，而不是把思考正文截掉 |

---

## 一、发现过程

### 1. 先排除的误判

现象是活动监视器里一个 Electron 进程到 **3.3–3.4GB**，最初怀疑：

- 流式输出导致页面不停重绘、图层堆积
- 预览 `<webview>` / guest 把 HTML 堆爆
- GPU 显存

对照监测后这些都不成立。

### 2. 指标坑：RSS ≠ 活动监视器「内存」

| 指标 | 含义 | 本轮表现 |
|---|---|---|
| `ps` RSS | 匿名页驻留，会随 GC 明显回落 | 主窗口 renderer 约 600–890MB，跑完约 300MB |
| 活动监视器「内存」 | macOS **Physical footprint**（含压缩堆、映射） | **3.4–3.7GB，峰值 3.79GB**；流结束后仍钉在高位 |

用 `ps` 会以为「没那么夸张」；用 footprint / `vmmap -summary` 才能对上用户看到的 3GB+。

### 3. 进程对上号

流式思考期间（约 17:07–17:09）对主窗口、预览、GPU 分别采样：

| PID（当场） | 角色 | 跑完 footprint | 峰值 |
|---|---|---|---|
| **97652** `Electron Helper (Renderer)` `renderer-client-id=4` | **右侧 Chat 所在 BrowserWindow** | **3.6G** | **3.79G** |
| 97677 / 97678 | 建站预览 guest | 395M / 335M | 473M / 443M |
| 97644 | Electron 主进程 | 233M | 293M |
| 97650 | GPU | 165M | 402M |

3GB+ **只堆在 97652**。活动监视器圈的就是它。

### 4. 日志对上同一时间窗

- `message.delta` sequence 从约 **5000 冲到 17000+**（单轮思考上万次累计快照）
- 主进程反复 `[chat-runtime] persist failed`，SQLite `errcode 275`（`CONSTRAINT_CHECK`）

### 5. 为什么判断「不是重绘」

1. GPU、预览 guest 都没有跟思考线性涨到 GB 级；重绘/图层会先打这两边。
2. 流已经停了，**footprint 不回落**。绘制缓冲会回收，JS 里一直握着的字符串不会。
3. 页面当时已经只**画**思考末尾约 3000 字，但 **store / IPC 里仍是全文**，且每帧一份新快照。

---

## 二、原因分析

### 数据怎么走

引擎（OpenClaw / Pi 等）的 `message.delta` **不是增量字符**，而是整段正在变长的 `RawMessage`（思考块 + 正文 + `tool_use`）。

主进程 `ChatRuntimeSupervisor.publish` 把这份累计快照放进 `CanonicalChatEvent.payload`，经 IPC `chat-runtime:event` structured clone 到 **每一个** BrowserWindow。

Renderer 里：

1. `pendingDeltaEvents.push(event)` —— 合帧前队列可叠上万份全文；
2. `overlay.streamingMessage` 每帧替换为最新全文（至少留 1 份，这没问题）；
3. 解析思考布局的 cache 键跟着 content 变，每帧 miss，再 walk 一遍全文。

页面 `sliceStreamingThinkingTail(3000)` 只减少 **Markdown/DOM**，**不减少堆里的字符串份数**。

V8 对「每次 `prev + 新增` 再 clone 一份更大的 string」非常不友好：旧代堆压缩后 footprint 仍占着。所以 RSS 能掉、活动监视器掉不下来。

### 和 Cursor / Codex 的对照

VS Code 系产品（Cursor、Codex 插件）同样会在 renderer 里涨内存，官方/社区都承认。他们通常：

- DOM 虚拟化、思考默认折叠（我们已做折叠 + 200px peek）；
- 但 composer / tool / stream buffer 仍可能胀。

Codex 侧社区分析几乎同构：**累计 snapshot 同步镜像到 UI**。建议是 store→UI 合帧只留最新 snapshot，而不是把正文截断丢掉。

我们这一轮更狠：单轮思考全文快照上万次进同一个 renderer。

### SQLite 275 在这条链上的真实位置

`chat_runtime_runs` **并不保存思考正文**，只写 phase / sequence / activity 等元数据。`275` 是表上的 CHECK（origin、engine_type、epoch、sequence、version 等），**不是「全文太大写不进库」**。

但每个 delta 仍会走 `persist()`；失败后 1s 重试。长思考时等于对着同一行 CHECK 打重试，放大主进程日志和写库抖动。主进程 footprint 只有 ~230MB，**GB 级不在这里**，但重试必须停。

### 截断为什么不合适

「截尾」= 丢掉前缀、只留最后 N 字。若用它给 overlay / IPC 降载：

- 用户手动展开思考时，前半段已经不在数据层，**滚不到全文**；
- 同一轮里更早完成的 thinking 块也会被切掉；
- 完成后若 `message.final` 迟到，中间会缺内容。

折叠条第二行只展示「最后一句预览」（约 56 字）是 **UI 摘要**，不是销毁正文。展开后必须仍是完整思考。

本次明确：**禁止用截断当内存方案。**

---

## 三、修改方案（已落地）

原则：renderer / IPC **始终能拼回全文**；降载靠「少拷贝」，不靠「少内容」。

### 1. 主进程：累计快照 → 增量后缀（不截断）

文件：`shared/chat-live-append.ts`，`electron/services/chat-runtime-supervisor.ts`

- 记住上一帧已发送的**生长字段**（string content，或最后一个 `thinking`/`text` 块）。
- 若结构不变且新文本是旧文本的前缀加长：IPC payload 只带 `_liveAppend.append`（新增那一段）。
- 结构一变（例如新出现 `tool_use`）：仍发**完整 message**，工具块不会被 slice 掉。
- Renderer `applyLiveMessagePayload` **不再** `base + append` 写出新的全文。overlay 只 `push` 后缀块（相邻小块合成 ≤256 字），`content`/`thinking` 停在首帧种子上。折叠预览读 `_liveTail`（约 96 字）。**展开或 `message.final` 才 `join` 一次。**

这是过程中涨到 2GB+ 的直接原因：1.5 万帧每次分配「比上一帧更长」的 string，平方级拷贝；Chromium 压缩堆还不给 OS。只修 IPC、不修 overlay join，活动监视器照样上台阶。

首帧仍是完整快照（通常很短）；之后上万帧只走几十字到几百字的 append。

### 2. Renderer：同会话队列只留最新一条

文件：`src/stores/chat/runtime-v2-store.ts`

`message.delta` 是累计语义，中间帧丢掉不影响正确性。合帧队列里同一 `sessionKey` 只保留最新事件；连续 `_liveAppend` 则把 `append` 字符串拼在一起。

这样即使 IPC 仍偶尔打来完整快照，队列也不会叠 1.7 万份全文。

合帧导致 sequence 跳号（例如 1→4）：`message.delta` 不再当成丢事件去 hydrate。其它事件类型的缺口仍 hydrate。

### 3. 停写无意义的 delta persist

`message.delta` 只把 snapshot 标 dirty，**立刻写库改为等到非 delta / 终态**。避免长思考期间 CHECK 275 重试风暴。思考正文从未进这张表，行为与「全文是否截断」无关。

### 4. 展示层：去掉 3000 字截尾渲染

删除 `streaming-tail-window` 对当前思考块的截断。

- 默认收起：标题 + 最后一句预览（预览可以短，正文仍在数据里）。
- 展开：200px 内滚看**全文**；流式中当前块仍是纯文本（不跑完整 Markdown），完成后展开再走 Markdown。

---

## 四、验证

单元测试（应覆盖）：

- `tests/unit/chat-live-append.test.ts`：加长思考只发后缀，拼回全文；新 `tool_use` 回退完整快照
- `tests/unit/chat-runtime-supervisor.test.ts`：IPC 增量；delta 不逐条 persist
- `tests/unit/chat-runtime-delta-batching.test.ts`：同帧只留最新全文
- `tests/unit/chat-client-session-reducer.test.ts`：append + sequence 跳号不 hydrate
- `tests/unit/thinking-turn-process.test.tsx`：展开可见全文，不再断言「只渲染尾部 3000 字」

手工回归：

1. **必须重启 Electron 主进程**（HMR 不够）。已经涨到 2GB 的窗口关了 footprint 才会掉；新开窗口再跑一轮超长思考。
2. 建站右侧会话跑一轮超长思考：活动监视器看 **主窗口 renderer Physical footprint**。过程中应随思考长度近似线性（一份块数组 + 预览尾），不应每几秒上台阶涨到 2GB+。
3. 流式中展开思考条，向上滚应能看到**开头**，不是只有末尾。
4. 思考中途出现工具调用，工具卡片仍在，思考全文仍在。
5. 完成后摘要行、再展开，Markdown 全文正常。
6. 日志中长思考期间不应再刷屏 `persist failed` / `275`。

---

## 五、汇报可用的一句话因果

> 建站右侧会话超长思考把主窗口 renderer 打到数 GB footprint，不是预览、不是 GPU、不是「跑完不释放」这么简单。引擎 `message.delta` 是累计快照；即便 IPC 只发后缀，renderer 若每帧 `旧全文 + 新后缀` 仍会在**执行过程中**平方级涨内存。修复是 overlay 用块数组接下后缀、过程中不 join，展开/结束再拼回全文。不要截断思考正文。
