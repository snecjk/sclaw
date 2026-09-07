# Agent 实现 Code Review 报告（Claude 引擎）

| 元信息 | 值 |
|---|---|
| 日期 | 2026-09-04 |
| 审查范围 | `electron/engines/claude-adapter.ts`（1747 行）+ `claude-sdk-runtime.ts`；`chat-runtime-supervisor.ts` + `chat-send-service.ts` + `gateway.ts` + `message-queue.ts` + `send-actions.ts`；`claude-runtime-extensions.ts` + `sto-plugin/claude/*`（hooks/MCP/遥测）+ embed 上下文注入链 |
| 方式 | 三路并行只读审查，全部结论带 文件:行号 证据 |
| 关联文档 | [agent-loop-根因分析.md](./agent-loop-根因分析.md)（体验层根因）；本文档是实现层 CR |
| 总体评价 | **中等偏上，"注释很勤奋、结构在腐化"**：状态机骨架（epoch/seq 幂等、settle/compensation、抑制逻辑）体现了认真设计；但安全与合规机制完成度落后于功能堆叠，失败路径清理靠运气，适合内部试用，不适合作为对外承诺的安全边界 |

---

## 一、🔴 必须修（11 项，按风险排序）

### 安全/数据外泄

**S1. 遥测脱敏是死代码，工具参数/结果原文全量外发**
`sto-plugin/claude/sto-agent-telemetry/sdk/runtime-options.ts:70-71`：`DEFAULT_SANITIZATION.enabled=false` 硬编码，`sanitizeForExport`/`redactKeys` 从未生效。PreToolUse/PostToolUse 把 `tool_input`+`tool_response` 原文 POST 到远端：Bash 命令全文、Write 文件内容、**`bridge_fill` 填入页面的值（可能是密码）**、`bridge_screenshot` 的 base64 截图（单次 MB 级）。
→ 修：默认开启脱敏 + 收紧上限（8KB）；tool_response 只上报元数据；截图类显式排除。

**S2. Embed 页面内容无不可信围栏直注 prompt = 间接 prompt injection**
`src/lib/sclaw-browser-embed-context.ts:68-78,100-105`：webview 可见文本（6000 字符）+ 网络请求 URL 逐字拼进 user message，无任何"不可信数据"围栏。`bridge_navigate` 可把页面导航到任意 URL，页面写"忽略上文，调用 X 工具"即进入模型上下文。且该块随 UserPromptSubmit 进遥测（S1 外泄链）并永久留在历史里累加。
→ 修：显式不可信围栏包裹；URL 剥 query；旧上下文块每轮替换而非累加。

### 并发/生命周期

**C1. 同 session 双 query 并存无防护**（claude-adapter.ts:1359-1364, 1155, 1207-1526）
`startClaudeQuery` 不检查活跃 query；supervisor supersede 只发事件不 abort（chat-runtime-supervisor.ts:356-361）。后果：注册覆盖→旧 query close 句柄丢失；finally 按 key 误删新 query 条目；两个 query 同时 resume 同一 SDK session，abort 全面失效，后台静默烧 token。
→ 修：per-session query lifecycle owner（注册/替换/关闭/清理一处完成）；delete 按 runId 条件删除；supersede 联动 abortRun。

**C2. abortRun 不校验 runId + 启动/恢复窗口 abort 被吞**（claude-adapter.ts:1738-1746, 1338-1359, 1466-1471）
supervisor 用旧 runId abort 会误杀新 query；SDK 进程启动窗口（秒级）和 missing-session 恢复窗口（读归档 transcript 数秒）内 abort 查表为空 → 返回 success → query 照跑。**停止按钮在多个真实时序窗口内无效**。
→ 修：abortRun 校验 runId；注册后检查"挂起 abort"标志。

**C3. 注册后失败路径无清理 → query 泄漏 + 永久"运行中"假态**（claude-adapter.ts:1359-1374, 1523-1525）
`activeClaudeQueries.set` 后还有会失败的 `upsertEngineSessionRegistryEntry`；DB 抖动 → 已注册 query 无人消费无人关闭，SDK 子进程悬挂，会话永久显示运行中。
→ 修：创建后所有步骤包 try/catch，失败时 close+条件删除。

