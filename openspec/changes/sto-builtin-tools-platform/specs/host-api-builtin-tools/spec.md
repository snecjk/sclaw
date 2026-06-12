## ADDED Requirements

### Requirement: STO builtin workflow tools are registered in Gateway
The system SHALL register `search_workflow_templates` and `execute_workflow` as OpenClaw Plugin Tools via `sto-workflow-tool`, calling STO HTTP APIs with `stoToken` authentication.

#### Scenario: Model searches workflow templates
- **WHEN** the model invokes `search_workflow_templates` with a query string
- **THEN** the plugin SHALL POST to `/agent/v1/workflow-templates/search`
- **THEN** the tool result SHALL include `type: workflow_templates_found` and template items

#### Scenario: Model executes an existing workflow
- **WHEN** the model invokes `execute_workflow` with a `workflowId`
- **THEN** the plugin SHALL POST to `/agent/v1/workflows/{workflowId}/start`
- **THEN** the tool result SHALL include `type: workflow_execution_started` with `runId` and `workflowId`

### Requirement: Builtin tool responses use a stable envelope
The system SHALL return tool results as JSON with fields `type`, `success`, `domain`, and optional `data` / `error`.

#### Scenario: Tool execution succeeds
- **WHEN** a builtin tool completes successfully
- **THEN** `success` SHALL be `true`
- **THEN** `type` SHALL match the tool contract documented in `plans/sto-builtin-tools-platform.md`

#### Scenario: Tool execution fails
- **WHEN** the STO API returns an error or network failure occurs
- **THEN** `success` SHALL be `false`
- **THEN** `type` SHALL be `sto_tool_error` or a domain-specific error type
