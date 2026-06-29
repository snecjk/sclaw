## ADDED Requirements

### Requirement: Renderer handles workflow tool results
The system SHALL listen for `toolresult` messages from workflow builtin tools and update the chat UI without requiring Gateway `chat.send` for execution acknowledgement.

#### Scenario: execute_workflow tool result arrives
- **WHEN** a `toolresult` for `execute_workflow` contains `type: workflow_execution_started`
- **THEN** the Renderer SHALL append a local assistant turn with `workflow_card`
- **THEN** the Renderer SHALL start `workflow:startTracking` for the returned `runId`

#### Scenario: Duplicate tool results are ignored
- **WHEN** the same `toolresult` message id was already processed
- **THEN** the listener SHALL NOT start tracking or append duplicate cards

### Requirement: Scheduled task listener integrates with builtin tool hub
The system SHALL route `scheduled_task_confirmation` tool results through the shared builtin tool listener hub.

#### Scenario: create_scheduled_task result on Home
- **WHEN** `create_scheduled_task` returns `scheduled_task_confirmation`
- **THEN** the existing TaskCreateModal pre-fill behavior SHALL remain available via the hub