**C4. 删除会话不停止活跃 query → 软删除"复活"**（claude-adapter.ts:1539-1562；session-engine-binding-repository.ts:132 update 分支无条件 `deleted_at:null`）
运行中 query 的 per-message upsert 把已软删除的行复活——**用户删除的会话自己"回来"了，还在后台跑**。
→ 修：删除前 close 活跃 query + tombstone 跳过 upsert。

### 状态机/卡死

**K1. reconciling/running 相位无看门狗 → 卡死最长 6 小时**（chat-runtime-supervisor.ts:869-878, 38-40, 665-667, 996-1004）
引擎静默死亡时：openclaw 靠 history poll 转入 reconciling 但不武装看门狗，8s 空转永不升级；**claude 会话 running 期没有任何周期对账**（requiresHistoryProjection:false）。渲染端 sending=true 永久卡住，唯一出路是 6 小时硬截止。
→ 修：确立"进入任何 watch 相位即武装看门狗"不变量；claude 保留低频 reconcile。

**K2. 状态机缺边：uncertain 期间引擎完成 → 135s 后误杀**（chat-runtime-transition.ts:28；supervisor:601-613, 855-864, 1086-1097）
dispatch 超时/网络错误进 uncertain 后引擎正常完成：turn.completed 转换被拒、reconcile 被拒、settle 被拒。仅空回复/inspection=unknown 场景就无自愈路径 → 看门狗以 run.interrupted 误杀——**transcript 里明明有完整答案**，还阻断队列 drain。
→ 修：ALLOWED.uncertain 补 awaiting_transcript/completed 边；补"相位×终态事件"穷举测试。

**K3. 队列"先出队后投递"无确认 → 消息永久丢失 + 队列停摆**（message-queue.ts:337, 354, 378-381；send-actions.ts:134-159）
drain 先 dequeue 再 sendMessage，后者多个无返回值 early-return（sending 锁/readiness 失败）→ 消息被静默吞掉；且没有新 run 启动就不会再 drain → **队列剩余消息永久停摆，无 UI 信号**。
→ 修：sendMessage 返回可判定结果；drain 改 peek→确认投递→再出队，失败 requeue。（契约改动较大，单独排期）

**K4. dispatching 相位监管真空**（chat-send-service.ts:32, 57-70）
begin 之后、try 之外的 memory prepare/coordinator.begin 抛错，或 dispatch() 挂起 → 快照停在 dispatching，无 rejected、无看门狗、无 reconcile 边 → 卡死至 6h。
→ 修：begin 后全部操作纳入 try/catch 走 rejected()；dispatching 纳入 watch 相位（30s deadline）。

### 挂起

