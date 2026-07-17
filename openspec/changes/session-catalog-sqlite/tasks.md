## 1. Database and repositories

- [x] 1.1 Add migration `0002` (`workspaces`, `session_groups`, `catalog_sessions`, `session_engine_bindings`) + seed `default` workspace
- [x] 1.2 Kysely table types, DTOs, repositories with soft-delete and `(workspace_id, session_key)` queries
- [x] 1.3 Wire catalog DB init in Main startup (`electron/db/index.ts`)

## 2. Workspaces (user folder model)

- [x] 2.1 Main: folder picker IPC + optional blank-folder create at user-confirmed path
- [x] 2.2 Workspace CRUD service + host-api routes
- [x] 2.3 Bind new sessions to selected `workspace_id`; default workspace for global「对话」
- [x] 2.4 Sidebar「项目」section: list user workspaces only; select filters sessions; create/link flows
- [x] 2.5 Resolve tool `cwd` from workspace `root_path` for non-default sessions
- [x] 2.6 **Do not** implement install-drive or `~/.stoclaw` relocation

## 3. Engine registry facade

- [x] 3.1 Refactor `session-registry.ts` to read/write `session_engine_bindings`
- [x] 3.2 One-time import from `engine-sessions.json` when bindings table empty
- [x] 3.3 Unit tests for facade round-trip and import idempotency

## 4. Catalog service and host-api

- [x] 4.1 `electron/services/session-catalog-service.ts` — reconcile, list, patch sessions/groups
- [x] 4.2 Expose `/api/session-catalog/*` through host-api + api-client typings
- [x] 4.3 Migrate `stoclaw-chat-session-labels` and `stoclaw:sidebar-recent-groups` into catalog (`default` workspace)

## 5. Renderer catalog integration

- [x] 5.1 Replace localStorage group/label writes with catalog API (read fallback one release if needed)
- [ ] 5.2 Sidebar recent list: groups, pin, sort, titles from catalog per `workspace_id`
- [x] 5.3 Session delete: soft-delete catalog row + existing engine delete flow

## 6. Send queue enhancements

- [x] 6.1 `sendImmediately(sessionKey, itemId)` — abort without `suspendAutoSend`, dequeue, send
- [x] 6.2 Per-session auto-drain watching `runtimeBySessionKey[*].sending` edges
- [x] 6.3 `PendingQueuePanel`: edit item, send-immediately button, wire Chat + Home composers
- [x] 6.4 Unit tests for drain/suppress/send-immediately interactions

## 7. Unread UI

- [x] 7.1 Move unread dot to left of title in `sidebar-recent-session-row.tsx`
- [x] 7.2 Remove unread from trailing `sidebar-recent-session-status.tsx`; keep running > error priority
- [x] 7.3 Verify collapsed sidebar icon column still respects priority rules

## 8. Verification and docs

- [ ] 8.1 `pnpm run typecheck`
- [x] 8.2 `pnpm test` — catalog repositories, registry facade, message-queue, sidebar unread
- [x] 8.3 Update `docs/sqlite-local-db-architecture.md` with session catalog tables
- [ ] 8.4 Manual: create workspace on external drive, bind session, pin/group migrate, queue ↑, background unread dot
