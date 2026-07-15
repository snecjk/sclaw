## Why

Session organization metadata is scattered across `engine-sessions.json`, localStorage labels/groups, and electron-store tombstones, which makes multi-engine growth, workspace isolation, pin/sort, and incremental sync hard. The app already has a Main-process SQLite stack (`node:sqlite` + Kysely + migrations); this change makes Session Catalog the first real business domain on that stack so organization data can be queried and migrated cleanly without moving chat transcripts. In the same change, per-session send queues are upgraded so users can enqueue follow-ups while a run is active, send a queued item immediately (abort + run), and keep multiple sessions’ model runs independent. Background-session completion unread (red dot) is also specified here but remains localStorage-only. **Projects** (Kimi-like workspaces) let users create or link a folder under a default `Workspaces` root; session tools and artifacts use that project directory as the working tree.

## What Changes

- Introduce a SQLite-backed **Session Catalog** in existing `userData/sqlite/stoclaw.sqlite` for session titles, activity, soft-delete, engine bindings, custom groups, pin, and sort order
- Introduce **Projects** (catalog workspaces with a filesystem `root_path`): create blank project under a persisted projects root, or attach an existing folder; sidebar「项目」lists user projects only
- Seed an implicit default project/workspace (`id = default`) for all current/non-project sessions; UI MUST NOT show「default」or「未归类」— those sessions stay under「对话」as today; new chats inside a user project bind to that project's `root_path` as tool/artifact cwd
- **Projects root policy**: if `workspaces` (or persisted root) already exists → default new blank projects under it; if not → guide the user to create the root on the **app install drive/volume** (Windows: drive of `execPath`; macOS/Linux: same volume as the app), user may change before confirm; persist chosen root
- Blank projects MUST NOT auto-seed starter files
- Migrate `~/.stoclaw/engine-sessions.json` into catalog engine-binding rows while keeping the same Main-process registry API surface for callers
- Move sidebar recent-group persistence from localStorage (`stoclaw:sidebar-recent-groups`) onto catalog APIs; keep existing grouping UX where possible
- Move session label / last-activity persistence from Zustand localStorage onto catalog
- Keep Gateway / Claude / JSONL as the authority for message bodies and run lifecycle; catalog is organization + binding authority only
- Expose catalog and project operations through host-api routes (renderer must not touch SQLite)
- Enhance **per-session send queue** (existing `message-queue` store): while a session is answering, new sends enqueue; queue UI supports edit / send-immediately / delete (Cursor-like); send-immediately aborts the active run then sends that item; auto-drain is per-session so multiple sessions do not block each other
- Codify **session completion unread** (red dot): keep `stoclaw:session-unread` in localStorage; show unread indicator to the **left of the session title** when a background session finishes successfully; do not move unread into SQLite
- **Non-goals**: transcript JSONL into SQLite; full cloud project sync; starter files in blank projects; labeling default as「未归类」; new npm sqlite drivers; persisting the send queue or unread red-dot set in SQLite

## Capabilities

### New Capabilities

- `session-catalog`: SQLite session directory — reconcile engine/task session lists, engine bindings, soft-delete tombstones, custom groups, pin/sort, and host-api access for sidebar/chat
- `session-workspace`: Project/workspace model — reuse existing projects root or guide first-time root onto install drive; create/link projects; invisible default for non-project「对话」
- `chat-session-send-queue`: Per-session outbound message queue with enqueue-while-sending, send-immediately (abort + run), optional edit, and multi-session independent drain
- `chat-session-unread`: Background-session successful-run unread red dot persisted in localStorage only; sidebar shows the dot left of the session name

### Modified Capabilities

- (none in `openspec/specs/`; sidebar grouping today lives only under change `sidebar-recent-message-groups` as local UI state — this change supersedes its persistence layer)

## Impact

- **DB**: `electron/db` migration `0002`, workspaces gain `root_path` / project fields; follow `docs/sqlite-local-db-architecture.md`
- **Main**: session-catalog + project services; thin rewrite of `electron/engines/session-registry.ts`; session delete / deleted-keys; `/api/session-catalog/*` and project create/link routes; resolve session cwd from project `root_path` when bound
- **Renderer**: sidebar「项目」list + create/link dialogs (Kimi-like); catalog-backed groups; message-queue send-immediately; unread left-of-title; chat history compensation stays engine-owned
- **Filesystem**: first-time workspaces root guided onto install drive/volume (suggested `{installRoot}/.stoclaw/openclaw/workspaces`); if `{openclawConfigDir}/workspaces` or persisted root already exists, reuse it; blank projects = `{projectsRoot}/{name}/`; no starter files
- **Storage migration**: import from `engine-sessions.json`, labels, sidebar groups, deleted tombstones; unread stays on `stoclaw:session-unread`
- **Deps**: no new package manager changes (`kysely` + `node:sqlite` already present)
- **UI theme**: project/pin/group/queue/unread chrome MUST follow `docs/sto-design.md`
