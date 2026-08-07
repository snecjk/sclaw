## Why

工作流交付节点当前要求模型把完整文件正文内联到 WorkflowPacket payload，再由客户端写出同内容文件。正文因此重复进入结构化输出、节点记录、同步 outbox 和下游提示词，显著增加 token、传输和执行耗时，并把 HTML 作为工程特例固化在通用协议中。

## What Changes

- 工作流智能节点改为 artifact-first：模型先在节点工作区创建文件，再用相对 `resourceId` 声明产物。
- 产物格式由任务和模型决定，客户端不设置扩展名或 MIME 白名单。
- 客户端校验工作区边界并补齐稳定 artifact 元数据；持久化和下游传递不再包含文件正文。
- 超过 1024 UTF-8 字节的可交付文本必须文件化，小型结构化 payload 仍可直接传递。
- 删除 HTML 专用 schema、物化和终端提升逻辑，终端节点统一复用上游 OUTPUT artifacts。
- 精简 Claude/OpenClaw 节点提示词，避免重复模板与大正文 StructuredOutput。

## Capabilities

### New Capabilities

- `workflow-artifact-output`: 定义模型产物声明、客户端规范化、安全校验、大文本外置和格式无关的节点间传递。

### Modified Capabilities

- None.

## Impact

- Main process workflow runtime packet validation, prompt building, retry coordination, artifact persistence, terminal output handling and telemetry.
- Existing workflows using `payload.html` switch immediately to artifact references; no feature flag or inline-body compatibility is retained.
- Workflow runtime documentation and regression coverage.

