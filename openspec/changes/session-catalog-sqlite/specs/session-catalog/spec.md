## ADDED Requirements

### Requirement: SQLite session catalog storage

The system SHALL persist session organization metadata in the existing Main-process SQLite database `stoclaw.sqlite` via a versioned migration. The catalog MUST include tables for session directory rows, custom groups, and engine bindings. The system MUST NOT store chat transcript message bodies in SQLite as part of this capability.

#### Scenario: Migration applies catalog schema

- **WHEN** the application starts and migration version 2 has not been applied
- **THEN** the migrator applies the session-catalog schema to `stoclaw.sqlite`
- **AND** subsequent starts skip re-applying that migration version

#### Scenario: Transcript remains on filesystem

- **WHEN** a chat or task run appends assistant output
- **THEN** the message body is written to the engine JSONL (or Claude SDK) transcript path
- **AND** SQLite catalog rows are updated only for organization metadata such as title or last activity when applicable

### Requirement: Engine binding registry facade

The system SHALL store engine session bindings (engine id, agent id, engine session id, cwd, model, account, archived session ids, pending history bridge) in SQLite. Exported Main-process APIs equivalent to `listEngineSessionRegistryEntries`, `getEngineSessionRegistryEntry`, `upsertEngineSessionRegistryEntry`, and `deleteEngineSessionRegistryEntry` MUST continue to work for existing callers without requiring those callers to open SQLite directly.

#### Scenario: Upsert binding through existing API

- **WHEN** Claude adapter upserts a registry entry for a session key
- **THEN** the binding is persisted in SQLite
- **AND** a subsequent get by session key returns the stored fields

#### Scenario: Import from legacy JSON

- **WHEN** catalog initialization finds `engine-sessions.json` and bindings have not yet been imported
- **THEN** the system imports entries into SQLite idempotently
- **AND** later reads prefer the SQLite bindings

### Requirement: Reconcile discovered sessions into catalog

The system SHALL upsert discovered sessions from the existing engine and task list sources into catalog session rows without replacing those discovery APIs. Catalog organization fields (group, pin, sort, title override, soft-delete) MUST be authoritative when presenting sidebar organization.

#### Scenario: Load sessions overlays catalog fields

- **WHEN** the renderer loads sessions for the sidebar
- **THEN** Main reconciles discovered session keys into the catalog for the active logical workspace
- **AND** the response includes catalog organization fields for those sessions
- **AND** chat send and history continue to use existing engine adapters

#### Scenario: Soft-deleted session stays hidden

- **WHEN** a session key is soft-deleted in the catalog
- **AND** a later engine or task list still returns that key
- **THEN** the session MUST remain hidden from the sidebar overview
- **AND** the system MUST NOT clear the tombstone solely because the key reappeared in discovery

### Requirement: Custom groups via host-api

The system SHALL expose host-api routes under `/api/session-catalog/` for creating, renaming, dissolving groups and assigning or unassigning sessions. The renderer MUST call these routes through `host-api` / `api-client` and MUST NOT open SQLite or invoke ad-hoc Electron IPC for catalog writes. Group persistence MUST NOT rely on `localStorage` as the source of truth after migration.

#### Scenario: Assign session to group

- **WHEN** the user assigns a session to a group through the sidebar UI
- **THEN** the renderer calls the session-catalog host-api
- **AND** the assignment is stored in SQLite for the session's workspace
- **AND** a subsequent overview reload shows the session under that group

#### Scenario: Import legacy localStorage groups

- **WHEN** the client still has `stoclaw:sidebar-recent-groups` data and catalog groups have not been imported
- **THEN** the system imports groups and session assignments into SQLite idempotently
- **AND** later group reads use the catalog API

### Requirement: Global pin and ordered sessions

The system SHALL support marking sessions as globally pinned with a pin rank, and SHALL support manual sort order within a group or the ungrouped list. When presenting the sidebar overview, the system MUST order sessions as: pinned by `pin_rank` ascending, then groups by group `sort_order` ascending, then within each section manual `sort_order` when set, otherwise last activity descending.

#### Scenario: Pinned session appears above groups

- **WHEN** a session is pinned and other sessions exist in groups
- **THEN** the overview lists the pinned session in the pinned section before group sections

#### Scenario: Manual order overrides activity within a group

- **WHEN** two sessions in the same group have explicit sort orders
- **THEN** they appear in ascending sort order regardless of last activity timestamps

### Requirement: Soft-delete tombstones in catalog

The system SHALL record user-initiated session deletions as soft-deletes in the catalog (`deleted_at` set). Deleted-key listing used by the UI MUST be satisfiable from the catalog after migration. Existing engine-side cleanup (JSONL rename / registry delete) MAY still run as today.

#### Scenario: Delete session records catalog tombstone

- **WHEN** the user deletes a session through the existing delete flow
- **THEN** the catalog marks that session soft-deleted
- **AND** `/api/sessions/deleted-keys` (or equivalent catalog-backed listing) includes the key

### Requirement: Titles and activity in catalog

The system SHALL persist session title/label and last-activity timestamps in the catalog. When a catalog title is set, overview presentation MUST prefer it over a transient engine label. Client localStorage label bags MUST NOT remain the source of truth after successful import.

#### Scenario: Catalog title wins

- **WHEN** a session has both a catalog title and an engine-provided label
- **THEN** the sidebar displays the catalog title

### Requirement: Catalog access boundary

Renderer code MUST access catalog data only through host-api. Main-process services MUST use repositories for SQL. The system MUST NOT add direct Gateway HTTP calls from the renderer for catalog operations.

#### Scenario: Renderer uses host-api only

- **WHEN** the sidebar needs group or overview data
- **THEN** it fetches via `hostApiFetch` (or api-client wrapper) to `/api/session-catalog/*`
- **AND** it does not call `window.electron.ipcRenderer.invoke` for catalog reads or writes from page/components
