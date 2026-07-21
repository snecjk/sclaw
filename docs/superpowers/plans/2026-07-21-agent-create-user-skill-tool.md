# Agent save_user_skill Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-engine `save_user_skill` tool that always persists conversation-created skills under `~/.stoclaw/skills-store/users/{userCode}/skills/`, so they appear in「我的技能」and can be managed.

**Architecture:** Shared Main service validates + stages + `SkillManager.installFromLocalDir({ scope: 'user', source: 'local' })` → OpenClaw plugin `registerTool` + Claude MCP wrapper → optional debounced orphan import from unmanaged engine/workspace skill dirs → prompt hints in TOOLS/AGENTS.

**Tech Stack:** TypeScript, Electron Main, OpenClaw Gateway plugins, Claude Agent SDK MCP, Vitest, existing SkillManager / adapters.

**Design:** [docs/superpowers/specs/2026-07-21-agent-create-user-skill-tool-design.md](../specs/2026-07-21-agent-create-user-skill-tool-design.md)

## Global Constraints

- Canonical write target is only `skills-store/users/{currentUserCode}/skills/{slug}/` — never global for this tool.
- `userCode` comes only from `getCurrentActiveUserCode()`; callers cannot override.
- Reject slugs in `readPreinstalledManifestSlugs()`.
- Do not block chat send path; tool runs only when invoked; fallback scan is debounced and bounded.
- OpenClaw uses `api.registerTool` (not MCP); Claude uses MCP injection pattern like workflow tools.
- Reuse `SkillManager.installFromLocalDir` / `fanOut` — do not duplicate projection logic.
- Follow AGENTS.md: no renderer direct Gateway HTTP; plugins stay in Main/Gateway host.

## File map

| File | Responsibility |
|------|----------------|
| `electron/services/skills/create-user-skill.ts` | Validate, stage, call SkillManager, return result DTO |
| `tests/unit/create-user-skill.test.ts` | Pure + filesystem unit tests |
| `sto-plugin/openclaw/sto-user-skill-tool/` | OpenClaw `save_user_skill` registration |
| `sto-plugin/claude/sto-user-skill-tool/` | Claude MCP `save_user_skill` |
| `electron/engines/claude-runtime-extensions.ts` | Register Claude MCP extension |
| `electron/services/skills/orphan-skill-import.ts` | Debounced scan + import unmanaged skill dirs |
| `resources/context/TOOLS.stoclaw.md` | Instruct models to use the tool |
| Workspace AGENTS bootstrap (if templated) | Same guidance |
| Plugin install / openclaw-auth allowlist | Enable plugin like workflow tool |

---

### Task 1: Shared `create-user-skill` service + unit tests

**Files:**
- Create: `electron/services/skills/create-user-skill.ts`
- Create: `tests/unit/create-user-skill.test.ts`
- Modify: `electron/services/skills/skill-manager.ts` only if `installFromLocalDir` needs `force` / clearer errors (prefer extend params over fork)

- [ ] Define types: `SaveUserSkillInput`, `SaveUserSkillResult`, error codes (`NOT_LOGGED_IN`, `INVALID_SLUG`, `INVALID_SKILL_MD`, `PREINSTALL_PROTECTED`, `ALREADY_EXISTS`, `WRITE_FAILED`)
- [ ] Implement `normalizeSkillSlug(raw: string): string` (lowercase, non `[a-z0-9-]` → `-`, trim hyphens)
- [ ] Implement `validateSkillMd(content: string)` requiring frontmatter `name` + `description` (reuse frontmatter helpers under `electron/utils/skill-frontmatter.ts` / `skill-package.ts` where possible)
- [ ] Implement `saveUserSkill(input)`:
  - Resolve `userCode` via `getCurrentActiveUserCode()`; throw/return `NOT_LOGGED_IN` if null
  - Reject whitelist via `readPreinstalledManifestSlugs()`
  - If `force === false` and user entry/dir exists → `ALREADY_EXISTS`
  - Write staging dir under `os.tmpdir()` / openclaw config temp: `SKILL.md` + assets (block `..`)
  - Call `getSkillManager().installFromLocalDir({ slug, sourceDir, scope: 'user', source: 'local', version, name, description, enabled: true })`
  - Clean staging in `finally`
  - Return `{ ok, slug, scope: 'user', userCode, storePath, source: 'local' }`
- [ ] Unit tests with mocked paths / temp skills-store root (mirror `tests/unit/skills-lifecycle-adapters.test.ts` path mocks)
- [ ] Run: `pnpm exec vitest run tests/unit/create-user-skill.test.ts`
- [ ] Commit: `feat: add saveUserSkill core for skills-store user scope`

---

### Task 2: OpenClaw plugin `sto-user-skill-tool`

**Files:**
- Create: `sto-plugin/openclaw/sto-user-skill-tool/index.ts`
- Create: `sto-plugin/openclaw/sto-user-skill-tool/openclaw.plugin.json`
- Create: `sto-plugin/openclaw/sto-user-skill-tool/package.json` (follow `sto-workflow-tool` minimal layout)
- Modify: plugin install / allowlist wiring used by `electron/utils/openclaw-auth.ts` / `electron/utils/plugin-install.ts` (same places workflow tool is enabled)
- Modify: `resources/context/TOOLS.stoclaw.md`

