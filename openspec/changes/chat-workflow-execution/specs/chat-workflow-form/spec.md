## ADDED Requirements

### Requirement: System fetches workflow template detail after selection
The system SHALL query the workflow template detail API immediately after the user selects a template.

#### Scenario: Template detail is fetched
- **WHEN** the user selects a workflow template from the picker
- **THEN** the system SHALL call `GET /api/workflows/templates/:id`
- **THEN** the response SHALL contain `schema` with `steps` and `fields`

### Requirement: Template schema fields map to user form configuration
The system SHALL convert the template's `schema.fields` into a `UserFormConfig` that can be rendered by the existing `UserFormModal` component.

#### Scenario: Fields are mapped to form configuration
- **WHEN** the template detail response contains `schema.fields`
- **THEN** each field SHALL be mapped to a `FormField` based on its `component` type:
  - `single_select` → `select`
  - `multi_select` → `multiselect`
  - `text` → `text`
  - `textarea` → `textarea`
  - `number` → `number`
  - `date` → `date`
  - `date_range` → `text` (with custom handling)
- **THEN** the field's `key` SHALL be used as the form field `name`
- **THEN** the field's `label` SHALL be used as the form field `label`
- **THEN** the field's `description` SHALL be used as the form field `description`
- **THEN** the field's `required` SHALL be mapped to `validation.required`
- **THEN** the field's `options` SHALL be mapped to `FormFieldOption[]`
- **THEN** the form SHALL be shown via `showForm(config, { source: 'workflow', sourceId: templateId })`

#### Scenario: Unknown component type is handled gracefully
- **WHEN** a field has a `component` type that is not in the known mapping
- **THEN** the field SHALL be mapped to `type: 'text'` as a fallback
- **THEN** the form SHALL still be renderable

### Requirement: Default values from preset are applied to form fields
The system SHALL populate form fields with default values from the template's `defaultPreset.values`.

#### Scenario: Default values are pre-filled
- **WHEN** the template detail contains `defaultPreset.values`
- **THEN** each form field SHALL have its `defaultValue` set from the matching key in `defaultPreset.values`
- **THEN** fields without a matching preset value SHALL use their own `defaultValue` if defined

### Requirement: User input text can be used to extract parameter defaults
The system SHALL attempt to extract parameter values from the user's original input text when fields are marked as extractable.

#### Scenario: Extractable parameters are auto-filled
- **WHEN** a field has `extractable: true` and an `extractPattern`
- **THEN** the system SHALL match the pattern against the user's input text
- **THEN** if a match is found, the captured value SHALL be set as the field's `defaultValue`
- **THEN** preset default values SHALL be overridden by extracted values

### Requirement: Form submission triggers workflow creation
The system SHALL create a workflow instance when the user submits the form.

#### Scenario: Form is submitted
- **WHEN** the user fills the form and clicks Confirm
- **THEN** the system SHALL call `POST /api/workflows` with:
  - `templateId`
  - `userMessage` (the original text input)
  - `values` (the submitted form values keyed by field `key`)
- **THEN** on success, the system SHALL proceed to execute the workflow
