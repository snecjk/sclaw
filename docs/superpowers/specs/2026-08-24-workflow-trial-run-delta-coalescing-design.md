# 工作流试运行流式输出聚合设计

日期：2026-08-24

## 目标

修复工作流试运行“执行过程”把同一段 Agent 流式回答拆成大量 `agent.answer_delta` 节点的问题。底层继续逐条保存审计事件，展示层将连续文本增量投影为一个可读的“实时输出”时间线项。

## 问题与根因

Claude 与 OpenClaw 工作流运行器实际产生 `agent.answer_delta`。事件经工作流运行时逐条写入 `wf_event`，再由 detail 查询原样返回给 renderer。

`src/pages/WorkflowDesigner/components/test-run-drawer-model.ts` 目前只映射和聚合 `agent.output.delta`。生产链路没有产生该名称，因此每个真实 delta 都被当成未知事件：标题回退为原始类型名，内容显示单次 `payload.message`，最终形成大量同名碎片节点。

## 方案比较

### 方案 A：展示适配层兼容并聚合（采用）

在 `buildTrialRunTimeline` 中同时识别 `agent.answer_delta` 与历史兼容名称 `agent.output.delta`，只改变时间线投影。

- 优点：改动小；历史记录立即生效；不改变运行时、数据库、IPC 或云同步契约。
- 代价：展示层继续承担原始事件到用户语义的适配职责。

### 方案 B：在 Main 到 Renderer 的 mapper 中统一改名

将 `agent.answer_delta` 映射为 `agent.output.delta` 后再返回 renderer。

- 优点：renderer 只看到一种名称。
- 缺点：detail 数据不再忠实反映审计事件；诊断视图和其他消费者可能混淆原始协议与展示协议。

### 方案 C：修改运行时生产事件名

让 Claude 与 OpenClaw 运行器改发 `agent.output.delta`。

- 优点：新事件与当前展示层一致。
- 缺点：会改变持久化与同步协议；旧历史仍需兼容；影响两个运行器及其他事件消费者，超出本次最小修复范围。

## 设计

### 变更范围

仅修改：

- `src/pages/WorkflowDesigner/components/test-run-drawer-model.ts`
- `tests/unit/test-run-drawer-model.test.ts`

如验证发现共享抽屉组件需要补充行为级断言，可仅增加 `tests/unit/test-run-drawer.test.tsx` 测试，不改变组件结构或样式。

不修改：

- Claude/OpenClaw 运行器
- `wf_event` 表和历史数据
- IPC、Host API、outbox 或云同步
- 时间线视觉结构、状态文案和产物展示

### 事件识别

展示模型把以下两种类型都视为 Agent 文本增量：

- `agent.answer_delta`：当前本地运行时的真实类型
- `agent.output.delta`：保留兼容的旧/外部类型

两者统一显示为“实时输出”。未知事件仍按现有规则展示，不在本次修复中扩展其他事件映射。

### 聚合边界

只合并满足以下条件的相邻增量：

1. 当前事件与前一个时间线项均为 Agent 文本增量；
2. 两个事件属于同一 `nodeId`，或双方均没有 `nodeId`；
3. 中间没有工具调用、重试、节点状态或其他事件。

因此工具调用、`agent.attempt.*`、`node.*` 和 `workflow.*` 会自然切断文本段。工具前后的回答分别保留为两个“实时输出”项，不会跨语义边界拼接。

### 文本合并

每个真实 delta 的 payload 通常同时包含：

- `message`：当前片段或上游快照
- `rawText`：运行器维护的累计文本

聚合器按 `nodeId` 记录上一条文本增量的非空 `rawText`。当新的 `rawText` 以旧值为前缀时，只取新增后缀作为本次文本；当它不是旧值的延伸时，将其视为一次新的完整文本。这样既能处理 Claude 的普通增量，也能处理 OpenClaw 可能返回的累计快照，并且工具事件切断展示分段时不会把工具前全文重复带入新分段。

`agent.attempt.start` 会清除该节点的累计文本基线，避免重试的新回答被误判为上一轮的延伸。工具事件只切断展示分段，不清除累计基线，因为同一次 Agent 调用在工具前后仍可能共用累计 `rawText`。

当事件没有 `rawText` 时，回退到兼容逻辑：如果当前 `message` 已经以现有分段文本开头，将其视为累计快照并替换；否则把 `message` 或字符串 payload 追加到已有文本。首个增量使用当前文本初始化内容。

聚合后的时间使用最后一个 delta 的时间，保持现有行为；时间显示精度仍为秒，本次不调整。

### 完成态全文回退

现有逻辑在时间线中没有“实时输出”时才追加 `lastAgentRawText`。真实 `agent.answer_delta` 被正确映射后，该回退不会再额外追加重复全文。

如果一次运行没有任何文本增量事件，仍保留 `lastAgentRawText` 回退，以兼容缺少流式事件的历史记录。

## 数据流

底层数据流保持不变：

`Agent stream → agent.answer_delta → wf_event → detail hydration → run.events`

仅最后一步展示投影发生变化：

`run.events → 识别文本增量 → 按节点和相邻事件聚合 → TrialRunTimelineItem[]`

## 测试

先新增会失败的真实契约用例，再实现修复：

1. 两个连续 `agent.answer_delta` 合并成一个“实时输出”。
2. 从后一事件的累计 `rawText` 计算新增后缀，不产生重复文本。
3. 工具事件切断展示聚合，但保留累计文本基线，工具前后形成两个不重复的输出段。
4. 不同 `nodeId` 的相邻 delta 不合并。
5. `agent.attempt.start` 清除同一节点的累计文本基线。
6. `agent.output.delta` 继续兼容。
7. 存在真实 delta 时不再追加重复的 `lastAgentRawText`。

聚焦验证命令：

```bash
pnpm exec vitest run tests/unit/test-run-drawer-model.test.ts tests/unit/test-run-drawer.test.tsx
pnpm run typecheck
```

本次不触及通信路径、运行时发送或 fallback，因此无需运行 comms replay/compare。

## 文档影响

该变更恢复既有试运行展示语义，不新增用户流程、接口或配置。实施完成后仍需按项目规则复核 `README.md`、`README.zh-CN.md` 与 `README.ja-JP.md`；预期无需更新。

## 验收标准

- 截图中连续的 `agent.answer_delta` 碎片收敛为一个“实时输出”项。
- 文本顺序完整，无累计快照重复。
- 工具、重试和工作流节点事件仍独立展示。
- 历史记录、实时试运行和完成通知打开的共享结果抽屉表现一致。
- 不修改或迁移任何已有运行事件数据。
- 聚焦测试和 TypeScript 检查通过。
