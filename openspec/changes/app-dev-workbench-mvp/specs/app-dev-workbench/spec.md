# app-dev-workbench

## ADDED Requirements

### Requirement: Chat-plus-preview workbench layout
The system SHALL provide a workbench page with the existing Chat (bound to the app's project agent) on the left and a live preview pane (existing webview container loading the dev server URL) on the right, with a status bar showing environment/run state using semantic tokens.

#### Scenario: Preview auto-loads when ready
- **WHEN** the dev server becomes ready for the current app
- **THEN** the preview pane SHALL automatically load the local preview URL without user action

#### Scenario: Dark mode
- **WHEN** the workbench renders in dark mode
- **THEN** layout chrome, status indicators, progress and error states SHALL use semantic theme tokens per docs/sto-design.md with readable contrast, including hover/focus/disabled states

### Requirement: Renderer accesses all capabilities through host-api
The workbench SHALL invoke creation, environment setup, dev server control, and checkpoint operations exclusively through `src/lib/host-api.ts` wrappers.

#### Scenario: No direct IPC from pages
- **WHEN** workbench components need Main-process capabilities
- **THEN** they SHALL call host-api functions and SHALL NOT call `window.electron.ipcRenderer.invoke(...)` directly

### Requirement: Error feedback loop to agent
The system SHALL feed dev server compile errors and preview page runtime errors to the project agent automatically for self-repair, showing the user a non-technical "fixing" state instead of raw logs.

#### Scenario: Vite compile error
- **WHEN** the dev server emits a compile error after an agent edit
- **THEN** the error text SHALL be delivered to the project agent conversation for automatic repair
- **AND** the workbench SHALL indicate a repairing state until the error clears
