## Why

StoClaw session organization (titles, groups, pin/sort, engine bindings, project folders) is scattered across localStorage, `engine-sessions.json`, and engine-native registries. That blocks reliable multi-engine readiness, Kimi-like project UX, and a single source of truth for sidebar/catalog views. SQLite infrastructure already exists in Main; this change centralizes **catalog metadata** there while keeping message bodies and runtime state where they belong.

## What Changes

- Add SQLite session catalog (migration `0002`) for workspaces, groups, session rows, pin/sort, titles, activity, soft-delete, and engine bindings
- Introduce user workspaces (「项目」): each workspace binds to a **user-selected** local folder (`root_path`); sessions bind to `workspace_id` in catalog
- Keep implicit default workspace (`id=default`) for non-project chats; invisible in「项目」UI
- Expose catalog CRUD via host-api (`/api/session-catalog/*`); renderer uses `host-api` / `api-client` only
- Migrate `engine-sessions.json` bindings and localStorage labels/groups into SQLite (one-time, idempotent)
- Enhance per-session send queue: send-immediately (↑), edit/delete, per-session auto-drain across `runtimeBySessionKey` (queue stays in memory, not SQLite)
- Refine unread red dot: keep `stoclaw:session-unread` in localStorage; show dot **left of session title**; priority running > error > unread
- **Out of scope**: migrating global `~/.stoclaw` to install drive; persisting queue/unread in SQLite; changing Gateway `chat.send` / `chat.history` contracts

## Capabilities

### New Capabilities

- `session-catalog`: SQLite catalog for session organization, groups, pin/sort, titles, activity, soft-delete, engine bindings, and host-api surface
- `session-workspace`: User workspaces/projects with folder picker, session binding, default workspace semantics, sidebar「项目」UX
- `chat-session-send-queue`: Per-session message queue while answering; send-immediately, stop-without-drain, cross-session auto-drain
- `chat-session-unread`: Background-completion unread red dot in localStorage; left-of-title placement in sidebar

### Modified Capabilities

- (none — sidebar recent groups move from localStorage to catalog but remain a product concern under `session-catalog`)

## Impact

- `electron/db/migrations/`, repositories, `electron/services/session-catalog*`
- `electron/engines/session-registry.ts` (SQLite facade over `engine-sessions.json`)
- `src/lib/host-api.ts`, `src/lib/api-client.ts` (new session-catalog routes)
- `src/stores/sidebar-recent-groups.ts`, `src/lib/session-label.ts` (read/write via catalog)
- `src/components/layout/Sidebar.tsx`, new project/workspace UI
- `src/stores/message-queue.ts`, `src/pages/Chat/PendingQueuePanel.tsx`
- `src/components/layout/sidebar-recent-session-row.tsx`, `sidebar-recent-session-status.tsx`
- `docs/sqlite-local-db-architecture.md`, `docs/sto-design.md` (UI tokens for unread dot / project chrome)
- **No new npm dependencies** (`node:sqlite` + Kysely already present)
