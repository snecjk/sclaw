## Context

Session organization today is split across:

- `~/.stoclaw/engine-sessions.json` — Claude engine bindings (`session-registry.ts`, whole-file rewrite queue)
- OpenClaw `agents/{id}/sessions/sessions.json` + JSONL transcripts — discovery + message authority
- Renderer localStorage — `stoclaw-chat-session-labels`, `stoclaw:sidebar-recent-groups`
- electron-store `scheduled-task-poller.deletedSessions` — soft-delete tombstones
- Four list sources merged in `loadSessions` — `/api/chat/sessions`, scheduled-tasks, claude-scheduled-tasks, cron

Main already initializes SQLite (`electron/db`, `node:sqlite` + Kysely, WAL, migration v1 demo-only) per `docs/sqlite-local-db-architecture.md`. This design makes Session Catalog the first production domain on that stack.

Logical **workspace / project** (product「项目」) is a catalog entity with a filesystem `root_path`. This is **not** the same as the agent-global OpenClaw cwd (`getAgentWorkspacePath` / `~/.stoclaw/openclaw/workspace*`), though a project session overrides tool cwd to the project's `root_path`.

Kimi-like product model (in scope):

- Projects root resolution:
  1. Persisted `projects_root_path` if present on disk
  2. Else existing `{getOpenClawConfigDir()}/workspaces` if present → adopt & persist
  3. Else first create: **guide user** to create root on **install drive/volume** (Windows: drive of `process.execPath` / `app.getPath('exe')`, suggest `{drive}:\.stoclaw\openclaw\workspaces`; macOS/Linux: same volume as app, user can change)
-「新建空白项目」→ under resolved root `{root}/{projectName}/` + catalog row; **no starter files**
-「使用现有文件夹」→ pick directory + catalog row pointing at it
- Sessions under a user project use that folder for tools/artifacts
- Sidebar「项目」lists **user projects only**; never show「default」/「未归类」
- Seeded `id=default` holds all non-project sessions; they appear under「对话」exactly as today

Outbound send queue already exists in renderer (`src/stores/message-queue.ts`, `PendingQueuePanel`): enqueue while `sending`, reorder/remove, auto-send on run finish for **current** session only. Product reference (Cursor-style): collapsible “N Queued”, edit / send-immediately / delete; send-immediately aborts the active run then executes that item.

## Goals / Non-Goals

**Goals:**

- Single SQLite catalog for organization metadata: projects/workspaces, groups, pin/sort, titles, activity, soft-delete, engine bindings
- Project create under resolved projects root (reuse existing or guide install-drive first-time root) and link existing folder; bind sessions to `root_path` as tool/artifact cwd
- Seed default project for all non-project sessions; UI never labels it default/unclassified
- No starter files in blank projects
- Preserve engine/JSONL as message + run lifecycle authority; catalog overlays organization fields after reconcile
- Keep `session-registry` function signatures so Claude adapter / model-switch callers stay stable
- Move sidebar group persistence to host-api while reusing existing group UX where possible
- Follow existing db layering: migration → table types → repository → `electron/services/*` → host-api
- Upgrade per-session send queue: enqueue while answering, send-immediately (abort + send), optional edit, per-session auto-drain so multiple sessions run independently
- Keep session completion unread (red dot) in localStorage; place the unread indicator to the left of the session title in the sidebar

**Non-Goals:**

- Moving transcript JSONL / FTS into SQLite
- Persisting send-queue contents in SQLite (runtime Zustand Map is enough)
- Persisting unread red-dot keys in SQLite (keep `stoclaw:session-unread` localStorage)
- Cloud sync of project folders
- Replacing agent-global workspace for agents/sessions that remain on the default project
- Introducing `better-sqlite3` or a second database file
- Full engine plugin registry rewrite (only store `engine_id` as text for future engines)

## Decisions

### 1. One database file: extend `stoclaw.sqlite`

- **Choice**: Add migration `0002-session-catalog` to existing `userData/sqlite/stoclaw.sqlite`.
- **Rationale**: Matches architecture doc; shared pragmas/migrator; no second connection lifecycle.
- **Alternative**: Separate `session-catalog.sqlite` — rejected (ops complexity, duplicate pragma/migration patterns).

