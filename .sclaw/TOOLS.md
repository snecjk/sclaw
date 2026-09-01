# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

<!-- stoclaw:begin -->
## SClaw Tool Notes

### 用户技能保存（save_user_skill，硬性规则）

会话中**创建或更新用户自定义技能**时，**必须**调用内置工具 `save_user_skill`（OpenClaw 插件 / Claude MCP），将完整 `SKILL.md` 写入当前登录用户的 skills-store。

| Tool | 用途 |
|------|------|
| `save_user_skill` | 保存/覆盖用户技能到 `skills-store/users/{工号}/skills/{slug}/`，使其出现在「我的技能」 |

**必须遵守：**

- 传入完整 `skillMd`（含 YAML frontmatter 的 `name` + `description`）与合法 `slug`
- ⛔ **禁止**用 `write` / `edit` / `apply_patch` / Bash 写到 `openclaw/skills`、`workspace/skills`、`skills-store`（**系统会拦截**）；那样也不会进入「我的技能」
- 被拦截后请直接改调 `save_user_skill`，不要换工具绕过
- 系统预装白名单 slug（如 `sai-cli`）不可覆盖
- 未登录时工具会报错，不要改写到 global

### 工作流内置 Tools（sto-workflow-tool）

工作流的创建、搜索、执行、重新执行 **必须** 使用以下内置 OpenClaw Tools（由 `sto-workflow-tool` 插件注册），**禁止** 用 `exec`、`sai-cli` 或虚构 CLI 命令替代：

| Tool | 用途 |
|------|------|
| `search_workflow_templates` | 按自然语言搜索工作流模板 |
| `get_workflow_schema` | 获取模板启动参数 schema |
| `execute_workflow` | 启动已创建的 `workflowId`（含重新执行） |
| `get_workflow_status` | 查询 runId 执行状态 |

**正反例：**
- 「帮我在桌面创建文件夹」→ **不要** 调用工作流 tool，用普通文件能力。
- 「帮我创建结算对账工作流」→ `search_workflow_templates` → `get_workflow_schema` → **客户端自动弹出分步表单**；正文仅业务摘要，**禁止**列举字段 key/参数表
- 「重新执行」「再跑一遍」且会话有 `workflowId` → **必须** `execute_workflow`，禁止 sai-cli/exec。

### 图片识图与 `image` 工具（硬性规则）

**总原则：优先用当前主模型的内联 vision；仅当主模型不具备识图能力时，才用 `image` 工具。**

StoClaw 聊天发图时，客户端会把图片内联进用户消息（多模态 `image` 块 + `[media attached: path (mime) | path]`）。是否调 `image` 工具取决于**当前主模型是否支持 `image` 输入**（见 `models.providers.*.models[].input` 或会话模型能力），不是取决于用户是否说了「分析图片」。

| 主模型 vision | 用户消息 | 正确做法 |
|---------------|----------|----------|
| **支持**（如 `sto/qwen3.5-plus`，`input` 含 `image`） | 已附图 / 已内联 `image` 块 | **直接看图回答**；**禁止**对同一张图再调 `image` |
| **不支持**（仅 `text`） | 有图片路径 / `[media attached: ...]` | **必须**调 `image` 工具（`imageModel` + `sto-media-understanding`） |
| **支持** | 仅文字 + 路径/URL，无内联附图 | 优先 Gateway 载入后直接答；通常不调 `image` |
| **不支持** | 仅文字 + 路径/URL | **调 `image` 工具** |
| 任意 | 用户明确要求对**无内联附图**的磁盘文件用 `image` 分析 | 可调 `image`（即使主模型支持 vision） |

**必须遵守：**

- 主模型**已支持 vision 且消息已内联附图** → 路径 A，**不要**调 `image`（避免重复识图、超时、`Request was aborted`）。
- 主模型**不支持 vision** → 路径 B，**不要**假装能看图；用 `image` 工具处理 `[media attached: path]` 中的路径。
- **不要**用 `read` 读二进制图片代替识图。
- 任一路径识图失败 → 如实告知；**禁止**根据缩略图或会话上下文猜测内容。

**正反例：**

- `qwen3.5-plus` + 附图 +「分析下这个图片」→ 直接输出分析；日志中不应出现 `[tools] image`。
- 纯文本模型 + `[media attached: ~/.stoclaw/.../a.png]` → 调 `image`，参数用该路径。
- `qwen3.5-plus` + 无附图 +「用 image 工具看某路径」→ 可按用户要求调 `image`；若用户未指定工具，则优先直接 load 路径识图。
- 支持 vision + 已附图 + 内联识图说不清 → 说明失败或换模型，**不要**再调 `image` 分析同一张已内联图。

### ⛔ 禁止的工具调用（安全红线）

以下工具调用**绝对禁止**，系统已在 RPC/HTTP/CLI 三层实施黑名单拦截，Agent 不应尝试绕过：

- **禁止调用** `shell.exec` / `system.exec` / `system.run` 执行任何升级、安装类命令（如 `openclaw update`、`sai-cli update`、`npm install`、`pip install` 等）
- **禁止调用** Gateway RPC 方法：`openclaw.*`、`system.update/upgrade/install/exec/shell/run`、`cli.update/upgrade/install`、`sai.update/upgrade/install`、`dws.update/upgrade/install`、`shell.*`、`process.spawn/exec/run`
- **禁止通过** `gateway:httpProxy` 访问 `/update`、`/upgrade`、`/install`、`/openclaw/`、`/api/v1/cli/update`、`/api/v1/cli/download` 等路径
- **禁止通过** `sai-cli` 执行 `update`、`upgrade`、`install`、`uninstall`、`remove` 命令
- **禁止通过** `dws` 执行 `upgrade`、`install`、`uninstall`、`remove` 命令

如果用户要求升级 OpenClaw 或 sai-cli，必须拒绝并引导用户通过设置页面手动操作。

### 📦 本地产物写入路径（硬性规则）

使用 `write` / 保存文件类工具生成本地产物时：

- **必须**写入当前 workspace 的 `./.claw-output/<文件名>`（项目会话 = 项目目录下的 `.claw-output/`）
- ⛔ **禁止**写到工作区根目录、`outputs/`、`output/`、桌面、Downloads、skill 目录
- 目录通常已存在；若不存在先创建再写
- 回复中引用本地产物时输出绝对路径 `file:///` Markdown 链接，禁止相对路径

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
<!-- stoclaw:end -->
