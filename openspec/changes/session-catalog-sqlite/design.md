## Context

Today:

| Concern | Storage |
|--------|---------|
| Claude/OpenClaw engine binding | `~/.stoclaw/engine-sessions.json` via `session-registry.ts` |
| OpenClaw native registry | `agents/{id}/sessions/sessions.json` + `{uuid}.jsonl` |
| Session titles / last activity | localStorage `stoclaw-chat-session-labels` |
| Sidebar groups | localStorage `stoclaw:sidebar-recent-groups` |
| Runtime in-progress | `useChatStore.runtimeBySessionKey` (memory) |
| Send queue | `useMessageQueueStore` (memory) |
| Unread red dot | `useSessionUnreadStore` → `stoclaw:session-unread` |

SQLite lives at `userData/sqlite/stoclaw.sqlite` (Main only). Renderer never touches DB.

## Goals / Non-Goals

**Goals**

- Single catalog authority for organization + engine bindings + workspace binding
- Multi-engine ready bindings in SQLite with thin facade preserving existing registry API shape
- User workspaces = user-chosen `root_path`; tool cwd resolves from workspace when non-default
- Kimi-like sidebar:「对话」+「项目」; default workspace invisible
- Send queue parity with Cursor (↑ send now, edit, per-session drain)
- Unread dot left of title per `docs/sto-design.md`

**Non-Goals**

- Message bodies, runs, transcripts (stay in JSONL / Gateway)
- Persisting queue or unread in SQLite
- Relocating global `~/.stoclaw` or install-drive defaults
- Auto-nested app-owned workspace tree without user folder confirmation

## Decisions

### 1. Authority split

| Layer | Owns |
|-------|------|
| SQLite catalog | workspaces, `(workspace_id, session_key)` rows, groups, pin/sort, titles, activity, soft-delete, engine bindings |
| Engines / JSONL | Messages, runs, native `sessions.json` discovery |
| Memory | `runtimeBySessionKey`, message queue |
| localStorage | Unread only (`stoclaw:session-unread`) |

**Rationale**: Catalog is queryable and migratable; hot runtime paths stay fast and unchanged.

### 2. Schema (migration `0002`)

```text
workspaces
  id TEXT PK          -- 'default' seeded row, is_default=1
  name TEXT
  root_path TEXT      -- empty for default; user path for projects
  is_default INTEGER  -- 0|1
  created_at, updated_at, deleted_at, version, ...

session_groups
  id TEXT PK
  workspace_id TEXT FK
  name TEXT
  sort_order INTEGER
  created_at, ...

catalog_sessions
  workspace_id TEXT
  session_key TEXT
  group_id TEXT NULL
  title TEXT
  pin_rank INTEGER NULL   -- lower = higher; NULL = unpinned
  sort_key TEXT           -- stable manual order fallback
  last_activity_at TEXT
  deleted_at TEXT NULL
  PK (workspace_id, session_key)

session_engine_bindings
  session_key TEXT PK     -- globally unique session keys as today
  engine_type TEXT
  agent_id TEXT
  engine_session_id TEXT
  cwd TEXT
  model TEXT
  extra_json TEXT         -- archived Claude ids, bridge flags, etc.
  updated_at TEXT
```

**Alternatives**: Embed bindings in `catalog_sessions` — rejected because session keys are globally unique across workspaces and engines update bindings independently.

### 3. Default workspace

- Seed `workspaces` row `id='default'`, `is_default=1`, `root_path=''`
- All legacy / non-project sessions bind to `default`
- UI never lists default under「项目」

### 4. Workspace creation

- Main exposes `session-catalog:pick-workspace-folder` (Electron `dialog.showOpenDialog` / save dialog for blank folder)
- `root_path` stored exactly as user confirmed — no silent redirect under install or profile dirs
- Optional「新建空白项目」creates empty folder at user-confirmed parent + name; no starter files

### 5. Engine registry facade

- `session-registry.ts` becomes read/write through `session_engine_bindings` table
- On first catalog init: import `engine-sessions.json` if table empty; keep JSON file as backup until migration verified
- OpenClaw `sessions.json` remains **discovery-only** for unknown sessions; catalog upsert on first UI touch

### 6. Host API

New IPC routes (examples):

- `GET/POST /api/session-catalog/workspaces`
- `GET/PATCH/DELETE /api/session-catalog/sessions`
- `GET/POST/PATCH/DELETE /api/session-catalog/groups`
- `POST /api/session-catalog/reconcile` — scan engines + merge into catalog

Renderer uses `host-api.ts` only.

### 7. Labels / groups migration

- One-time import from `stoclaw-chat-session-labels` and `stoclaw:sidebar-recent-groups` into catalog rows under `default` workspace
- Idempotent: skip if catalog row already has `updated_at` newer than import marker
- After successful import, stop writing localStorage copies (read fallback one release if needed)

### 8. Send queue

- **Send immediately**: abort current run for that session **without** `suspendAutoSend`, dequeue chosen item, send
- **Stop**: abort only; `suspendAutoSend` retains queue (existing)
- **Auto-drain**: subscribe to per-session `runtimeBySessionKey[sk].sending` edges, not only `currentSessionKey` + global `sending`
- Queue cap stays 10/session; memory-only

### 9. Unread UI

- Logic unchanged in `session-unread-notify.ts`
- Move dot from trailing status cluster to **left of title** in `sidebar-recent-session-row.tsx`
- Trailing slot: running icon > error icon only (unread removed from trailing)
- Use `sidebarUnreadDotClass` from `src/lib/surfaces.ts`

## Risks / Trade-offs

- **[Risk] Dual-write during migration** → Facade writes SQLite first; JSON/localStorage import once; feature flag read path if needed
- **[Risk] Session key collision across workspaces** → Composite PK `(workspace_id, session_key)`; engine bindings remain global unique keys
- **[Risk] Per-session drain complexity** → Centralize in `message-queue.ts` single subscription over `runtimeBySessionKey`
- **[Risk] Folder picker on headless CI** → Mock IPC in unit tests; E2E skips folder create

## Migration Plan

1. Ship migration `0002` + seed default workspace
2. Background import `engine-sessions.json` + localStorage on app start (Main)
3. Renderer switches catalog reads to host-api; writes stop touching localStorage
4. Optional: delete stale localStorage keys after N launches (logged)

Rollback: revert app version; SQLite file ignored by old builds; JSON/localStorage backups retained until cleanup phase.

## Open Questions

- Pin scope: per-workspace global pin order vs per-group pin — **default: per-workspace global `pin_rank`**
- Send-immediately ordering: sent item removed from queue; if run abort fails, item stays — **match Cursor**
- macOS `/Applications` writability for blank-folder helper — surface OS error in UI, no silent fallback
