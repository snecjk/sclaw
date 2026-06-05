## ADDED Requirements

### Requirement: Scheduled task local session creation on first trigger
The system SHALL create a local session for a scheduled task when the task is triggered for the first time, if no session already exists for that task.

#### Scenario: First trigger creates session
- **WHEN** user triggers a scheduled task that has no existing local session
- **THEN** the system SHALL create a new `.jsonl` session file under `{openClawConfigDir}/scheduled-tasks/{taskId}/sessions/`
- **AND** register the session in `sessions.json` with key `scheduled-task:{taskId}`
- **AND** the session label SHALL default to the task name

### Requirement: Scheduled task local session reuse on subsequent triggers
The system SHALL reuse the existing local session for a scheduled task on all subsequent triggers, appending new results to the same session transcript.

#### Scenario: Subsequent trigger reuses session
- **WHEN** user triggers a scheduled task that already has a local session
- **THEN** the system SHALL locate the existing `.jsonl` file via `sessions.json`
- **AND** append the new execution result to the same transcript without creating a new session

### Requirement: Execution result appended as assistant message
The system SHALL append the trigger execution result as a `type: "message"` line in the session `.jsonl` transcript, with the message role set to `assistant`.

#### Scenario: Successful execution result appended
- **WHEN** a scheduled task trigger returns `run.status` of `success` with a non-empty `executionResult`
- **THEN** the system SHALL append a message line containing `run.executionResult` as the `content` of an `assistant` message
- **AND** the message timestamp SHALL use the trigger response time

#### Scenario: Failed execution result appended
- **WHEN** a scheduled task trigger returns `run.status` of `failed`
- **THEN** the system SHALL append a message line containing the failure indicator and `run.executionResult` or `run.logText` as the `content`
- **AND** the message role SHALL remain `assistant`

### Requirement: Execution log appended as system message
The system SHALL append the trigger execution log (`logText`) as a separate `type: "message"` line with role `system`, when `logText` is present and non-empty.

#### Scenario: Log text appended alongside result
- **WHEN** a scheduled task trigger returns a non-empty `run.logText`
- **THEN** the system SHALL append a `system` message containing `run.logText` immediately after the `assistant` message

### Requirement: Session history readable via host API
The system SHALL expose a host API endpoint that allows the renderer to read the local session history for a given scheduled task session key.

#### Scenario: Frontend requests session history
- **WHEN** the renderer requests `/api/scheduled-tasks/session-history?sessionKey=scheduled-task:{taskId}`
- **THEN** the main process SHALL read the corresponding `.jsonl` transcript
- **AND** return the messages in chronological order as a JSON array
- **AND** return an empty array if the session does not exist

### Requirement: Session key parsing support in chat store
The chat store session utilities SHALL recognize session keys with the `scheduled-task:` prefix and route history loading to the scheduled task session history endpoint.

#### Scenario: Chat store loads scheduled task history
- **WHEN** the active session key starts with `scheduled-task:`
- **THEN** the chat store SHALL call `/api/scheduled-tasks/session-history` instead of the Gateway history endpoint
- **AND** render the returned messages in the chat interface

### Requirement: Trigger response returns session presence to frontend
The scheduled task trigger API response SHALL include a flag indicating whether the result has been persisted to a local session, so the frontend can guide the user to view it.

#### Scenario: Frontend knows session is ready
- **WHEN** the renderer receives the trigger response
- **THEN** the response body SHALL contain `hasSession: true` if the result was successfully written to the local session
- **AND** `hasSession: false` if the write failed or the result was not persisted
