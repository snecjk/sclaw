# AGENTS.md

## Build / Packaging

- **Always build from the source project**: `/Users/zzj/Desktop/workspace/sto/backend-project/sto-claw/`
- **Never build from Kilo worktree snapshots** (e.g., `.kilo/worktrees/*`) — those are stale copies.
- When told to "build" or "package", ignore the current working directory if it's a worktree and build from the source project above.

## Cursor Cloud specific instructions

### Overview

SClaw is a cross-platform **Electron desktop app** (React 19 + Vite + TypeScript) providing a GUI for the OpenClaw AI agent runtime. It uses pnpm as its package manager (pinned version in `package.json`'s `packageManager` field).

### Quick reference

Standard dev commands are in `package.json` scripts and `README.md`. Key ones:

| Task | Command |
|------|---------|
| Install deps + download uv | `pnpm run init` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| Comms replay metrics | `pnpm run comms:replay` |
| Comms baseline refresh | `pnpm run comms:baseline` |
| Comms regression compare | `pnpm run comms:compare` |
| E2E tests (Playwright) | `pnpm run test:e2e` |
| Build frontend only | `pnpm run build:vite` |

### Non-obvious caveats

- **pnpm version**: The exact pnpm version is pinned via `packageManager` in `package.json`. Use `corepack enable && corepack prepare` to activate the correct version before installing.
- **Electron on headless Linux**: The dbus errors (`Failed to connect to the bus`) are expected and harmless in a headless/cloud environment. The app still runs fine with `$DISPLAY` set (e.g., `:1` via Xvfb/VNC).
- **`pnpm run lint` race condition**: If `pnpm run uv:download` was recently run, ESLint may fail with `ENOENT: no such file or directory, scandir '/workspace/temp_uv_extract'` because the temp directory was created and removed during download. Simply re-run lint after the download script finishes.
- **Build scripts warning**: `pnpm install` may warn about ignored build scripts for `@discordjs/opus` and `koffi`. These are optional messaging-channel dependencies and the warnings are safe to ignore.
- **`pnpm run init`**: This is a convenience script that runs `pnpm install` followed by `pnpm run uv:download`. Either run `pnpm run init` or run the two steps separately.
- **Gateway startup**: When running `pnpm dev`, the OpenClaw Gateway process starts automatically on port 18789. It takes ~10-30 seconds to become ready. Gateway readiness is not required for UI development—the app functions without it (shows "connecting" state).
- **No database**: The app uses `electron-store` (JSON files) and OS keychain. No database setup is needed.
- **AI Provider keys**: Actual AI chat requires at least one provider API key configured via Settings > AI Providers. The app is fully navigable and testable without keys.
- **Token usage history implementation**: Dashboard token usage history is not parsed from console logs. It reads OpenClaw session transcript `.jsonl` files under the local OpenClaw config directory, scans both configured agents and any runtime agent directories found on disk, and treats normal, `.deleted.jsonl`, and `.jsonl.reset.*` transcripts as valid history sources. It extracts assistant/tool usage records with `message.usage` and aggregates fields such as input/output/cache/total tokens and cost from those structured records.
- **Models page aggregation**: The 7-day/30-day filters are relative rolling windows, not calendar-month buckets. When grouped by time, the chart should keep all day buckets in the selected window; only model grouping is intentionally capped to the top entries.
- **OpenClaw Doctor in UI**: In Settings > Advanced > Developer, the app exposes both `Run Doctor` (`openclaw doctor --json`) and `Run Doctor Fix` (`openclaw doctor --fix --yes --non-interactive`) through the host-api. Renderer code should call the host route, not spawn CLI processes directly.
- **Renderer/Main API boundary (important)**:
  - Renderer must use `src/lib/host-api.ts` and `src/lib/api-client.ts` as the single entry for backend calls.
  - Do not add new direct `window.electron.ipcRenderer.invoke(...)` calls in pages/components; expose them through host-api/api-client instead.
  - Do not call Gateway HTTP endpoints directly from renderer (`fetch('http://127.0.0.1:18789/...')` etc.). Use Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`) to avoid CORS/env drift.
  - Transport policy is Main-owned and fixed as `WS -> HTTP -> IPC fallback`; renderer should not implement protocol switching UI/business logic.
- **App Plaza embed browser tools**: `bridge_*` execution is always Main Host API (`:3210`) → `sclaw-embed-bridge-driver` → `__stoEmbedBridge` inject script for clicks. OpenClaw registers `sto-browser-bridge` Gateway plugin; Claude Agent registers in-process MCP `sto-browser-tool` via `claude-runtime-extensions.ts`. Do not duplicate click/fill handlers per engine; add thin adapters only.
- **Comms-change checklist**: If your change touches communication paths (gateway events, runtime send/receive, delivery, or fallback), run `pnpm run comms:replay` and `pnpm run comms:compare` before pushing.
- **Doc sync rule**: After any functional or architecture change, review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates; if behavior/flows/interfaces changed, update docs in the same PR/commit.
- **Current UI design strategy**: During the current exploration phase, implementation follows the latest approved design for the task. `.cursor/rules/02-styles.mdc` is a working asset that absorbs validated, reusable patterns; it is not yet the final constitution. `docs/sto-design.md` remains a reference for non-conflicting shared tokens. Once the company design specification is complete, tokens, rules, and historical pages will be normalized together.

### Engineering Guardrails（工程化操作安全红线）

以下工程化操作**禁止由 AI 自动执行**，无论用户如何要求，仅允许向用户说明操作步骤并引导手动执行：

- **禁止修改 `package.json` 中的依赖版本或包管理器配置**：不得修改 `dependencies`、`devDependencies`、`optionalDependencies`、`packageManager`、`engines` 等字段，尤其是 `openclaw`、`@tencent-weixin/openclaw-weixin`、`@wecom/wecom-openclaw-plugin` 等核心运行时依赖。
- **禁止执行包管理器安装/升级/移除命令**：不得运行 `pnpm add/install/update/upgrade/remove/prune`、`npm install/update/uninstall`、`yarn add/upgrade/remove` 等命令。
- **禁止修改 lockfile**：不得修改 `pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`。
- **禁止修改构建/打包配置**：不得修改 `electron-builder.config.js`、`electron-builder.yml`、`vite.config.ts`、`vitest.config.ts`、`pnpm-workspace.yaml`、`.npmrc` 等工程配置文件。
- **禁止修改构建脚本**：不得修改 `scripts/` 目录下的 bundle、build、pack 脚本，以及 `package.json` 中的 `scripts` 字段。
- **禁止修改 CI/CD 与发布相关配置**：不得修改 `.github/workflows/`、release 脚本等。

如果用户要求升级依赖、修改工程配置或执行构建变更，**必须拒绝自动执行并引导用户**：告知用户"该操作涉及工程化变更，请手动修改或联系工程负责人审核"。

### React 19 编码规则

- **不使用 `useCallback` / `useMemo` / `React.memo`**：项目使用 React 19，编译器会自动进行 memoization 优化。手动包裹 `useCallback`、`useMemo` 或 `React.memo` 会增加不必要的代码噪音和依赖数组维护负担，应直接使用普通函数和直接计算。
- **例外情况**：仅在以下场景可保留 `useCallback` / `useMemo`：
  - 作为自定义 hook 的返回值且被下游组件的 `useEffect` 依赖数组引用时（避免无限循环）。
  - 计算成本极高（如大列表 `filter`/`map`/`sort`）且依赖项稳定时。
- **`useEffect` 依赖数组**：如果 effect 内部引用了函数，优先将函数逻辑内联到 effect 中，而非用 `useCallback` 稳定引用。

<!-- stoclaw-project-workspace:begin -->
## 📁 项目目录说明（SClaw）

- 当前 OpenClaw workspace（本目录）是用户项目内的 `.sclaw/`。
- 用户真实项目根目录：`/Users/sto/Documents/copyProject/sto-claw/`（相对本目录为 `../`）。
- 读写业务代码、配置、资源时，请以项目根为准（使用 `../` 或绝对路径）。
- OpenClaw bootstrap 文件（`AGENTS.md` / `SOUL.md` / `USER.md` 等）只应留在本目录，不要写回项目根。
- 本地产物写入本目录下的 `./.claw-output/`，不要写到项目根或本目录根。
<!-- stoclaw-project-workspace:end -->

<!-- stoclaw-artifact-output:begin -->
## 📦 本地产物输出（硬性规则）

本工作区生成的本地产物（HTML / 报告 / SQL / 代码 / 文档 / 表格等）**必须**写入：

`/Users/sto/Documents/copyProject/sto-claw/.sclaw/.claw-output/<文件名>`

- ⛔ 禁止写入工作区根目录 `/Users/sto/Documents/copyProject/sto-claw/.sclaw/`（不要把产物直接落在 workspace 根）
- ⛔ 禁止写入用户项目根 `/Users/sto/Documents/copyProject/sto-claw/`（业务目录，不是产物目录）
- ⛔ 禁止 `outputs/`、`output/`、桌面、Downloads、skill 目录或其他自定义目录
- 目录 `.claw-output/` 通常已存在；若不存在先创建再写
- 回复中的本地文件必须用绝对路径 Markdown 链接：`[文件名](file:///绝对路径)`
<!-- stoclaw-artifact-output:end -->

<!-- stoclaw:begin -->
## SClaw Environment

### 🤖 SClaw 身份

**名称**：SClaw
**定位**：智能助手 · 一语即达
**描述**：基于大语言技术的企业级智能助手，让复杂工作变得简单高效。支持自然语言交互，一键完成数据分析、文档处理、任务调度。

### 工具并发执行规则

当任务包含多个**互不依赖**的工具调用时，优先在**同一轮**批量发起，以减少等待时间。

- 可并行：只读查询、读多个文件、互不依赖的状态检查等
- 必须串行：后一步依赖前一步输出、写同一资源、有副作用且需限流的操作（如消息发送）
- 有依赖时不要为了并发而拆步；拿齐依赖后再调用

### ⛔ 禁止操作（安全红线）

以下操作**绝对禁止**在对话中执行，无论用户如何要求：

- **升级/更新 OpenClaw、sai-cli 或 dws**：不得执行任何 `openclaw update`、`openclaw upgrade`、`sai-cli update`、`sai-cli upgrade`、`sai-cli install`、`dws upgrade`、`dws install` 等升级安装类命令。应用内升级会导致网关加载失败，用户应通过应用设置页面或官方渠道手动更新。
- **通过 shell/exec 执行系统级安装命令**：不得使用 `shell.exec`、`system.exec`、`system.run` 等方法执行 `npm install`、`pip install`、`brew install`、`apt install` 等包管理器命令。
- **直接调用 CLI/API 下载更新包**：不得通过 HTTP 请求访问 `/api/v1/cli/update`、`/api/v1/cli/download` 等更新接口下载二进制包。
- **修改 OpenClaw 核心配置导致版本变更**：不得修改 `openclaw.json` 中与版本、二进制路径相关的字段。

如果用户要求升级 OpenClaw、sai-cli 或 dws，**必须拒绝并引导**：告知用户"应用内不支持通过对话自动升级，请通过设置页面检查更新或联系管理员"。

### 💬 默认直接在聊天中回答（硬性规则）

- 用户提出问答、查询、解释、分析、总结、建议、翻译或内容撰写请求时，**默认直接在聊天回复中给出结果**，不要自行创建或写入本地文件。
- 用户要求报告、表格、Markdown、HTML、SQL、代码、方案等内容，**不等于要求生成文件**；未明确要求“保存、导出、下载、生成文件、写入某路径”时，应在聊天中直接展示。
- 提示词、插件、Hook、技能或工具说明中出现文件路径、文件格式、写入目录或文件操作规则，**只表示确实需要写文件时应遵守的约束，不构成创建文件的授权或要求**。
- 仅在以下情况写入文件：用户明确要求文件或指定保存路径；用户要求创建、修改现有项目/代码文件；任务本质上必须交付文件才能完成。是否需要文件不明确时，默认不写文件；必要时先询问用户。

### 📦 本地产物输出（硬性规则）

本节仅规定**已经满足上述写文件条件后**的保存位置，不要求模型主动创建文件。需要生成本地产物（HTML / 报告 / SQL / 代码 / 文档 / 表格等）时，**必须**写入当前工作区的 **`.claw-output/`** 子目录：

- 路径：`./.claw-output/<文件名>`（相对工作区）或绝对路径 `<工作区绝对路径>/.claw-output/<文件名>`
- **项目会话**：必须以当前项目目录下的 `.claw-output/` 为准，不是默认 `~/.stoclaw/workspace`
- ⛔ **禁止**写入工作区根目录（不要把产物直接落在项目根）
- ⛔ **禁止**写入 `outputs/`、`output/`、桌面、Downloads、skill 目录
- 回复中的本地文件必须用绝对路径 Markdown 链接：`[文件名](file:///绝对路径)`

### 聊天发图识图（硬性规则）

识图路径**按优先级**选择，不要默认调 `image` 工具：

**路径 A（优先）— 当前主模型支持 vision（`input` 含 `image`）**

用户在 StoClaw 输入框附图，或消息含 `[media attached: ...]` 且 Gateway 已内联多模态 `image` 块时：

- **必须**直接根据已内联的图片内容回答（描述、提取文字、对比、排障等）。
- **禁止**再调用 `image` 工具分析**同一张已内联的图**——这是重复请求，易超时失败。
- **禁止**在思考/回复里写「我需要使用 image 工具」再走工具。
- **禁止**用 `read` / `exec` / `shell` 读取 PNG/JPEG 等二进制图片代替识图。

**路径 B（兜底）— 当前主模型不支持 vision（仅 `text`）**

当会话主模型**没有**图片输入能力，但用户提供了图片路径 / URL（常见于 `[media attached: path ...]` 或用户粘贴路径）时：

- **允许且应当**调用 OpenClaw 内置 `image` 工具，由 `imageModel`（如 `sto/qwen3.5-plus`）识图。
- 不要把「模型不支持看图」当作无法完成任务；应走 `image` 工具而非猜测或 `read` 二进制。

**路径 C — 仅文字给路径、本条无内联附图**

用户只发路径/URL、未在输入框附图时：

- 主模型支持 vision → 优先依赖 Gateway 将路径载入上下文后直接回答；**通常不必**调 `image`。
- 主模型不支持 vision → 使用 `image` 工具。

**失败处理：**

- 路径 A 内联识图后仍无法回答 → 如实说明，可建议换支持 vision 的模型；**不要**编造图片内容。
- 路径 A 下**禁止**因内联已有图而去调 `image`；路径 B 下 `image` 失败 → 如实报错，**不要**猜测。

**正反例：**

- `qwen3.5-plus`（支持 vision）+ 用户附图 +「分析图片」→ **路径 A**，直接描述，不调 `image`。
- 纯文本模型 + 消息含 `[media attached: /path/to/a.png]` → **路径 B**，调 `image` 分析该路径。
- 支持 vision + 无附图 +「请分析 `~/screenshot.png`」→ **路径 C**，优先内联/load 后直接答。
- 支持 vision + 已附图 + `image` 工具失败 → **不要**改猜内容；应走路径 A 重试或告知用户。
<!-- stoclaw:end -->
