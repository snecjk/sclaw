## 1. Database schema and models

- [ ] 1.1 Add migration `0002-session-catalog` (workspaces with project fields/`root_path`, session_groups, catalog_sessions, session_engine_bindings + indexes) and register in `electron/db/migrations/index.ts` (Requirement: SQLite session catalog storage; Requirement: Project id scopes catalog rows; Requirement: Default project and Workspaces root)
- [ ] 1.2 Add Kysely table types / domain / DTO models and extend `SqliteDbSchema` (Requirement: SQLite session catalog storage)
- [ ] 1.3 Implement repositories: workspace/project, session-group, catalog-session, engine-binding (soft-delete, upsert, list-by-workspace) (Requirement: SQLite session catalog storage; Requirement: Catalog access boundary)

## 2. Projects (Kimi-like workspace folders)

- [ ] 2.1 On catalog init, seed project `id=default`, `is_default=1`; add projects-root resolver (persist `projects_root_path`; adopt existing `{openclawConfigDir}/workspaces`; else install-drive suggestion from execPath) (Requirement: Default project and Workspaces root)
- [ ] 2.2 Extend workspaces schema/DTO with `name`, `root_path` (nullable for default), timestamps; persist projects root meta (Requirement: Default project and Workspaces root; Requirement: Project id scopes catalog rows)
- [ ] 2.3 Host-api: create blank project (ensure root per policy + mkdir project, no starter files); link existing folder; list projects excluding default; API to suggest install-drive root (Requirement: Create blank project under workspaces root; Requirement: Link existing folder as project; Requirement: Default project is invisible in UI copy)
- [ ] 2.4 When starting/sending in a non-default project session, resolve engine cwd / binding `cwd` to project `root_path`; default sessions keep agent workspace (Requirement: Sessions use project root as working directory)
- [ ] 2.5 Sidebar「项目」+ create dialog: if root missing, guide create on install-drive suggestion (editable); if root exists, default parent to it; no default/未归类 labels in「对话」; theme via `docs/sto-design.md` (Requirement: Sidebar project UI; Requirement: Default project is invisible in UI copy)
- [ ] 2.6 Unit tests: reuse existing root; first-time suggests install drive; blank create without starter files; link external path; Win drive-letter helper; non-writable suggestion fallback (Requirement: Default project and Workspaces root; Requirement: Create blank project under workspaces root; Requirement: Link existing folder as project; Requirement: Project id scopes catalog rows)

## 3. Engine binding facade and legacy import

- [ ] 3.1 Rewrite `electron/engines/session-registry.ts` to use engine-binding repository while keeping exported API signatures (Requirement: Engine binding registry facade)
- [ ] 3.2 One-time idempotent import from `~/.stoclaw/engine-sessions.json` into SQLite; prefer SQLite on subsequent reads (Requirement: Engine binding registry facade)
- [ ] 3.3 Unit tests for upsert/get/delete/list and JSON import idempotency (Requirement: Engine binding registry facade)

## 4. Catalog service and host-api

- [ ] 4.1 Add `electron/services/session-catalog-service.ts` for reconcile, overview ordering, group/pin/title/activity ops (Requirement: Reconcile discovered sessions into catalog; Requirement: Global pin and ordered sessions)
- [ ] 4.2 Add `/api/session-catalog/*` routes (overview, groups CRUD, assign/ungroup, pin/reorder/patch, client-state import) wired through host-api router (Requirement: Custom groups via host-api; Requirement: Catalog access boundary)
- [ ] 4.3 Implement overview sort: pinned by `pin_rank`, groups by `sort_order`, within section manual `sort_order` else `last_activity_at` DESC (Requirement: Global pin and ordered sessions)
- [ ] 4.4 Soft-delete helpers + make deleted-keys listing catalog-backed (dual-write electron-store optional for one release) (Requirement: Soft-delete tombstones in catalog)

## 5. Reconcile with existing session discovery

- [ ] 5.1 Reconcile upserts from chat/cron/scheduled-task/claude-task list sources into `catalog_sessions` for default workspace without removing discovery APIs (Requirement: Reconcile discovered sessions into catalog)
- [ ] 5.2 Ensure soft-deleted catalog keys stay hidden even if discovery returns them (Requirement: Soft-delete tombstones in catalog; Requirement: Reconcile discovered sessions into catalog)
- [ ] 5.3 Wire delete flow (`/api/sessions/delete`) to set catalog `deleted_at` while keeping engine-side cleanup (Requirement: Soft-delete tombstones in catalog)

## 6. Titles, activity, and client migration

