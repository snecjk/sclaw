## Context

- **memory-center-web**：`WorkflowDesignerPage` + React Flow + `NodeInspector`，API `/workflow/v1`
- **StoClaw 设计 demo**：横排卡片画布、`WorkflowNodeData` UI 模型，无持久化
- **StoClaw 已有**：`GET/POST /agent/v1/workflows/*`、启动参数表单、SSE 运行追踪

约束：不新增 npm 依赖（无 reactflow）；Renderer 走 `hostApiFetch`；主题遵循 `docs/sto-design.md`。

## Goals / Non-Goals

**Goals**
- 以 `WorkflowDefinition`（nodes/edges/config）为单一数据源
- 列表编辑打开真实 `wf_xxx`；保存草稿、发布（后端可用时）
- 左节点库 + 中画布 + 右属性面板（MC 信息架构 + STO 视觉）

**Non-Goals（v1）**
- 完整移植 MC `NodeInspector`（3900+ 行）
- AI 生成流程、版本历史、存为模板
- React Flow 级自由拓扑编辑器

## Decisions

### 1. 双编辑器并存
| 组件 | 用途 |
|------|------|
| `WorkflowBuilderDemo` | 设计稿参照；空白创建 / AI 演示 |
| `WorkflowDesigner` | 编辑已有工作流；接 API |

### 2. 画布：自研 + `config.editor.position`
复用 MC 坐标持久化约定；拖拽更新 `config.editor.position`；SVG 贝塞尔连线（参考设计 demo `workflow-canvas`）。

### 3. Adapter 层
`detailToDefinition` / `definitionFromDetail`：`WorkflowDetailResponse` ↔ `WorkflowDefinition`。

### 4. API
- `PUT /agent/v1/workflows/{id}` — 保存定义（与 MC `PUT /workflows/{id}` 语义对齐）
- `POST /agent/v1/workflows/{id}/publish` — 发布

### 5. Inspector v1
选中节点编辑：`name`、`description`、智能节点 `goal`/`instruction`（从 `config.task` 或 `config.agentConfig.task` 读取）。

## Risks / Trade-offs

- 后端 PUT/publish 未就绪时保存失败 → UI 展示 API 错误，不静默 mock
- 复杂节点配置需后续迭代 Inspector 子面板

## Migration Plan

1. 列表卡片「编辑」→ `WorkflowDesigner(workflowId)`
2. 「手动创建」/ Hero 生成 → 仍进 `WorkflowBuilderDemo`
3. 原 `WorkflowBuilder` export 指向 demo，避免破坏 import
