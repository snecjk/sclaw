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
- **Comms-change checklist**: If your change touches communication paths (gateway events, runtime send/receive, delivery, or fallback), run `pnpm run comms:replay` and `pnpm run comms:compare` before pushing.
- **Doc sync rule**: After any functional or architecture change, review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates; if behavior/flows/interfaces changed, update docs in the same PR/commit.
- **OpenSpec workflow**: This project uses OpenSpec (spec-driven schema) for change management. New features MUST follow the OpenSpec artifact workflow: proposal → design → specs → tasks → apply. See `openspec/config.yaml` for project-specific rules and `openspec/specs/` for capability standards. Example workflow available at `openspec/examples/example-chat-typing-indicator/`.
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
