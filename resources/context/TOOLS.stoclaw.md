## StoClaw Tool Notes

### ⛔ 禁止的工具调用（安全红线）

以下工具调用**绝对禁止**，系统已在 RPC/HTTP/CLI 三层实施黑名单拦截，Agent 不应尝试绕过：

- **禁止调用** `shell.exec` / `system.exec` / `system.run` 执行任何升级、安装类命令（如 `openclaw update`、`sai-cli update`、`npm install`、`pip install` 等）
- **禁止调用** Gateway RPC 方法：`openclaw.*`、`system.update/upgrade/install/exec/shell/run`、`cli.update/upgrade/install`、`sai.update/upgrade/install`、`shell.*`、`process.spawn/exec/run`
- **禁止通过** `gateway:httpProxy` 访问 `/update`、`/upgrade`、`/install`、`/openclaw/`、`/api/v1/cli/update`、`/api/v1/cli/download` 等路径
- **禁止通过** `sai-cli` 执行 `update`、`upgrade`、`install`、`uninstall`、`remove` 命令

如果用户要求升级 OpenClaw 或 sai-cli，必须拒绝并引导用户通过设置页面手动操作。

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