### 2. Authority split: catalog vs engines

- **Choice**:
  - **Discovery**: keep four list APIs; reconcile upserts into `catalog_sessions`
  - **Organization**: catalog is authoritative for group / pin / sort / title / deleted / workspace
  - **Messages / runs**: Gateway, Claude SDK, JSONL writers unchanged
- **Rationale**: Avoid rewriting chat compensation and token-usage JSONL scanners.
- **Alternative**: Catalog becomes sole session list — rejected for P1 (cron/task virtual sessions still need engine/task sources).

### 3. Schema shape (aligned with db conventions)

Tables (TEXT ISO8601 timestamps, soft `deleted_at`, `version`, bool as `0/1`):

| Table | Role |
|-------|------|
| `workspaces` | Projects: seed `id='default'`; user projects store `name`, `root_path`, `is_default` |
| `session_groups` | Custom groups per project (`sort_order`, `collapsed`) |
| `catalog_sessions` | PK `(workspace_id, session_key)`; `engine_id`, `source_kind`, `group_id`, `is_pinned`, `pin_rank`, `sort_order`, `title`, `last_activity_at` |
| `session_engine_bindings` | Replaces `engine-sessions.json` fields; `cwd` SHOULD mirror project `root_path` when session is project-bound |

- **Rationale**: Matches `docs/sqlite-local-db-architecture.md`; `foreign_keys=OFF` so app-layer integrity (same as demo).
- **Alternative**: INTEGER ms timestamps — rejected (inconsistent with demo + architecture doc).

### 4. Sidebar sort rules

1. Pinned globally: `is_pinned=1` ordered by `pin_rank`
2. Groups by `session_groups.sort_order`
3. Within group / ungrouped: manual `sort_order` if set, else `last_activity_at DESC`

- **Rationale**: Matches product ask (group + pin + ordered sessions); global pin is simpler than per-group pin for P1.
- **Alternative**: Pin only inside groups — deferred; can add later without breaking global pin column.

### 5. `session-registry.ts` becomes a thin SQLite facade

- **Choice**: Keep exported APIs; implement via `session_engine_bindings` repository.
- **Rationale**: Minimizes churn in `claude-adapter`, `/api/sessions/model`, delete paths.
- **Alternative**: New API only + mass call-site rewrite — higher risk, no user value.

### 6. Host-api surface

New routes under `/api/session-catalog/*` (overview, groups CRUD, session patch/reorder, migration status). Renderer continues via `hostApiFetch` only.

- **Rationale**: Enforces Main-owned DB; matches AGENTS.md renderer boundary.
- **Alternative**: Direct IPC db channel — rejected (bypasses host-api convention).

### 7. Migration strategy: import once, dual-read briefly

On first catalog init after migration:

1. Seed default workspace
2. Import `engine-sessions.json` → bindings
3. Import deleted keys → `catalog_sessions.deleted_at`
4. Import labels/activity from persisted chat store (Main reads via one-shot bridge or renderer posts snapshot once)
5. Import `stoclaw:sidebar-recent-groups` → groups + assignments

Then dual-write deleted tombstones to electron-store for one release if needed; prefer catalog as read authority immediately for groups/bindings.

- **Rationale**: Safe upgrade path; rollback = keep JSON/localStorage until catalog flagged healthy.
- **Alternative**: Big-bang delete old stores — too brittle for desktop upgrades.

### 8. Logical workspace vs agent cwd → Project binds cwd

- **Choice**: Catalog `workspaces` rows are **Projects**. User projects always have `root_path`. Session runs under a non-default project resolve tool/artifact cwd to that `root_path` (and persist it on engine bindings when applicable). Agent-global OpenClaw workspace remains for default-project / unbound legacy behavior.
- **Rationale**: Matches Kimi: project folder is where files and model working tree live.
- **Alternative**: Keep projects as pure labels without cwd override — rejected (does not match the product screens).

