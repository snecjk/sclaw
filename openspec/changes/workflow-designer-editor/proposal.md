## Why

StoClaw 工作流页已有设计稿静态编辑器（`WorkflowBuilder`）和完整的执行链路（模板、启动、SSE），但缺少基于真实 `WorkflowDefinition` 的可视化设计能力。memory-center-web 已验证 Agent 工作流 IDE 模式，需要在 Claw 内落地同等核心能力，同时保留设计 demo 作为 UI 参照。

## What Changes

- 新增 `WorkflowDesigner` 真实编辑器：加载/编辑/保存/发布工作流图（对齐 memory-center 数据模型）
- 将原 `WorkflowBuilder` 重命名为 `WorkflowBuilderDemo`，仅作设计参照与空白/AI 演示入口
- 扩展 `workflow-api` 与 Electron 代理：工作流定义 PUT、发布
- 工作流列表「编辑」进入 `WorkflowDesigner`（按 `workflowId`）
- 画布采用自研 SVG（不引入 reactflow 依赖），布局与 STO 主题壳层结合设计稿

## Capabilities

### New Capabilities
- `workflow-designer-editor`: 工作流可视化设计、节点库、属性编辑、草稿保存与发布、编辑器内试运行入口

### Modified Capabilities
<!-- 无 openspec/specs 主规格变更；执行侧沿用既有 chat-workflow 能力 -->

## Impact

- `src/pages/WorkflowDesigner/`：新模块
- `src/pages/WorkflowBuilder/components/workflow-builder-demo.tsx`：设计参照保留
- `src/pages/Workflow/index.tsx`：路由视图分流（demo vs designer）
- `src/lib/workflow-api.ts`、`electron/api/routes/workflows.ts`：写接口代理
- `docs/sto-design.md`：编辑器壳层沿用 `workflowBuilderShell` 等既有 token