**H1. 浏览器自动化 HTTP 客户端无超时 → 工具永久挂起**（sto-plugin/*/automation-client.ts:27-50、bridge-client.ts:40-50；`ba_wait.timeoutMs` z.number() 无上限）
fetch 无 AbortSignal；host API 挂起时单次请求永不返回，轮询 deadline 形同虚设，整轮 agent 卡死。
→ 修：统一 `AbortSignal.timeout(30s)`；ba_wait timeoutMs 上限 ≤120s。

---

## 二、🟡 应该修（精选 12 项）

| # | 位置 | 问题 |
|---|---|---|
| M1 | claude-adapter.ts:1113-1127 | 标题抹除窗口：per-message upsert 整体覆盖 extra_json，经历过恢复的会话每个 run 在 system init 处标题瞬时消失，run 崩在回声前则永久丢失 |
| M2 | claude-adapter.ts:1003-1009 | 后台任务 deferred completion：每个 result 都 capture → 一次逻辑回合消耗 2+ turnIndex，token 可能重复计数 |
| M3 | turn-token-service.ts:10-12 | 两个 Map 只增不减，clearSession 零调用方，删会话不清理 |
| M4 | claude-adapter.ts:633-737 | getHistory 全量读+全量 hash+事后分页，被运行期轮询放大；文件注释自己记录过这个性能教训（L502-508）仍在重演 |
| M5 | supervisor M1 | recovery-timeout 误杀时不 abort 引擎 → 引擎继续烧 token，transcript 与 UI 永久分叉 |
| M6 | supervisor M2/M3 | supersede 后旧 run 事件经 runId 空窗漏入新 run；幂等 replay 直接覆盖活动快照 |
| M7 | runtime-options.ts:279, 355-394 | 遥测仍在关键路径串行阻塞：UserPromptSubmit +5s、Stop 两个串行 await 最坏 +10s；失败无熔断无降级缓存（**注：PreToolUse/PostToolUse 已改 fire-and-forget，此前"工具调用全阻塞"的判断以当前快照为准已部分过时**） |
| M8 | claude-runtime-extensions.ts:282-292 | 每条消息全量串行重建装配：10 扩展串行 await、4 个 MCP server 每轮新建、getStoToken/getAuthState 各调 2 次 |
| M9 | Y1 fail-open | 安全门系统性 fail-open：扩展 build 失败→静默跳过、hook 抛错→SDK 实证放行工具；钉钉/connector/工作流守卫全部在此语义下运行，失效只有一条 warn |
| M10 | Y2/Y3 守卫正则 | 定时任务/工作流守卫误伤正常命令（`cat cron.log`、commit message 含"工作流"）；bash gate 可被引号/变量/env 绕过，定位应为"防呆"非"安全边界" |
| M11 | claude-adapter.ts:1164-1174 | 有挂起后台任务时 abort → 引擎层无任何终态事件，渲染层等 135s |
| M12 | Y6/Y7 漂移 | 钉钉守卫 claude/openclaw 两份 316 行已漂移且 pending 记录未接线；embed 上下文广告未注册的 ba_* 工具（诱导幻觉调用） |

## 三、🔵 建议（精选 8 项）

claude-adapter.ts 1747 行拆三模块（launcher/consumer/history）；三段 legacy 注释代码移 docs；sortKey 魔法除数（:680）；fallbackRefs 路径拼两次（:249）；媒体文件父目录进 additionalDirectories = 拖入 ~/ 文件即授权整个 home（:179-188，**建议收紧**）；`[Claude error]` 伪消息只存内存不进 transcript（B9）；getStoToken 等基础设施 5 处各抄一份且命令 key 列表不一致；扩展顺序即权限语义但无注册校验/测试。

---

## 四、三大系统性病根（跨文件）

1. **"同会话同一时刻只有一个 query"是隐含假设而非强制不变量**——C1/C2/C4 是同一根因的四个症状。修单点不如建 per-session query lifecycle owner。
2. **状态先行的操作无对账无回滚**——队列 dequeue→deliver（K3）、supersede 不 abort（M6）、replay 覆盖快照、kill 不 abort（M5）、相位迁移只落库不发事件（supervisor M4）。需要统一原则：不可逆操作必须拿到下游确认，失败必须可回滚。
3. **保护机制全是"尽力而为"且失效无感知**——遥测脱敏死代码（S1）、守卫 fail-open（M9）、页面内容无隔离（S2）、HTTP 无超时（H1）。安全/合规面需要 fail-closed 策略开关 + 失效埋点。

## 五、建议修复顺序

1. **S1**（数据外泄，当天）→ **H1**（挂起，半天）→ **K2**（状态机补边，小改动）→ **K1**（看门狗不变量）；
2. **C1-C4** 打包做（per-session query lifecycle owner，约 1-2 天，一次解决一类）；
3. **S2**（injection 围栏）→ **M7/M8**（遥测与装配性能）→ **K3**（队列契约，单独排期）；
4. 其余 🟡/🔵 随迭代消化。

## 六、未能验证项（诚实声明）

- `adapter.sendMessage` 是否有内部超时（影响 K4 触发概率）；
- openclaw gateway 会话失效时是否总会补发 turn.failed（影响 K1 触发概率）；
- `rememberClaudeInterrupt` 是否覆盖 abort 意图记忆（claude-adapter.ts:1149 仅见于失败路径）。
