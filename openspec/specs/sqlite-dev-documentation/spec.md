# sqlite-dev-documentation

## Purpose

Maintain developer-facing documentation for StoClaw's local SQLite database (`stoclaw.sqlite`): installation, startup, file location, table reference, queries, and data boundaries.

## Requirements

### Requirement: SQLite developer guide exists

The repository SHALL include `docs/sqlite-dev-guide.md` as the canonical developer guide for the local SQLite database used by StoClaw.

#### Scenario: Developer finds setup instructions

- **WHEN** a developer clones the repository and needs to run the app with SQLite enabled
- **THEN** the guide SHALL document `pnpm run init` and `pnpm dev` (or equivalent from `README.md`)
- **THEN** the guide SHALL state that SQLite initializes in the Main process on app startup

#### Scenario: Developer locates the database file

- **WHEN** a developer needs to open `stoclaw.sqlite` on disk
- **THEN** the guide SHALL document the path pattern `app.getPath('userData')/sqlite/stoclaw.sqlite`
- **THEN** the guide SHALL include macOS Finder navigation (`Cmd+Shift+G`) and absolute-path examples

#### Scenario: Developer understands table responsibilities

- **WHEN** a developer inspects session or project data
- **THEN** the guide SHALL list all current tables and their purpose
- **THEN** the guide SHALL distinguish session catalog tables from demo / migration tables
- **THEN** the guide SHALL document which data is NOT stored in SQLite (messages, unread, queues)

#### Scenario: Developer runs ad-hoc queries

- **WHEN** a developer wants to browse or query data
- **THEN** the guide SHALL provide example SQL for common session/project queries
- **THEN** the guide SHALL reference DB Browser for SQLite and `sqlite3` CLI usage

### Requirement: Architecture doc cross-reference

`docs/sqlite-local-db-architecture.md` SHALL link to `docs/sqlite-dev-guide.md` for operational instructions.

#### Scenario: Reader starts from architecture doc

- **WHEN** a developer reads the SQLite architecture document
- **THEN** they SHALL find a link to the developer guide for install, paths, and debugging