### 8b. Projects root: reuse existing, else guide to install drive

- **Choice**:
  - Persist `projects_root_path` (settings/catalog meta) after first establishment
  - If root already exists (`projects_root_path` or `{openclawConfigDir}/workspaces`) → default blank-project parent to it
  - If missing → create-project UI **guides** user to create root; suggested path on **install drive/volume** from `execPath`/`getPath('exe')` (Win: `D:\.stoclaw\openclaw\workspaces` when app is on D:; macOS: same volume as `.app`, user can pick elsewhere)
  - Blank create = mkdir project folder under chosen root + catalog insert, **no starter files**
  - Link existing = catalog insert only
- **Rationale**: Avoid filling C: user profile when app lives on another drive; still reuse any already-created workspaces tree.
- **Alternative**: Always `%USERPROFILE%\.stoclaw\openclaw\workspaces` — rejected for first-time when install drive differs; still accepted as adopt path when that folder already exists.

### 8c. Sidebar「项目」UI; default invisible

- **Choice**: Ship project list + create/link dialogs.「项目」shows only non-default projects. Default-bound sessions stay under「对话」with no「default」/「未归类」copy. Selecting a user project filters conversations to that project. First-time blank create includes workspaces-root guidance when needed.
- **Rationale**: Matches Kimi screenshot annotation (常规非项目中的会话 under「对话」).
- **Alternative**: Show「未归类」for default — rejected.
### 9. UI / theming

Pin/group affordances reuse existing sidebar patterns; any new emphasis (pin icon, active group) MUST use tokens from `docs/sto-design.md` (e.g. Brand / Grey / functional status), not ad-hoc hex. Queue panel chrome MUST use the same constitution (muted surfaces / Grey text / destructive for remove); do not copy Cursor hex values.

### 10. Send queue stays renderer-runtime; catalog stays organization

- **Choice**: Keep queues in `useMessageQueueStore` (keyed by `sessionKey`); do not store queue rows in SQLite.
- **Rationale**: Queue is ephemeral scheduling; catalog is durable organization. Mixing them couples unrelated lifecycles.
- **Alternative**: Persist queue in catalog — rejected (restart semantics unclear; not required by product).

### 11. Send-immediately vs Stop

- **Choice**:
  - **Stop**: abort active run; `suspendAutoSend` keeps remaining queue for later successful completion (existing behavior).
  - **Send immediately** (queue item action): abort active run for that session → remove/promote that item → send it now without applying abort-suppress for that transition → other queued items remain and drain after this new run finishes.
- **Rationale**: Matches Cursor-like “↑ send now” vs plain stop; avoids Stop accidentally firing the next queued message.
- **Alternative**: Stop always drains next — rejected (current product already suppresses; users expect Stop to pause).

### 12. Per-session auto-drain (multi-session independence)

- **Choice**: Drive auto-send off each session’s `runtimeBySessionKey[sessionKey].sending` (true→false), not only global/`currentSessionKey` `sending`.
- **Rationale**: Background sessions must finish and dequeue without requiring the user to be viewing that chat.
- **Alternative**: Keep current-session-only watcher — fails the “sessions don’t interfere / each runs its own queue” requirement.

### 13. Queue UI actions (reference)

Per queued item: edit (optional but in-scope), send-immediately, delete. Reorder may remain (move up/down) or be simplified once send-immediately exists. Composer still accepts follow-ups while `sending` (enqueue path unchanged).

### 14. Unread red dot stays localStorage; show left of title

- **Choice**: Keep `useSessionUnreadStore` + `stoclaw:session-unread` (localStorage). Do not add unread columns/tables to SQLite catalog. Sidebar recent rows MUST show the unread dot **to the left of the session title** when unread and not the current session. Status priority remains: running > error > unread.
- **Rationale**: Unread is ephemeral UX reminder with existing anti-false-positive gates (`noteObservedRun`, startup grace, recent-read grace); catalog is durable organization. Moving unread to SQLite adds no product value and couples restart/replay semantics to Main DB.
- **Alternative**: Mirror unread into `catalog_sessions` — rejected for this change.

