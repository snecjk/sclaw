## ADDED Requirements

### Requirement: Installed skill use creates an editable draft
The system SHALL create a new chat session and prefill the Home composer with the installed skill default prompt when the user chooses to use an installed skill from the skill plaza.

#### Scenario: Skill card use preloads composer
- **WHEN** the user clicks an installed skill card's use action
- **THEN** the Home composer SHALL contain the skill's default prompt or title as editable draft text
- **AND** the system MUST NOT send the draft until the user explicitly sends it
- **AND** the composer SHALL focus the caret at the end of the draft after one separator space

#### Scenario: Skill detail use preloads composer
- **WHEN** the user clicks an installed skill detail modal's use-now action
- **THEN** the modal SHALL close and the Home composer SHALL contain the skill's default prompt or title as editable draft text
- **AND** the system MUST NOT create a user message until the user explicitly sends it
- **AND** the composer SHALL focus the caret at the end of the draft after one separator space

#### Scenario: URL cleanup preserves draft
- **WHEN** the Home route consumes a pure `q` query parameter from skill use and clears the URL
- **THEN** the prefilled composer draft SHALL remain visible and editable

### Requirement: Workflow deep-link send behavior is preserved
The system SHALL keep existing workflow deep-link behavior when a Home route contains both a prompt query and a workflow id.

#### Scenario: Workflow prompt link still auto-sends
- **WHEN** the Home route receives both `q` and `workflowId` query parameters
- **THEN** the system SHALL send the prompt through the existing workflow-aware send path after the gateway is running
