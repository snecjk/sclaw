## 1. OpenSpec & platform SDK

- [x] 1.1 Add change artifacts under `openspec/changes/sto-builtin-tools-platform/`
- [x] 1.2 Create `sto-plugin/sto-toolkit` (HTTP client, envelope, `defineStoTool`)

## 2. Workflow builtin tools (host-api-builtin-tools)

- [x] 2.1 Create `sto-plugin/sto-workflow-tool` with `search_workflow_templates` and `execute_workflow`
- [x] 2.2 Register plugin in `syncStoPluginsToOpenClaw` and `plugin-install`
- [x] 2.3 Add plugin unit tests
- [x] 2.4 Sync `scripts/bundle-openclaw-plugins.mjs` and `after-pack.cjs`（**PR-1**）

## 3. Frontend listener (chat-builtin-tool-listener)

- [x] 3.1 Add `use-builtin-tool-listener` hub and `workflow_execution_started` handler
- [x] 3.2 Mount listener on Chat and Home pages
- [x] 3.3 Update `TOOLS.stoclaw.md` workflow tool guidance
- [x] 3.4 Handler: `workflow_schema_ready` → `setPendingWorkflow`（表单仍由 `/` 或 model+maybeAppendWorkflowParameterForm）
- [x] 3.5 Handler: `workflow_created` → `workflow-memory`

## 4. Skill / prompt（PR-2）

- [x] 4.1 `TOOLS.stoclaw.md` 正反例（创建文件 vs 创建工作流）
- [x] 4.2 对齐 `sto-workflow-tool` `WORKFLOW_TOOL_PROMPT`
- [x] 4.3 会话 `workflow-memory` 摘要注入（`workflow-session-hint` on send）

## 5. 去掉前端抢先拦截

- [x] 5.1 **PR-3** 删除 `dispatch-chat-send` 中 `tryStartRememberedWorkflowSend`
- [x] 5.2 **PR-3** 重执行/启动意图改走模型 + session hint（保留 intent 函数供 hint 判断）
- [x] 5.3 **PR-4** 删除 `tryNaturalLanguageWorkflowSend` 与 `isNewWorkflowCreationIntent` 分支
- [x] 5.4 **PR-4** 清理 `use-workflow-intent.ts`（仅保留表单确认/会话 hint 所需）
- [x] 5.5 **PR-6** 收窄 `tryResolvePendingWorkflow`（重执行/直启改 false；保留表单确认）

## 6. 补全 workflow tools（PR-5）

- [x] 6.1 `get_workflow_schema` + `workflow_schema_ready`
- [x] 6.2 `create_workflow` + `workflow_created`
- [x] 6.3 `get_workflow_status` + `workflow_run_status`（Tracker 仍为主 UI 更新）
- [x] 6.4 更新 `sto-builtin-tools.manifest.json`

## 7. 收尾（PR-7）

- [x] 7.1 删除废弃函数与静态 `appendLocalConversationTurn` 工作流回复（PR-3/4 代码已删）
- [x] 7.2 更新 `plans/sto-builtin-tools-platform.md`、`workflow-tool-architecture.md`、`WORKFLOW-IMPLEMENTATION-SCHEME.md §14`
- [ ] 7.3 `pnpm run comms:replay` + `comms:compare`（通信路径未改，可跳过；发版前建议仍跑一遍）
- [ ] 7.4 跑 §9 手工验收用例（见 `plans/workflow-nl-to-tool-migration.md`）— **需 UI 实测**

---

**详细 PR 边界、验收、回滚**：见 [plans/workflow-nl-to-tool-migration.md](../../../plans/workflow-nl-to-tool-migration.md)