- [ ] Register tool id/name `save_user_skill` with JSON schema matching design input fields
- [ ] `execute` → call shared `saveUserSkill`; map errors to structured tool result text/JSON
- [ ] Ensure plugin is bundled/copied into `~/.stoclaw/openclaw/extensions` like other sto plugins
- [ ] Add TOOLS.stoclaw.md section: 创建/更新用户技能必须调用 `save_user_skill`，禁止仅 write 到 `openclaw/skills` 或 `workspace/skills`
- [ ] Manual smoke under `pnpm dev`: ask agent to create a tiny skill via tool; confirm dir under `skills-store/users/<code>/skills/`
- [ ] Commit: `feat: register OpenClaw save_user_skill tool`

---

### Task 3: Claude MCP `sto-user-skill-tool`

**Files:**
- Create: `sto-plugin/claude/sto-user-skill-tool/tools.ts` (MCP server factory)
- Create: `sto-plugin/claude/sto-user-skill-tool/index.ts` (optional barrel)
- Modify: `electron/engines/claude-runtime-extensions.ts` to register the MCP server when STO token / user available (mirror workflow registration)

- [ ] Implement `createUserSkillMcpServer()` exposing `save_user_skill` with same args/behavior as OpenClaw
- [ ] Wire into `claude-runtime-extensions` so Claude turns receive the tool
- [ ] Smoke: Claude engine create skill → same skills-store user path
- [ ] Commit: `feat: register Claude save_user_skill MCP tool`

---

### Task 4: Orphan fallback import (debounced)

**Files:**
- Create: `electron/services/skills/orphan-skill-import.ts`
- Create: `tests/unit/orphan-skill-import.test.ts`
- Modify: `electron/services/skills/adapters/engine-skill-adapter.ts` or gateway notify hook to schedule import after skill batch (or call from `notifyGatewayAfterSkillBatch` callers / SkillManager `onAfterBatch` path carefully to avoid loops)
- Prefer: export `scheduleOrphanSkillImport(reason)` and invoke from a single place after user skill tool success + optionally on `activateUserWorkspace` when store migrated

- [ ] Scan bounded roots only:
  - `getOpenClawSkillsDir()` children lacking managed projection marker (or with unmanaged content)
  - `join(activeWorkspace, 'skills')` if workspace resolves and dir exists
- [ ] For each candidate with `SKILL.md`: if current user has no skills-store entry, `installFromLocalDir(scope:user, source:local)`
- [ ] Skip preinstall whitelist slugs; skip dirs already matching store package
- [ ] Debounce ≥2s; in-flight Set per slug; never throw into chat path
- [ ] Unit tests for skip-managed / import-unmanaged / skip-whitelist
- [ ] Commit: `feat: import unmanaged skill dirs into skills-store user scope`

---

### Task 5: 「我的技能」visibility check + docs

**Files:**
- Verify: `electron/services/skill-plaza-service.ts` `resolveLocalSkillPlazaSource` treats `source: 'local'` as mine (already expected)
- Modify: design/plan already written; optionally add short note to `openspec/changes/` only if team requires OpenSpec for this feature before merge

- [ ] Confirm new skill shows under「我的技能」with 自建 tag and `canUninstall !== false`
- [ ] Confirm delete removes skills-store user copy (existing uninstall)
- [ ] Run: `pnpm exec vitest run tests/unit/create-user-skill.test.ts tests/unit/orphan-skill-import.test.ts tests/unit/skills-lifecycle-adapters.test.ts`
- [ ] Commit: `docs: note agent skill save path in TOOLS if any leftover`

---

### Task 6: Verification checklist

- [ ] OpenClaw: model calls `save_user_skill` → files under `~/.stoclaw/skills-store/users/<code>/skills/<slug>/`
- [ ] Claude: same
- [ ] 「我的技能」 lists skill; delete works; re-open folder shows gone
- [ ] Writing only to `openclaw/skills` without tool still gets imported after debounce (or after activate), then appears in「我的技能」
- [ ] Whitelist slug (e.g. `sai-cli`) rejected by tool
- [ ] Logged-out / missing userCode returns `NOT_LOGGED_IN`

---

## Risk notes

- **Gateway plugin cannot import Electron SkillManager directly** if it runs in a separate process: if OpenClaw plugin host cannot call Main modules, bridge via Host API HTTP (`POST /api/skill-plaza/upload`-like) or existing IPC/ sto-toolkit pattern. **First spike in Task 2:** confirm whether `sto-workflow-tool` calls local Node modules or only HTTP. Prefer: Host API route `POST /api/skills/save-user` wrapping `saveUserSkill`, both engines call that HTTP with stoToken — keeps one SoT in Main.
- If spike shows in-process import works for OpenClaw plugins in this repo, keep direct call; otherwise add Host API in Task 1.5 before plugins.

### Task 1.5 (conditional): Host API route

**Files:**
- Modify: `electron/api/routes/skills.ts` or `skill-plaza.ts`
- Modify: `src/lib/skill-plaza-api.ts` only if renderer ever needs it (v1 no)

- [ ] `POST /api/skills/save-user` → `saveUserSkill(body)`
- [ ] Plugins call this URL with local hostapi base (same as other sto tools)
- [ ] Commit: `feat: host API for save-user skill`

---

## Out of scope (do not implement in this plan)

- Cleaning `~/.openclaw/workspace/skills` historical orphans
- Aligning migration `dedupeGlobalUserSkillDuplicates` preinstall check to whitelist (separate fix)
- Publishing created skills to plaza
