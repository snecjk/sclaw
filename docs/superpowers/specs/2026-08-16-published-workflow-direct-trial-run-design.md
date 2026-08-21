# 已发布工作流直接试运行设计

## 目标

已发布工作流在画布没有未保存改动时，点击“试运行”直接运行当前已发布版本，不再弹出“自动保存当前画布为草稿”的确认框，也不创建无意义的草稿版本。

## 状态规则

| 画布状态 | 试运行准备行为 |
| --- | --- |
| 已发布且未编辑 | 直接使用当前已发布 `workflowVersionId` 进入启动参数确认 |
| 已发布且有编辑 | 保留保存确认，保存为草稿后运行返回的草稿版本 |
| 草稿（无论是否有编辑） | 暂时保留现有保存确认和草稿持久化行为 |
| AI 生成中、保存中或已有试运行 | 保留现有阻止和错误提示 |

## 架构

`memory-center-web` 是画布和脏状态的唯一事实来源。Web 发出 `workflow-try-run-request` 时附带运行准备模式：`use-current-published` 或 `persist-draft`。当模式为 `use-current-published` 时，请求同时携带经过 Bridge 严格校验的当前版本快照，包括工作流 ID、版本 ID、`workflow/v2`、`published` 状态和启动参数 Schema。

`sto-claw` 根据模式分流：

- `use-current-published`：不打开保存确认框、不发送 `saving` 状态，直接以快照进入启动参数和引擎选择。
- `persist-draft`：完整保留现有确认、保存请求、保存响应校验和草稿试运行链路。

Bridge 仍使用 `stoclaw-workflow-bridge/v1`，通过新增可选字段保持同版本兼容。新 Web 总是发送准备模式；新 Host 收到旧 Web 缺少该字段的请求时默认按 `persist-draft` 处理。身份、origin、source、nonce、工作流 ID 和请求 ID 的校验保持不变。

## 运行与展示

StoClaw 启动本地试运行时必须显式传入 Web 提供的已发布 `workflowVersionId`。不能省略版本号，因为后端 `trial` 模式在无显式版本时会默认查找草稿。

`isDraftSnapshot` 改为根据 `snapshot.versionStatus === "draft"` 判断，避免已发布版本被展示成“草稿试运行”。直接运行分支的 Web 顶栏状态从 `confirming` 进入 `preparing`，不会出现 `saving`。

## 后端边界

`memory-center` 不修改。现有 `start_client_workflow_register_only` 已支持 `trial` 模式显式指定已发布版本，并有 `test_start_client_workflow_trial_accepts_explicit_published_version` 覆盖。

## 错误与竞态

- 已发布快照缺少版本 ID、Schema 非 V2、状态不是 `published` 或工作流 ID 不匹配时，Host 拒绝启动并恢复 idle。
- 重复请求、旧会话消息、运行中的重复点击和 iframe 重载继续沿用现有 request ID/epoch 隔离。
- 已发布直跑失败时不得回退到保存草稿，也不得运行其他已知版本。

## 测试范围

- Web Bridge：已发布未编辑请求携带直跑快照；已发布有编辑、草稿状态仍要求保存；非法快照被拒绝。
- StoClaw：直跑请求不打开确认、不调用保存、直接调用 `beginTryRun`；保存模式保持原行为；已发布快照不标记为草稿。
- 回归：Bridge 单测、试运行 Hook 单测、类型检查、`comms:replay` 和 `comms:compare`。
