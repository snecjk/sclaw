## ADDED Requirements

### Requirement: Unread state in localStorage

Session unread indicators SHALL continue to persist in localStorage under `stoclaw:session-unread` via `useSessionUnreadStore`. Unread state MUST NOT be migrated to SQLite in this change.

#### Scenario: App restart preserves unread

- **WHEN** the user restarts the app with unread sessions marked
- **THEN** unread keys reload from localStorage
- **AND** dots appear per marking rules after session list renders

### Requirement: Mark unread on background success

The system SHALL mark a session unread when a run completes successfully in the background (not the foreground session), subject to the gates in `session-unread-notify.ts` (observed run, grace period, readAt suppression).

#### Scenario: Background completion

- **WHEN** session S completes successfully while the user views session T
- **THEN** S is marked unread in the store
- **AND** T is not marked unread solely due to S's completion

### Requirement: Clear unread on open

When the user opens or switches to a session, the system SHALL mark that session read (clear unread, update `readAt`).

#### Scenario: Switch to unread session

- **WHEN** the user selects session S that was unread
- **THEN** unread clears for S and aliases
- **AND** `readAt` updates for the canonical key

### Requirement: Unread dot left of title

In sidebar recent session rows, the unread indicator SHALL render **immediately left of the session title text**, using `sidebarUnreadDotClass` from `src/lib/surfaces.ts` and semantic tokens from `docs/sto-design.md`. The trailing status area SHALL NOT show the unread dot.

#### Scenario: Unread session in expanded sidebar

- **WHEN** session S is unread and not running or failed
- **THEN** a dot appears left of S's title
- **AND** the trailing status slot is empty for unread

### Requirement: Status priority

Sidebar session status SHALL follow priority: **running** > **error** > **unread**. Running shows the running icon in the trailing slot; error shows the error icon; unread shows only the left-of-title dot (no trailing unread).

#### Scenario: Running suppresses unread display

- **WHEN** session S is both unread and running
- **THEN** the trailing slot shows running
- **AND** the left-of-title unread dot is hidden

#### Scenario: Error suppresses unread display

- **WHEN** session S has a failed run error
- **THEN** the trailing slot shows error
- **AND** the left-of-title unread dot is hidden
