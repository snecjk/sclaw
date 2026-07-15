## ADDED Requirements

### Requirement: Default project and Workspaces root

The system SHALL maintain project entities in the session catalog (table `workspaces` or equivalent) with at least `id`, `name`, `root_path`, and `is_default`. On catalog initialization the system MUST ensure a default project with id `default` and `is_default = 1` exists. All current sessions and any session not created inside a user project MUST belong to this default project/workspace.

The system SHALL persist a **projects root directory** (`projects_root_path`) once the user has established it. Resolution for blank-project parent path MUST be:

1. If a persisted `projects_root_path` exists on disk → use it as the default parent for new blank projects
2. Else if a legacy/canonical directory `{openclawConfigDir}/workspaces` already exists on disk → adopt it as `projects_root_path` and use it
3. Else (no workspaces root yet) → **guide the user** to create one, with the suggested location on the **application install drive/volume** (derived from the app executable path), not silently forced under `%USERPROFILE%` / `~`

Path construction MUST use cross-platform helpers. On Windows, install drive means the drive letter of `process.execPath` / `app.getPath('exe')` (e.g. app on `D:\...` → suggest `D:\.stoclaw\openclaw\workspaces`). On macOS/Linux, suggest a path on the same volume as the app bundle/executable (when that volume is writable); the user MAY change the path via the create dialog / folder picker before confirming.

Legacy imported sessions and groups MUST attach to the default project unless explicitly moved into a user project.

#### Scenario: Seed default project on first catalog init

- **WHEN** session-catalog migration has been applied and no default project row exists
- **THEN** the system inserts project id `default` with `is_default = 1`
- **AND** subsequent inits do not create a second default project

#### Scenario: Existing workspaces root is reused

- **WHEN** the user creates a blank project
- **AND** `{openclawConfigDir}/workspaces` or a persisted `projects_root_path` already exists on disk
- **THEN** the create dialog defaults the parent path to that existing root
- **AND** the new project directory is created under that root

#### Scenario: No workspaces root yet — guide to install drive

- **WHEN** the user creates a blank project for the first time
- **AND** no workspaces root exists on disk and none is persisted
- **THEN** the UI guides the user to create a workspaces root
- **AND** the suggested path is on the install drive/volume of the running app
- **AND** the user can confirm or change the path before the root (and project) are created
- **AND** the chosen root is persisted as `projects_root_path` for later blank projects

### Requirement: Default project is invisible in UI copy

The default project/workspace MUST NOT appear in the sidebar「项目」list. The UI MUST NOT show labels such as「default」「未归类」or equivalent for default-bound sessions. Sessions belonging to the default project SHALL appear under the normal「对话」section (as today's non-project conversations), without an extra default/unclassified heading.

#### Scenario: Sidebar shows projects without default entry

- **WHEN** the user opens the sidebar and at least one user project exists
- **THEN**「项目」lists only non-default projects
- **AND** default-bound sessions appear under「对话」with no「default」or「未归类」label

#### Scenario: Non-project new chat stays on default

- **WHEN** the user creates a new chat while not inside a selected user project
- **THEN** the session is bound to the default project in the catalog
- **AND** the UI still presents it only under「对话」without naming the default workspace

### Requirement: Create blank project under workspaces root

The system SHALL allow creating a blank project by name. Creating a blank project MUST create a directory named after the project under the resolved projects root (see Default project and Workspaces root), register the project in the catalog with `root_path` pointing at that directory, and expose it in the sidebar「项目」list. The system MUST NOT seed starter/template files into the new folder unless a later change explicitly requires it.

#### Scenario: Save blank project under existing root

- **WHEN** the user enters a project name and confirms create with an already-established projects root
- **THEN** the system creates `{projectsRoot}/{projectName}/` on disk
- **AND** inserts a catalog project row whose `root_path` is that directory
- **AND** the sidebar lists the new project by name under「项目」
- **AND** the new directory has no required starter markdown/files from this capability

#### Scenario: Reject empty project name

- **WHEN** the user attempts to save a blank project with an empty name
- **THEN** the system MUST NOT create a directory or catalog row

### Requirement: Link existing folder as project

The system SHALL allow creating a project from an existing local folder (directory picker). The catalog project `root_path` MUST be the selected folder. The system MUST NOT require copying that folder into the projects root.

#### Scenario: Use existing folder

- **WHEN** the user chooses「使用现有文件夹」and selects a directory
- **AND** provides or confirms a project display name
- **THEN** the system registers a catalog project with `root_path` equal to the selected directory
- **AND** the sidebar lists that project under「项目」

### Requirement: Sessions use project root as working directory

When a chat session belongs to a non-default project, model tool execution and generated artifacts for that session MUST use the project's `root_path` as the working directory (session/engine cwd override), not the agent-global OpenClaw workspace path. Sessions on the default project MUST continue to use the existing agent workspace path behavior.

#### Scenario: Project session writes under project folder

- **WHEN** the user sends a message in a session bound to project P with `root_path = /path/to/P`
- **AND** the model writes a file via tools
- **THEN** the working directory for that run resolves to `/path/to/P` (or a documented subdir under it)
- **AND** artifacts are stored under that project tree

#### Scenario: Default project keeps agent workspace

- **WHEN** a session is bound only to the default project (`is_default = 1`)
- **THEN** tool cwd resolution uses the existing agent workspace path
- **AND** MUST NOT invent a new folder under the projects root solely for that default session

### Requirement: Sidebar project UI

The sidebar SHALL present a「项目」section listing **user** projects only (never the implicit default). The section SHALL provide actions equivalent to「新建空白项目」and「使用现有文件夹」, including a create dialog with project name and parent path. When no projects root exists yet, the dialog MUST guide creation of the root with an install-drive suggestion. When a projects root already exists, the dialog MUST default to that root. When a user project is selected, conversation lists SHALL show sessions belonging to that project. When no user project is selected (global/default context),「对话」SHALL show default-project sessions without default/unclassified wording. UI chrome MUST follow `docs/sto-design.md`.

#### Scenario: Open create project dialog with existing root

- **WHEN** the user chooses to create a blank project from the sidebar
- **AND** a projects root already exists
- **THEN** a dialog asks for project name and defaults the parent path to that root
- **AND** save remains disabled while the name is empty

#### Scenario: Open create project dialog without root

- **WHEN** the user chooses to create a blank project from the sidebar
- **AND** no projects root exists yet
- **THEN** the dialog guides the user to choose/create a workspaces root
- **AND** the suggested location is on the app install drive/volume
- **AND** save remains disabled while the name is empty

#### Scenario: Switch project filters conversations

- **WHEN** the user selects project P in the sidebar
- **THEN** the conversation list shows sessions with project id equal to P
- **AND** sessions belonging only to other projects (including default) are not listed in that project-scoped view

### Requirement: Project id scopes catalog rows

Catalog sessions and groups MUST remain scoped by project/workspace id so multiple projects do not share organization rows. Session keys need not embed the project id if the catalog binding provides the scope.

#### Scenario: Overview scoped by project id

- **WHEN** two projects each have catalog session rows
- **THEN** overview queries for project A do not return project B's sessions
- **AND** primary keys remain scoped by `(workspace_id, session_key)` or equivalent
