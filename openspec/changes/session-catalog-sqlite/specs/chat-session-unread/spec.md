## ADDED Requirements

### Requirement: Unread persists in localStorage only

The system SHALL persist session unread state in renderer localStorage via the existing session-unread store (`stoclaw:session-unread`). The system MUST NOT store unread red-dot keys in the SQLite session catalog as part of this change.

#### Scenario: Unread survives renderer reload

- **WHEN** a session is marked unread and the renderer reloads
- **THEN** the unread key is still present from localStorage
- **AND** no SQLite catalog table is required to restore that unread flag

#### Scenario: Catalog migration does not own unread

- **WHEN** migration `0002-session-catalog` is applied
- **THEN** the schema does not require an unread/red-dot table for this capability
- **AND** unread continues to use `stoclaw:session-unread`

### Requirement: Mark unread on background successful completion

When a session run completes successfully and that session is not the current viewing session, the system SHALL mark it unread only if the anti-false-positive gates pass: the runId was observed during this app lifetime, startup grace has elapsed, and the session was not recently marked read.

#### Scenario: Background session finishes successfully

- **WHEN** session B completes a successful observed run
- **AND** the user is viewing session A
- **AND** startup grace and recent-read grace do not block
- **THEN** session B is marked unread in the localStorage-backed store

#### Scenario: Current session completion does not mark unread

- **WHEN** the current session completes successfully in the foreground
- **THEN** the system MUST NOT mark that session unread
- **AND** it MAY refresh the session's recent-read timestamp

#### Scenario: Replay or unobserved run is ignored

- **WHEN** a completion event arrives for a runId that was not observed in this app lifetime
- **THEN** the system MUST NOT mark the session unread

### Requirement: Clear unread when opening the session

Switching to or opening a session MUST clear unread for that session (including canonical aliases) and update its recent-read timestamp.

#### Scenario: User opens an unread session

- **WHEN** the user switches to a session that is marked unread
- **THEN** the unread flag is cleared for that session's unread aliases
- **AND** the sidebar no longer shows an unread indicator for that session

### Requirement: Unread red dot left of session title

The sidebar recent-session row SHALL show the unread indicator to the **left of the session title** when the session is unread and is not the current session. Status display MUST remain mutually exclusive with priority: running, then error, then unread. The unread glyph MUST use the existing design-system unread/destructive surface token (e.g. `sidebarUnreadDotClass` aligned with `docs/sto-design.md`), not ad-hoc hex colors.

#### Scenario: Unread session shows leading red dot

- **WHEN** a non-current recent session is unread and not running and has no error status
- **THEN** a red-dot indicator appears to the left of that session's title text

#### Scenario: Running status hides unread glyph

- **WHEN** a session is both unread in storage and currently running
- **THEN** the sidebar shows the running indicator instead of the unread red dot
