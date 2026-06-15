## ADDED Requirements

### Requirement: AI generates natural language guidance for workflow parameters
The system SHALL inject workflow schema context into the AI conversation so that the AI can guide users to confirm parameters in natural language.

#### Scenario: AI receives workflow schema context
- **WHEN** the frontend has fetched `startup-schema` for a selected template
- **THEN** the system SHALL inject a hidden context block into the message sent to Gateway containing: template name, template description, and a structured list of all `fields` with their `key`, `label`, `component` type, `required` flag, `options`, and `defaultValue`
- **THEN** the AI SHALL generate a natural language message guiding the user to confirm each parameter

#### Scenario: AI explains parameter meaning
- **WHEN** the user asks "对账周期是什么" during workflow configuration
- **THEN** the AI SHALL use the injected schema context to explain the parameter meaning
- **THEN** the AI SHALL suggest available options from the schema's `options` list

### Requirement: Frontend renders parameter form alongside AI guidance
The system SHALL display the interactive `parameter_form` in the same assistant message bubble as the AI's guidance text.

#### Scenario: Form appears below AI guidance
- **WHEN** the AI replies with workflow parameter guidance
- **THEN** the frontend SHALL detect the workflow context and append a `parameter_form` content block to the same message
- **THEN** the form SHALL be pre-filled with `defaultValue` from the schema and any values extracted from the user's original message

#### Scenario: User fills form after AI guidance
- **WHEN** user interacts with the `parameter_form` and clicks confirm
- **THEN** the form values SHALL be collected and passed to the workflow creation handler
- **THEN** the system SHALL NOT send the form submission as a new chat message to Gateway

### Requirement: System extracts parameter values from natural language
The system SHALL support users providing parameters through natural language replies, not just through the form.

#### Scenario: User provides parameters in text
- **WHEN** user replies "每天对一次账，关注考核激励和面单返利" after seeing the AI guidance and form
- **THEN** the system SHALL extract parameter values using `extractPattern` or keyword matching against schema `options`
- **THEN** the extracted values SHALL be merged into the pending workflow's `collectedInputs`
- **THEN** if all required fields are satisfied, the system SHALL proceed to create and execute the workflow
- **THEN** if required fields are still missing, the system SHALL update the form with extracted values and prompt for the remaining fields
