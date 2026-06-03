## ADDED Requirements

### Requirement: Sidebar displays unread badge for scheduled task results
The system SHALL display an unread badge (red dot) on the Scheduled Tasks navigation item in the Sidebar when new cloud execution results have been received and not yet viewed by the user. The badge SHALL be driven by a Zustand store that tracks unread task IDs. The store SHALL be updated via an IPC event pushed from the Main process.

#### Scenario: New cloud result triggers unread badge
- **WHEN** the Main process poller discovers a new execution result for task `task-6`
- **THEN** the Main process sends `scheduled-task:new-result` IPC event to the Renderer
- **AND** the Renderer adds `task-6` to the unread set
- **AND** the Sidebar Scheduled Tasks nav item displays a red dot badge

#### Scenario: Multiple tasks have unread results
- **WHEN** new results arrive for three different tasks in the same polling tick
- **THEN** all three task IDs are added to the unread set
- **AND** the Sidebar displays a single red dot indicating unread items

#### Scenario: No unread results
- **WHEN** the unread set is empty
- **THEN** the Sidebar Scheduled Tasks nav item SHALL NOT display a red dot

### Requirement: Unread state is cleared when user views Scheduled Tasks page
The system SHALL clear the unread state for all scheduled tasks when the user navigates to the Scheduled Tasks page (`/scheduled-tasks`). The system SHALL NOT clear the unread state for individual tasks separately.

#### Scenario: User clicks Scheduled Tasks nav item
- **WHEN** the user clicks the Scheduled Tasks link in the Sidebar
- **AND** the app navigates to `/scheduled-tasks`
- **THEN** the unread set is cleared
- **AND** the red dot badge disappears from the Sidebar

#### Scenario: User already on Scheduled Tasks page when new result arrives
- **WHEN** the user is currently viewing `/scheduled-tasks`
- **AND** a new cloud result arrives via IPC
- **THEN** the result is appended to the local session
- **AND** the unread set SHALL NOT be updated (no red dot while on the page)

### Requirement: Unread state survives renderer reload but not app restart
The system MAY persist the unread set in memory only. The unread state SHALL be reset when the application restarts. This is acceptable because the user can see all new results by opening the Scheduled Tasks page or the corresponding chat session.

#### Scenario: App restarts with pending unread results
- **WHEN** StoClaw restarts
- **AND** there were unread results before the restart
- **THEN** the unread set is initialized empty
- **AND** no red dot is shown initially
- **AND** any missed results are compensated by the startup poll and appended to sessions

### Requirement: IPC channel for scheduled task new results
The system SHALL expose a one-way IPC channel `scheduled-task:new-result` from Main to Renderer. The channel SHALL be registered in the preload script's `validChannels` list. The payload SHALL include at minimum the `taskId`, `taskName`, `runId`, and `status` of the new result.

#### Scenario: Main process pushes new result notification
- **WHEN** the poller processes a new result
- **THEN** the Main process calls `mainWindow.webContents.send('scheduled-task:new-result', payload)`
- **AND** the Renderer receives the event via `window.electron.ipcRenderer.on('scheduled-task:new-result', callback)`
- **AND** the callback updates the unread store

#### Scenario: Renderer subscribes to channel on mount
- **WHEN** the app initializes
- **THEN** the Renderer registers the IPC listener for `scheduled-task:new-result`
- **AND** unsubscribes on unmount to prevent duplicate handlers
