## ADDED Requirements

### Requirement: System detects workflow intent from natural language
The system SHALL detect when a user's message indicates an intent to create or execute a workflow, even when no `/` slash command is used.

#### Scenario: User mentions workflow keyword
- **WHEN** user sends a message containing workflow-related keywords (e.g., "工作流", "流程", "帮我创建", "执行")
- **THEN** the system SHALL call `POST /agent/v1/workflow-templates/search` with the user's message as the query
- **THEN** if `matchedItems` contains entries with `matchScore >= 0.85`, the system SHALL proceed to workflow parameter confirmation
- **THEN** if `matchScore < 0.85` or no matches, the system SHALL present the template list to the user for manual selection

#### Scenario: Slash command triggers template picker
- **WHEN** user types `/` and selects a template from the `WorkflowPicker`
- **THEN** the system SHALL insert the selected `templateId` into the message context
- **THEN** the system SHALL proceed to fetch the startup schema for that template

#### Scenario: Low confidence match requires user confirmation
- **WHEN** the highest `matchScore` is between `0.60` and `0.85`
- **THEN** the system SHALL present the top 3 matched templates to the user
- **THEN** the system SHALL wait for user selection before proceeding

### Requirement: System prevents workflow intent false positives
The system SHALL NOT trigger workflow mode when the user is clearly engaged in normal conversation.

#### Scenario: User mentions workflow in unrelated context
- **WHEN** user sends "今天的工作流程很顺畅"
- **THEN** the system SHALL NOT trigger workflow search
- **THEN** the message SHALL be sent through normal chat flow

#### Scenario: User explicitly cancels workflow
- **WHEN** user sends "取消" or "不执行了" during workflow configuration
- **THEN** the system SHALL clear `pendingWorkflow` state
- **THEN** the system SHALL resume normal chat flow
