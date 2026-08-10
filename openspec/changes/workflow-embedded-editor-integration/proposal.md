## Why

StoClaw 当前把 `memory-center-web` 工作流设计器嵌入 iframe，同时由宿主和 Web 各渲染一条工作流顶栏，造成返回、标题、版本及操作入口重复。现有“试运行”又只读取 iframe 当前版本 ID，不会先持久化用户正在查看的画布，可能运行旧草稿。

需要按 MasterGo 工作流画布设计统一嵌入态导航归属，并建立“确认 → 保存当前草稿 → 按保存后的版本 ID 本地试运行”的跨端契约，让所见画布与实际运行版本一致。

## What Changes

- 由 `memory-center-web` 独占嵌入态工作流业务顶栏，按 MasterGo 节点 `48:45962` 使用单条 52px 顶栏
- StoClaw 隐藏重复的工作流标题、试运行、本地记录和浏览器打开入口，但继续拥有原生窗口控制与本地运行界面
- Web 顶栏仅在 StoClaw 能力握手成功后显示“试运行”；浏览器独立访问不显示该入口
- 点击试运行后保留宿主确认弹窗；确认后 Web 强制保存当前画布，再把服务端确认的草稿版本 ID 返回宿主
- 沿用 `memory-center` 现有草稿模型：已有草稿时覆盖更新，已发布版本首次保存时创建新草稿
- 扩展受 `origin`、iframe source、nonce、workflow ID 和 request ID 约束的 iframe bridge，并加入能力握手、状态同步、去重、超时和取消规则
- 返回操作先由 Web 执行未保存/未发布草稿检查，再通知 StoClaw 路由返回
- 顶栏和全部交互状态遵循 `docs/sto-design.md` 的语义 Token，并覆盖浅色和深色主题

## Capabilities

### New Capabilities

- `workflow-embedded-editor-integration`: StoClaw 与 memory-center-web 之间的单顶栏、草稿持久化后试运行、返回导航和安全 bridge 协作

### Modified Capabilities

<!-- No existing base capabilities modified -->

## Impact

- `sto-claw/src/lib/workflow-iframe-bridge.ts`: bridge 消息、能力与校验
- `sto-claw/src/pages/Workflow/components/workflow-mc-iframe-editor.tsx`: 握手、保存请求、事件回调、超时和取消
- `sto-claw/src/pages/Workflow/workflow-routes.tsx`: 确认、保存后试运行和状态同步
- `sto-claw/src/components/layout/` 与工作流 ContentHeader 注册：嵌入编辑器顶栏归属和跨平台窗口控制
- `memory-center-web/src/agent-workflow/pages/WorkflowDesignerPage.tsx`: 单顶栏、自动保存、嵌入态试运行与返回请求
- `memory-center-web` 工作流 bridge hook、顶部栏样式及测试
- `memory-center`: 复用现有 `PUT /workflow/v1/workflows/{workflow_id}`，原则上只补契约测试，不新增生产接口
- `README.md`、`README.zh-CN.md`、`README.ja-JP.md`: 实现阶段评估是否需要同步嵌入式编辑器行为说明
