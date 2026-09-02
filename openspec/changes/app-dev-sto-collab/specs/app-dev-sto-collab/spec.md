## ADDED Requirements

### Requirement: Cloud catalog is authoritative
The development-app catalog MUST treat `sto-app apps list` as the authoritative set of user-owned apps. Device-local bindings MUST only record where each cloud app is checked out on this machine.

#### Scenario: list shows cloud apps after local folder deleted
- **WHEN** the user deletes a local app directory but the app still exists in `apps list`
- **THEN** the catalog MUST still show that app as not locally ready (needs clone), not omit it

#### Scenario: CLI list failure is visible
- **WHEN** `sto-app apps list` fails or is unavailable
- **THEN** the UI MUST show a recoverable error and MUST NOT silently replace the catalog with a local-only authority list

### Requirement: Local binding and edit vs clone
When a cloud app has a valid local path and workspace binding, the user MUST be able to open the workbench. When local path is missing or invalid, the user MUST choose a parent directory each time before clone.

#### Scenario: local ready opens workbench
- **WHEN** a listed app has an existing local path with app-dev marker and workspaceId
- **THEN** the primary action MUST open the existing workbench for that workspace

#### Scenario: clone requires user-selected directory
- **WHEN** the user chooses to pull a remote-only or path-missing app
- **THEN** SClaw MUST prompt the user to select and confirm a parent directory, then run `sto-app clone <applicationId> <targetDir>` and create/bind a workspace

#### Scenario: clone refuses non-empty target
- **WHEN** the computed target directory exists and is not empty
- **THEN** clone MUST fail with a clear error and MUST NOT overwrite files

### Requirement: Collaboration commands via CLI
Create, status, pull, push, and merge-continue MUST go through the `sto-app` CLI wrapper (no direct Git). Push flows MUST pull first when the working tree is bound.

#### Scenario: push after pull
- **WHEN** the user submits code for a bound app
- **THEN** the host MUST attempt `pull` before `push` (or surface remote-ahead / merge-required instead of force-writing)

#### Scenario: merge continue after AI resolution
- **WHEN** sync state is merge-required and a revisionId is available after the user resolves conflicts
- **THEN** the host MUST support `sto-app merge continue --remote <revisionId>` and then allow push

### Requirement: Status visibility
The workbench MUST expose STO bind/sync status from `sto-app status`, including dark-mode readable status chips using semantic theme tokens.

#### Scenario: status chip dark mode
- **WHEN** the workbench header shows STO sync state in dark mode
- **THEN** text and chip backgrounds MUST remain readable via semantic tokens (not light-only hardcoded fills)
