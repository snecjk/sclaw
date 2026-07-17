## ADDED Requirements

### Requirement: Workspace is a user-selected local directory

A **workspace** (sidebar「项目」) SHALL be a catalog entity whose `root_path` is a **user-chosen local directory** on disk. The system MUST NOT treat workspace creation as silently auto-placing data under a fixed install-drive or profile path without user confirmation. Creating a workspace means: user provides a display name, user selects or confirms the folder (directory picker or equivalent), catalog stores the binding, and subsequent sessions created in that workspace context use that `root_path` as the tool/artifact working directory.

Optional helpers (e.g.「新建空白项目」creating a new empty folder) MAY exist, but the **authoritative** workspace location is always the path the user selects or confirms—not an app-inferred default alone.

#### Scenario: User links an existing folder as workspace

- **WHEN** the user chooses「使用现有文件夹」and picks a directory
- **AND** confirms a workspace display name
- **THEN** the system registers a catalog workspace with `root_path` equal to that directory
- **AND** the sidebar lists the workspace under「项目」

#### Scenario: User creates workspace with a new folder they choose

- **WHEN** the user creates a workspace and confirms a parent directory and folder name via the UI
- **THEN** the system creates that folder only at the user-confirmed location
- **AND** registers `root_path` to that folder
- **AND** does not require a global app-owned `workspaces` root tree

### Requirement: Sessions bind to workspace in catalog

Each chat session SHALL be associated with exactly one workspace id in the session catalog (`workspace_id` / project id). Tool cwd, engine bindings, and sidebar filtering for project-scoped views MUST resolve from that workspace's `root_path` when the workspace is not the implicit default.

#### Scenario: New chat inside a selected workspace

- **WHEN** the user starts a new chat while workspace W is selected in the sidebar
- **THEN** the new session's catalog row references workspace W
- **AND** model tool runs for that session use W's `root_path` as working directory

#### Scenario: Non-project chat uses default workspace

- **WHEN** the user starts a new chat without selecting a user workspace (global「对话」context)
- **THEN** the session binds to the implicit default workspace id `default`
- **AND** tool cwd continues to use existing agent-global workspace behavior
- **AND** the UI shows the session only under「对话」without naming default

### Requirement: Default workspace is invisible in UI copy

The default workspace MUST NOT appear in the sidebar「项目」list. The UI MUST NOT show labels such as「default」「未归类」. Default-bound sessions appear under「对话」as today.

#### Scenario: Sidebar lists only user workspaces

- **WHEN** the user opens the sidebar
- **THEN**「项目」lists only user-created workspaces (non-default)
- **AND** default-bound sessions appear under「对话」with no default/unclassified label

### Requirement: No install-drive or profile migration in this change

This change MUST NOT implement migrating the global `~/.stoclaw` / `%USERPROFILE%\.stoclaw` tree to an install-drive location. Future relocation of app-wide config data is out of scope. Workspace `root_path` values are independent per-user folder choices and are not derived from install path.

#### Scenario: Workspace path is independent of app install location

- **WHEN** the user creates a workspace on drive E: while the app is installed on drive C:
- **THEN** `root_path` may be on E: as the user selected
- **AND** the system does not move or copy the global `.stoclaw` config tree as part of workspace creation

### Requirement: Workspace id scopes catalog organization rows

Sessions, groups, pin/sort, and titles scoped in the catalog MUST use `(workspace_id, session_key)` (or equivalent) so multiple workspaces do not share organization metadata.

#### Scenario: Sessions in different workspaces are isolated in catalog queries

- **WHEN** workspace A and workspace B each have sessions
- **THEN** overview queries for A do not return B's sessions
- **AND** the same session key string in two workspaces remains disambiguated by `workspace_id`

### Requirement: Sidebar project UI

The sidebar SHALL present a「项目」section for user workspaces with actions to create/link a workspace (name + folder selection). Selecting a workspace filters「对话」/session list to sessions bound to that workspace. UI chrome MUST follow `docs/sto-design.md`.

#### Scenario: Select workspace filters sessions

- **WHEN** the user selects workspace W in the sidebar
- **THEN** the conversation list shows sessions whose catalog binding is W
- **AND** sessions bound only to other workspaces (including default) are not shown in that scoped view
