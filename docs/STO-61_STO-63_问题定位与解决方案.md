# STO-61 / STO-63 问题定位与解决方案

> 生成时间：2026-06-15
> 范围：仅 STO-61（后台表字段不展示给用户）、STO-63（执行时间显示不对）

---

## 一、STO-61：后台表字段类不给用户展示

### 1.1 问题描述
用户在工作流参数确认、结果摘要、工作流预览等界面中，看到了类似 `customer_base_id`、`express_bill_code`、`VOLUME_ABNORMAL` 等后台数据库字段名或内部常量名，而非业务可读的中文名称。

### 1.2 根因分析

当前代码存在一个初步的字段名清理层（`src/lib/workflow-user-facing-text.ts`），但覆盖范围不足，且多个渲染路径未经过该层处理：

| 代码位置 | 问题 |
|---------|------|
| `src/lib/workflow-form-utils.ts:370-372` | `formatWorkflowObjectLines` 对没有 `items` 定义的对象，直接使用 `Object.entries(record)` 把原始 key 拼成 `key：value` 展示 |
| `src/lib/workflow-form-utils.ts:467-479` | `buildWorkflowValuesSummaryFallback` 在 schema 不可用时，直接用 `key` 作为 label 输出 |
| `src/lib/workflow-user-facing-text.ts:42-58` | `sanitizeWorkflowSummaryText` 只处理了 `SUMMARY_KEY：` 这类单行文本，对 JSON/对象内部字段无映射能力 |
| `src/components/workflow/WorkflowPreviewPanel.tsx:181` | 展示 `field.label`；如果后端 schema 没配置 label，可能回退成 key |

### 1.3 已存在的保护机制

`src/lib/workflow-user-facing-text.ts` 已有一个 `FIELD_LABEL_MAP`，目前包含 10 个异常监控相关字段的中文映射，以及一个正则判断内部字段的方法。问题在于：

- 映射表太小，只覆盖了异常监控场景
- 没有在工作流参数摘要/对象展开路径中被复用
- 正则 `INTERNAL_FIELD_KEY` 对混合大小写、带数字后缀的字段覆盖不全

### 1.4 具体解决方案

#### 方案 A：统一字段名映射层（推荐）

1. **扩展 `FIELD_LABEL_MAP`**
   - 从产品中收集所有可能暴露的后台字段，补充中文映射
   - 按业务域分组（客户资料、工单、运单、异常监控等）

2. **在对象展开路径复用映射**
   - 修改 `formatWorkflowObjectLines`：
     - 有 `field.items` 时，用 `item.label`
     - 无 `items` 时，对 `record` 的每个 key 调用 `labelForWorkflowFieldKey(key)`
     - 如果映射后仍等于原 key 且 key 命中 `isInternalWorkflowFieldKey`，则**隐藏该字段**

3. **修复 fallback summary**
   - `buildWorkflowValuesSummaryFallback` 中同样对 key 做映射/过滤

4. **summary 文本二次清洗**
   - `sanitizeWorkflowSummaryText` 增加对 JSON blob 中 key 的递归清洗
   - 对 `{"customer_base_id":"xxx", ...}` 这类输出，替换为中文 label 或整体隐藏

5. **预览面板兜底**
   - `WorkflowPreviewPanel` 中如果 `field.label` 看起来是内部 key，用 `labelForWorkflowFieldKey` 二次映射

#### 方案 B：字段白名单（更严格）

- 明确定义「可向用户展示的字段」白名单
- 不在白名单中的字段默认隐藏
- 适合对数据安全要求更高的场景

**建议**：先实施方案 A，快速止血；后续逐步过渡到白名单机制。

### 1.5 改动文件

- `src/lib/workflow-user-facing-text.ts`
- `src/lib/workflow-form-utils.ts`
- `src/components/workflow/WorkflowPreviewPanel.tsx`
- `tests/unit/workflow-user-facing-text.test.ts`（新增或扩展）

### 1.6 验收标准

- 工作流参数确认摘要中不再出现 `xxx_id`、`xxx_code`、`XXX_YYY` 等原始字段名
- 工作流预览面板所有字段 label 为中文业务名称
- 结果 summary 中的 JSON/对象字段被映射或隐藏
- 新增/修改的映射表有单元测试覆盖

---

## 二、STO-63：执行时间显示不对

### 2.1 问题描述
工作流卡片上显示的执行时长明显不对，常见表现：
- 执行了几十秒的任务显示为 0 秒或极短
- running 状态和 completed 状态的时长不一致
- 刷新页面后时长变化

### 2.2 根因分析

当前执行时间链路：

