## ADDED Requirements

### Requirement: New workflow runs persist their originating chat card
The system SHALL persist a chat-card visibility flag and originating session on a newly started chat workflow run.

#### Scenario: Chat workflow starts
- **WHEN** a new workflow run is successfully started from a chat turn
- **THEN** its `wf_run` row SHALL be marked as chat-card visible for that originating session

#### Scenario: Existing run status is queried
- **WHEN** a chat tool queries the status of an existing workflow run
- **THEN** the system SHALL NOT create a card or change the run's originating session

### Requirement: Chat cards are discovered and rendered independently from messages
The system SHALL query visible run-card references by session and render each card as an independent timeline item.

#### Scenario: Stable user anchor exists
- **WHEN** a card reference contains an originating user message ID
- **THEN** the card SHALL render after that user's assistant turn without changing message content

#### Scenario: Stable user anchor is unavailable
- **WHEN** the originating user message cannot be found
- **THEN** the card SHALL render as a standalone chronological item and SHALL NOT attach to a later assistant reply

### Requirement: Active cards poll SQLite snapshots
The system SHALL update chat workflow cards exclusively through their compact SQLite-backed query interface.

#### Scenario: Run remains active
- **WHEN** a card snapshot is pending, running, waiting for approval, or waiting for input
- **THEN** the card SHALL schedule a non-overlapping follow-up query using the configured active interval

#### Scenario: Run reaches a terminal state
- **WHEN** a snapshot is completed, failed, cancelled, or timed out
- **THEN** the card SHALL stop automatic polling and retain the terminal result

#### Scenario: Snapshot query fails
- **WHEN** a card snapshot query fails transiently
- **THEN** the card SHALL retain its last successful snapshot and retry with bounded backoff

### Requirement: Workflow card presentation supports application themes
The system SHALL preserve semantic status, foreground, background, border, focus, and action styling in light and dark mode.

#### Scenario: Card renders in dark mode
- **WHEN** the application uses dark mode
- **THEN** active and terminal cards SHALL remain readable and use semantic theme tokens without light-only hardcoded surfaces
