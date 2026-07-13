## ADDED Requirements

### Requirement: SQLite session catalog authority

The system SHALL store session **organization metadata** in Main-process SQLite (`userData/sqlite/stoclaw.sqlite`), not in renderer-local persistence. Catalog data includes workspaces, session rows keyed by `(workspace_id, session_key)`, custom groups, pin/sort order, display titles, last activity timestamps, soft-delete tombstones, and engine bindings. Message bodies, run state, send queues, and unread flags MUST NOT be stored in this catalog.

#### Scenario: Renderer reads catalog via host-api

- **WHEN** the sidebar or catalog overview needs session organization data
- **THEN** the renderer requests it through `host-api` / `api-client` session-catalog routes
- **AND** does not open SQLite or read `engine-sessions.json` directly

#### Scenario: Soft-deleted session hidden from overview

- **WHEN** a catalog session row has `deleted_at` set
- **THEN** default overview queries exclude that session
- **AND** engine transcript files are unchanged until an explicit delete flow runs

### Requirement: Session groups in catalog

Custom sidebar groups SHALL be persisted per `workspace_id` in `session_groups`. Session-to-group assignment SHALL live on `catalog_sessions.group_id`. Empty groups MAY remain visible per product rules.

#### Scenario: Assign session to group

- **WHEN** the user assigns session S to group G in workspace W
- **THEN** the catalog updates S's `group_id` to G under workspace W
- **AND** the sidebar reflects the assignment after catalog refresh

### Requirement: Pin and sort

The catalog SHALL support optional `pin_rank` (lower = higher in list) and stable `sort_key` / `last_activity_at` for ordering. Pin scope is per workspace (global within that workspace's session list, not per-group unless later specified).

#### Scenario: Pin session

- **WHEN** the user pins session S in workspace W
- **THEN** S receives a `pin_rank` value ordering it above unpinned sessions in W
- **AND** unpinned sessions continue to sort by activity or manual order

### Requirement: Engine bindings in catalog

Engine session bindings (OpenClaw and Claude) SHALL be stored in `session_engine_bindings` and accessed through the existing `session-registry.ts` facade. Bindings include `engine_type`, `agent_id`, engine-native session id, optional `cwd`, model, and extensible JSON fields for engine-specific metadata.

#### Scenario: Upsert binding on chat activity

- **WHEN** a session is used with engine E and agent A
- **THEN** the registry facade upserts a binding row for that `session_key`
- **AND** subsequent resolves read from SQLite

#### Scenario: Import legacy engine-sessions.json

- **WHEN** the catalog initializes and bindings table is empty
- **AND** `engine-sessions.json` exists on disk
- **THEN** the system imports entries idempotently into SQLite
- **AND** preserves the JSON file until a later cleanup phase

### Requirement: Session discovery reconcile

The catalog service SHALL reconcile rows from engine-native discovery (e.g. OpenClaw `sessions.json`, runtime session lists) into `catalog_sessions` under the default workspace when no row exists, without overwriting user-edited titles or group assignments.

#### Scenario: Unknown session appears on disk

- **WHEN** reconcile finds a session key not in catalog
- **THEN** it creates a default-workspace catalog row with discovered metadata
- **AND** does not assign a custom group or pin automatically

### Requirement: Migrate localStorage organization state

On upgrade, the system SHALL one-time import `stoclaw-chat-session-labels` (titles/activity) and `stoclaw:sidebar-recent-groups` into catalog tables under workspace `default`, skipping rows already migrated.

#### Scenario: First launch after upgrade

- **WHEN** the app starts with legacy localStorage organization data
- **THEN** catalog rows are created or updated under `default`
- **AND** new writes go to SQLite instead of localStorage

### Requirement: Catalog overview API

Host-api SHALL expose CRUD/list endpoints for workspaces, groups, and catalog sessions sufficient for sidebar rendering and a future catalog overview page. All routes run in Main and use repository transactions.

#### Scenario: List sessions for workspace

- **WHEN** client requests sessions for workspace W
- **THEN** the response includes organization fields and binding summaries for keys in W only