```
API 返回 startedAt/completedAt
    ↓
workflowRunResponseToExecutionState (shared/workflow-run-status.ts:219)
    ↓
mergeWorkflowCardState (src/lib/workflow-card-state-merge.ts:11)
    使用 resolveWorkflowStartedAt(previous, incoming, localStartedAtMs, completedAt)
    ↓
WorkflowCard.tsx:190 useDurationLabel(display.startedAt, display.completedAt, isRunning)
```

定位到的具体问题：

| 代码位置 | 问题 |
|---------|------|
| `src/lib/format-workflow-duration.ts:16` | `MIN_PLAUSIBLE_WORKFLOW_DURATION_MS = 5_000`（5秒）阈值过高，很多正常短任务被误判 |
| `src/lib/format-workflow-duration.ts:37-51` | 候选时间选择逻辑复杂，容易选错；当多个候选都接近 completedAt 时无法有效修正 |
| `src/stores/workflow-memory.ts:600` | `buildWorkflowCardStatesForSession` 用 `exec.createdAt`（记录创建时间）作为 `startedAt`，这可能早于或晚于真实执行开始时间 |
| `src/lib/workflow-card-state-merge.ts:11-16` | `localStartedAtMs: exec?.createdAt` 被传入，但 createdAt 不是准确的执行开始时间 |
| `shared/workflow-run-status.ts:219` | `workflowRunResponseToExecutionState` 直接取 API 的 `startedAt`，未做任何合理性校验 |

### 2.3 为什么 API 的 startedAt 会不准

1. 后端以「请求接收时间」作为 startedAt，而实际调度执行有延迟
2. 某些节点执行完毕后，startedAt 被覆盖为最后一个节点的开始时间
3. 后端返回的 startedAt 和 completedAt 相同或相差几毫秒

### 2.4 具体解决方案

#### 方案 A：以节点时间为准，修正 startedAt（推荐）

1. **在 `workflowRunResponseToExecutionState` 中计算更准确的 startedAt**
   - 优先使用 API 返回的 `run.startedAt`
   - 如果 API startedAt 无效或与 completedAt 差值过小（< 1s），从 `nodeRuns` 中取最早节点的 `startedAt`
   - 如果 nodeRuns 也没有，使用 `run.completedAt` 减去各节点 duration 总和推算

2. **区分「记录创建时间」和「执行开始时间」**
   - `workflow-memory.ts:600` 不要直接用 `exec.createdAt` 作为 `startedAt`
   - 仅在没有任何其他时间来源时，才 fallback 到 createdAt
   - 修改 `buildWorkflowCardStatesForSession`，不设置 `startedAt`，让 hydrate 后的 API 数据填充

3. **简化 `resolveWorkflowStartedAt`**
   - 降低 `MIN_PLAUSIBLE_WORKFLOW_DURATION_MS` 到 1000ms 或 500ms
   - 明确优先级：nodeRuns 最早 startedAt > API startedAt > local track time > createdAt fallback
   - 移除复杂的候选遍历逻辑，改为清晰的可信来源选择

4. **修复 running 状态显示**
   - 当前 `useDurationLabel` 在 running 时每秒更新 `now`，这是对的
   - 但需要确保 `startedAt` 在 running 时已经确定，否则会跳变

#### 方案 B：前端本地记录开始时间

- 在 `startWorkflow` 成功返回时，用返回的 `startedAt` 或本地 `Date.now()` 记录到 `workflow-memory`
- 后续 merge 时优先使用这个本地时间
- 适合 API 时间不可靠的场景

**建议**：方案 A + 方案 B 结合。方案 A 修复 hydration 后的时间，方案 B 确保 running 过程中时间稳定。

### 2.5 改动文件

- `shared/workflow-run-status.ts`
- `src/lib/format-workflow-duration.ts`
- `src/lib/workflow-card-state-merge.ts`
- `src/stores/workflow-memory.ts`
- `src/components/workflow/WorkflowCard.tsx`（如需要调整文案）
- `tests/unit/format-workflow-duration.test.ts`

### 2.6 验收标准

- 一个执行了 30 秒的工作流，卡片显示为「耗时 30 秒」或「已运行 30 秒」，而不是 0 秒
- running 和 completed 状态的时长一致（允许 1-2 秒误差）
- 刷新页面后，已 completed 的工作流时长不变
- 短任务（< 5 秒）也能正确显示耗时

---

## 三、推荐执行顺序

1. **STO-63 先修**：执行时间问题影响所有工作流，且代码链路相对集中
2. **STO-61 后修**：需要补充字段映射表，依赖产品输入

预估工作量：
- STO-63：1-1.5 天（含测试）
- STO-61：1-2 天（取决于需要补充多少字段映射）

---

## 四、待确认事项

1. STO-61：能否提供一份「后台字段名 → 中文业务名」的对照表？
2. STO-63：能否提供几个「执行时间显示错误」的具体例子（实际耗时 vs 显示耗时）？
3. 两个任务是否都要补单元测试？
