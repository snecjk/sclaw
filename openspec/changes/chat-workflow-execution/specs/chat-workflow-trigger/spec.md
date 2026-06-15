## ADDED Requirements

### Requirement: User can trigger workflow selection via slash command
The system SHALL provide a slash command mechanism in the chat input that allows users to select a workflow template.

#### Scenario: User types slash to open workflow picker
- **WHEN** the user types `/` in the chat input or clicks the `/` button
- **THEN** a dropdown list of available workflow templates SHALL appear below the input

#### Scenario: User selects a workflow template
- **WHEN** the user clicks a workflow template from the dropdown
- **THEN** the dropdown SHALL close
- **THEN** a WorkflowChip SHALL appear above the input area showing the selected template name
- **THEN** the selected `workflowId` SHALL be stored in the component state

### Requirement: Workflow chip can be cleared
The system SHALL allow the user to clear the selected workflow before sending a message.

#### Scenario: User clears workflow with backspace
- **WHEN** the user presses Backspace in an empty chat input while a workflow is selected
- **THEN** the WorkflowChip SHALL be removed
- **THEN** the stored `workflowId` SHALL be cleared

#### Scenario: User clicks to dismiss workflow chip
- **WHEN** the user clicks the X icon on the WorkflowChip
- **THEN** the WorkflowChip SHALL be removed
- **THEN** the stored `workflowId` SHALL be cleared

### Requirement: Message with workflow cannot be empty
The system SHALL prevent sending a message that only has a workflow selected without user text content.

#### Scenario: User tries to send empty workflow message
- **WHEN** the user clicks Send while a workflow is selected but the input text is empty
- **THEN** the message SHALL NOT be sent
- **THEN** the send button SHALL remain disabled

### Requirement: Send message carries workflow identifier
The system SHALL include the selected `workflowId` when sending a message that has a workflow selected.

#### Scenario: User sends message with workflow
- **WHEN** the user types text and clicks Send while a workflow is selected
- **THEN** the message SHALL be sent with the `workflowId` included in the send payload
- **THEN** the chat store's `sendMessage` method SHALL receive the `workflowId` parameter
- **THEN** the `workflowId` SHALL be included in the Gateway `chat.send` RPC parameters