Marking rules (unchanged product semantics, now in-scope for this change):

1. Successful terminal completion for a non-current session → `markSessionUnreadAfterSuccessfulRun` (observed run + grace gates)
2. Opening / switching to the session → `markSessionRead`
3. Foreground successful completion → `touchSessionReadAt` (no unread)

## Risks / Trade-offs

- [Risk] Reconcile races: engine list returns a session catalog marked deleted → Mitigation: deleted tombstones win; never auto-revive unless explicit revive API (same as current poller semantics).
- [Risk] Dual sources for titles (Gateway label vs catalog title) → Mitigation: catalog title wins when set; else hydrate from engine list / history as today.
- [Risk] `DatabaseSync` blocks Main on hot upserts → Mitigation: batch reconcile; throttle activity writes; avoid per-token writes.
- [Risk] Incomplete localStorage import (renderer-only data) → Mitigation: one-shot `POST /api/session-catalog/import-client-state` on first load after upgrade; idempotent by version flag.
- [Risk] Project `root_path` vs agent-global workspace confusion → Mitigation: document Project vs AgentWorkspacePath; only override cwd for non-default project sessions; leave default project on existing agent workspace.
- [Risk] Deleting a project deletes user files → Mitigation: catalog soft-delete / unlink by default; optional “also delete folder” must be explicit and confirmed.
- [Risk] Install drive suggestion not writable (macOS /Applications, Program Files) → Mitigation: detect non-writable suggestion; fall back to Documents or user-picked folder; never silently fail mkdir.
- [Risk] User moves app to another drive later → Mitigation: `projects_root_path` is persisted independently of current execPath; only first-time suggestion uses install drive.
- [Risk] Sidebar groups change still in flight → Mitigation: treat catalog as persistence supersession; keep UX components; swap store backend.
- [Risk] Send-immediately races with streaming final/error handlers → Mitigation: abort by sessionKey/runId; clear that session runtime; then send with fresh idempotency key; reuse existing abort + sendMessage paths.
- [Risk] Per-session watcher double-fires when switching sessions → Mitigation: track previous `sending` per sessionKey; only dequeue on that session’s edge.
- [Risk] Moving unread dot left of title clashes with running spinner layout → Mitigation: keep mutual exclusion (running/error/unread); only one leading status glyph; use existing `sidebarUnreadDotClass` / destructive token from `docs/sto-design.md`.

## Migration Plan

1. Ship migration `0002` + repositories + registry facade (bindings only) behind feature-complete but dual-read if needed
2. Add catalog service + `/api/session-catalog/*`
3. Wire `loadSessions` reconcile + overlay organization fields
4. Client import of labels/groups; switch sidebar store to API
5. Point delete/deleted-keys at catalog; optional dual-write to electron-store
6. Upgrade message-queue watcher + PendingQueuePanel (send-immediately / edit); verify multi-session drain
7. Adjust sidebar recent row so unread red dot sits left of the session title; keep unread in localStorage
8. Ship project sidebar + create/link + cwd binding for project sessions
9. After soak: stop writing `engine-sessions.json` / group localStorage (keep files as backup until next major)

**Rollback**: Re-enable JSON registry + localStorage stores via flag; SQLite rows remain harmless. Queue UI can fall back to reorder/remove-only without send-immediately. Unread store remains independently rollback-safe.

## Open Questions

- Suggested first-time path on macOS when app is under `/Applications` (often not ideal for user data): prefer `{homedir}/.stoclaw/openclaw/workspaces` vs other volume — confirm if install-drive suggestion should skip read-only system locations.
- OpenClaw `sessions.json`: remain discovery-only forever, or eventually mirror fully into catalog for list?
- Per-group pin vs global pin: confirm product preference before P2 drag/pin UI polish.
- Send-immediately: should remaining queue items ahead of the chosen item be skipped, kept in order, or moved after the forced item? (Default proposal: keep relative order of other items; forced item runs next now.)
- Account isolation: should catalog rows be scoped by login `userCode` later, or is per-OS-profile `userData` enough? (P1 assumes per `userData` only.)
