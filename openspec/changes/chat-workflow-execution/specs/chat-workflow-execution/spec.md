## ADDED Requirements

### Requirement: System executes workflow after creation
The system SHALL execute the created workflow by calling the backend execute API.

#### Scenario: Workflow is executed
- **WHEN** the workflow creation API returns a `workflowId`
- **THEN** the system SHALL call `POST /api/workflows/:workflowId/execute` with `sessionKey` and `agentId`
- **THEN** the response SHALL contain an `executionId`
- **THEN** the system SHALL send the original message via Gateway `chat.send` with `workflowId` and `executionId` attached

### Requirement: Main Process tracks workflow execution via polling
The system SHALL maintain a `WorkflowExecutionTracker` in the Main Process that polls the backend for execution status updates.

#### Scenario: Tracker starts polling
- **WHEN** the frontend invokes `workflow:startTracking` IPC with `executionId`, `sessionKey`, and `workflowId`
- **THEN** the Tracker SHALL create an `ExecutionSession` in its internal Map
- **THEN** the Tracker SHALL start polling `GET /api/workflows/:id/status/:executionId` every 2 seconds
- **THEN** the Tracker SHALL continue polling until the status is `completed`, `failed`, or a 10-minute timeout occurs

### Requirement: Tracker enforces resource limits
The system SHALL limit the number of concurrently tracked executions to prevent memory exhaustion.

#### Scenario: Tracker reaches capacity
- **WHEN** the Tracker's internal Map reaches 50 sessions
- **THEN** the oldest `completed` or `failed` sessions SHALL be evicted before adding new ones
- **THEN** completed/failed sessions SHALL be automatically removed after 5 minutes

### Requirement: Execution state updates are pushed via IPC
The system SHALL push execution state updates from the Main Process to the Renderer via IPC, scoped to the correct session.

#### Scenario: State update is broadcast
- **WHEN** the Tracker detects a state change during polling
- **THEN** the Tracker SHALL broadcast `workflow:status-update` to all web contents
- **THEN** the payload SHALL include `executionId`, `sessionKey`, and the full state object
- **THEN** the Renderer SHALL ignore updates where `sessionKey` does not match the current session

#### Scenario: Progress updates are throttled
- **WHEN** the execution progress changes by less than 10 percentage points
- **THEN** the update SHALL be skipped to avoid excessive IPC traffic
- **THEN** state changes (pending → running → completed/failed) and step completions SHALL always be broadcast regardless of progress delta

### Requirement: Renderer renders workflow execution card
The system SHALL render a live-updating workflow execution card within the assistant message bubble.

#### Scenario: Card is rendered in message
- **WHEN** an assistant message contains a `workflow_card` content block
- **THEN** the `ChatMessage` component SHALL render a `WorkflowCard` instead of plain text for that block
- **THEN** the card SHALL display the template name, current status, progress bar, and step timeline
- **THEN** the card SHALL read its live state from the chat store's `workflowCardStates[executionId]`

#### Scenario: Card updates in real-time
- **WHEN** a `workflow:status-update` IPC is received for the card's `executionId`
- **THEN** the card SHALL re-render with the updated status, progress, and steps
- **THEN** the update SHALL NOT create a new message bubble

### Requirement: Page refresh restores workflow card state
The system SHALL recover the workflow card state after a page refresh.

#### Scenario: State is synced on page load
- **WHEN** the Renderer page loads
- **THEN** the system SHALL scan existing messages for `workflow_card` blocks
- **THEN** for each `executionId`, the system SHALL invoke `workflow:sync-state` IPC
- **THEN** if the Tracker returns a state, the card SHALL be restored to that state

#### Scenario: Tracker state is cleaned up
- **WHEN** `workflow:sync-state` returns `null` (Tracker has cleaned up the session)
- **THEN** the system SHALL fallback to querying the backend directly
- **THEN** if the backend returns a `completed` or `failed` state, the card SHALL show the final result
- **THEN** if the backend also has no record, the card SHALL display `status: 'unknown'` with an error message

### Requirement: Tracker handles polling errors gracefully
The system SHALL handle backend polling failures with retry logic and user-friendly error messages.

#### Scenario: Polling fails temporarily
- **WHEN** a poll request fails with a network or 5xx error
- **THEN** the Tracker SHALL retry with exponential backoff (2s, 4s, 8s, up to 30s)
- **THEN** after 3 failed retries, the execution SHALL be marked as `failed`

#### Scenario: Polling receives 404
- **WHEN** a poll request returns 404
- **THEN** the execution SHALL be immediately marked as `failed`
- **THEN** the error message SHALL be user-friendly ("工作流执行记录不存在，可能已被清理")

### Requirement: Execution completion triggers follow-up
The system SHALL allow the model to continue the conversation based on the workflow execution result.

#### Scenario: Workflow completes successfully
- **WHEN** the execution status becomes `completed`
- **THEN** the frontend MAY automatically send a follow-up message containing the result summary
- **THEN** the model SHALL receive the result as context and continue the conversation naturally