- [ ] 6.1 Persist title/label and `last_activity_at` in catalog; overview prefers catalog title when set (Requirement: Titles and activity in catalog)
- [ ] 6.2 Add idempotent import for renderer localStorage (`stoclaw-chat-session-labels`, `stoclaw:sidebar-recent-groups`) via host-api import endpoint (Requirement: Titles and activity in catalog; Requirement: Custom groups via host-api; Requirement: Default logical workspace)
- [ ] 6.3 After successful import, stop treating localStorage as source of truth for labels/groups (Requirement: Titles and activity in catalog; Requirement: Custom groups via host-api)

## 7. Renderer integration

- [ ] 7.1 Update `useSidebarRecentGroupsStore` (or thin wrapper) to read/write groups via `/api/session-catalog/*` using `hostApiFetch` only (Requirement: Custom groups via host-api; Requirement: Catalog access boundary)
- [ ] 7.2 Update `loadSessions` / sidebar consumers to use catalog overview organization fields (group, pin, sort, title) (Requirement: Reconcile discovered sessions into catalog; Requirement: Global pin and ordered sessions; Requirement: Titles and activity in catalog)
- [ ] 7.3 Wire selected project into session list / new-session creation so new chats inherit project binding (Requirement: Sidebar project UI; Requirement: Sessions use project root as working directory)
- [ ] 7.4 If pin UI is exposed, use `docs/sto-design.md` tokens (no ad-hoc hex); otherwise keep persistence-only until UI task (Requirement: Global pin and ordered sessions)

## 8. Per-session send queue (enqueue / send-immediately / multi-session)

- [ ] 8.1 Add `sendImmediately(sessionKey, queueItemId)` on message-queue: abort that session's active run, remove item, send without Stop-path `suspendAutoSend` (Requirement: Send immediately aborts then runs; Requirement: Enqueue while session is answering)
- [ ] 8.2 Upgrade `createAutoSendWatcher` to drain on per-session `runtimeBySessionKey[sessionKey].sending` true→false edges (not only current session) (Requirement: Per-session auto-drain)
- [ ] 8.3 Keep Stop → `suspendAutoSend` so abort alone does not dequeue (Requirement: Send immediately aborts then runs)
- [ ] 8.4 Extend `PendingQueuePanel` with edit + send-immediately actions (Cursor-like); keep delete; theme via `docs/sto-design.md` (Requirement: Queue item edit and delete)
- [ ] 8.5 Wire Chat + Home composers to the new queue actions; confirm enqueue-while-sending path unchanged (Requirement: Enqueue while session is answering)
- [ ] 8.6 Unit tests: enqueue isolation by session, send-immediately abort+send, Stop does not drain, background session auto-drain (Requirement: Per-session auto-drain; Requirement: Send immediately aborts then runs; Requirement: Queue is not catalog storage)

## 9. Session unread red dot (localStorage)

- [ ] 9.1 Keep `useSessionUnreadStore` / `stoclaw:session-unread` as the only unread persistence; do not add unread tables to SQLite catalog (Requirement: Unread persists in localStorage only)
- [ ] 9.2 Confirm mark/clear paths remain wired: background successful completion → `markSessionUnreadAfterSuccessfulRun`; open/switch → `markSessionRead`; foreground success → `touchSessionReadAt` (Requirement: Mark unread on background successful completion; Requirement: Clear unread when opening the session)
- [ ] 9.3 Move unread red-dot UI to the **left of the session title** on recent-session rows; keep running > error > unread mutual exclusion; use `sidebarUnreadDotClass` / sto-design tokens (Requirement: Unread red dot left of session title)
- [ ] 9.4 Unit/UI tests or existing notify tests: gates still skip unobserved/replay runs; left-of-title placement when unread (Requirement: Mark unread on background successful completion; Requirement: Unread red dot left of session title)

## 10. Verification and docs

- [ ] 10.1 Unit tests for repositories, overview ordering, tombstone suppress, project scoping (Requirement: SQLite session catalog storage; Requirement: Global pin and ordered sessions; Requirement: Soft-delete tombstones in catalog; Requirement: Project id scopes catalog rows)
- [ ] 10.2 Run `pnpm run typecheck` and targeted Vitest for catalog/registry/sidebar group/message-queue/session-unread paths
- [ ] 10.3 Review `README.md`, `README.zh-CN.md`, `README.ja-JP.md` for session-catalog / SQLite / send-queue / unread notes; update if behavior/APIs need documenting
- [ ] 10.4 If abort/send delivery paths change materially, run `pnpm run comms:replay` and `pnpm run comms:compare`; otherwise confirm chat history compensation unchanged
