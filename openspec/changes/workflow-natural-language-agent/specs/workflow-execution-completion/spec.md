## ADDED Requirements

### Requirement: System triggers AI summary after workflow completion
The system SHALL automatically notify the AI when a workflow execution completes, providing structured result data so the AI can generate a natural language summary.

#### Scenario: Tracker detects completed status
- **WHEN** `WorkflowExecutionTracker` detects `status` changed to `completed` or `failed`
- **THEN** the Tracker SHALL include `result` and `artifacts` in the `workflow:status-update` IPC payload
- **THEN** the frontend SHALL construct a structured user message containing the execution results
- **THEN** the frontend SHALL send this message via `chat.send` to trigger AI response generation

#### Scenario: AI generates result summary
- **WHEN** the AI receives a message tagged with `[workflow:complete]` containing result data
- **THEN** the AI SHALL generate a natural language summary including: execution status, key metrics from `result.data`, anomaly overview, and artifact links
- **THEN** the AI SHALL present artifact links in a user-friendly format (e.g., "总部对账单（产物）")

#### Scenario: Failed execution summary
- **WHEN** workflow execution fails
- **THEN** the AI SHALL generate a summary explaining the failure reason from `error` field
- **THEN** the AI SHALL suggest possible next steps (retry, modify parameters, contact support)

### Requirement: System preserves workflow execution artifacts
The system SHALL ensure workflow output artifacts are accessible and previewable after execution.

#### Scenario: Artifact is rendered in completion summary
- **WHEN** the workflow result includes `artifacts` with `uri` and `contentType`
- **THEN** the AI summary message SHALL include artifact references
- **THEN** the frontend SHALL render artifact cards with "查看产物" action
- **THEN** clicking the action SHALL open the artifact in the preview panel or external application based on `contentType`
