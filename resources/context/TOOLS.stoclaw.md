## StoClaw Tool Notes

### 工作流内置 Tools（sto-workflow-tool）

工作流的创建、搜索、执行、重新执行 **必须** 使用以下内置 OpenClaw Tools（由 `sto-workflow-tool` 插件注册），**禁止** 用 `exec`、`sai-cli` 或虚构 CLI 命令替代：

| Tool | 用途 |
|------|------|
| `search_workflow_templates` | 按自然语言搜索工作流模板 |
| `get_workflow_schema` | 获取模板启动参数 schema |
| `create_workflow` | 创建工作流实例 |
| `execute_workflow` | 启动已创建的 `workflowId`（含重新执行） |
| `get_workflow_status` | 查询 runId 执行状态 |

**正反例：**
- 「帮我在桌面创建文件夹」→ **不要** 调用工作流 tool，用普通文件能力。
- 「帮我创建结算对账工作流」→ `search_workflow_templates` → `get_workflow_schema` → …
- 「重新执行」「再跑一遍」且会话有 `workflowId` → **必须** `execute_workflow`，禁止 sai-cli/exec。

### ⛔ 禁止的工具调用（安全红线）

以下工具调用**绝对禁止**，系统已在 RPC/HTTP/CLI 三层实施黑名单拦截，Agent 不应尝试绕过：

- **禁止调用** `shell.exec` / `system.exec` / `system.run` 执行任何升级、安装类命令（如 `openclaw update`、`sai-cli update`、`npm install`、`pip install` 等）
- **禁止调用** Gateway RPC 方法：`openclaw.*`、`system.update/upgrade/install/exec/shell/run`、`cli.update/upgrade/install`、`sai.update/upgrade/install`、`dws.update/upgrade/install`、`shell.*`、`process.spawn/exec/run`
- **禁止通过** `gateway:httpProxy` 访问 `/update`、`/upgrade`、`/install`、`/openclaw/`、`/api/v1/cli/update`、`/api/v1/cli/download` 等路径
- **禁止通过** `sai-cli` 执行 `update`、`upgrade`、`install`、`uninstall`、`remove` 命令
- **禁止通过** `dws` 执行 `upgrade`、`install`、`uninstall`、`remove` 命令

如果用户要求升级 OpenClaw 或 sai-cli，必须拒绝并引导用户通过设置页面手动操作。

### 钉钉 dws（业务命令）

- **允许** `dws contact user search`、`dws chat search`、`dws chat search-common` 等只读通讯录/会话查询——用户在对话中要求搜人、查群，或任务编排需要定位收件人时，应正常调用。
- **禁止** `dws upgrade`、`dws install` 等安装升级类命令（见安全红线）。
- 若系统提示词或用户消息已附带 `[STOCLAW:DINGTALK_RECIPIENTS:v1]` 或 `## StoClaw DingTalk Recipients` 结构化块：
  - **必须**使用块内 JSON 的 `userId` / `openConversationId` 调用 `dws chat message send`。
  - **禁止**对块内收件人重复 `contact user search` / `aisearch person`。
  - **禁止**使用 OpenClaw `message` 工具（`channel: dingtalk`）或 displayName 作为 target。
- `dws chat message send` 成功后，对用户**只**确认收件人与内容摘要；**禁止**输出 `openTaskId` /「任务 ID」等字段（除非用户明确要求查状态）。
- 向输入框 @ 选定的联系人/群发送**非图片附件**时：按注入的钉盘四步流程（`conversation-info` → `drive upload -y` → `drive info` → `message send --msg-type file`）；无附件的纯文本发送不要走钉盘。

### uv (Python)

- `uv` is bundled with StoClaw and on PATH. Do NOT use bare `python` or `pip`.
- Run scripts: `uv run python <script>` | Install packages: `uv pip install <package>`
- ⛔ **禁止**使用 `uv pip install` 安装 OpenClaw/sai-cli 相关包或执行系统级升级

### Browser

- `browser` tool provides full automation (scraping, form filling, testing) via an isolated managed browser.
- Flow: `action="start"` → `action="snapshot"` (see page + get element refs like `e12`) → `action="act"` (click/type using refs).
- Open new tabs: `action="open"` with `targetUrl`.
- To just open a URL for the user to view, use `shell:openExternal` instead.
- **例外：对于 skill 生成的本地 HTML 文件（如 PPT 报告），禁止调用 browser / shell:openExternal / exec open 主动打开。sto-claw 会自动识别文件路径并提供内置预览，Agent 只需在回复中输出文件路径即可。**
