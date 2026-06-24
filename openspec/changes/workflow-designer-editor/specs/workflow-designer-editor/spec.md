## ADDED Requirements

### Requirement: Load workflow definition for editing
The system SHALL load workflow graph data via `GET /agent/v1/workflows/{workflowId}` when the user opens the designer from the workflow list.

#### Scenario: Open editor from list card
- **WHEN** the user clicks edit on a workflow card with id `wf_xxx`
- **THEN** the designer SHALL display nodes and edges from the API response
- **AND** SHALL show loading and error states if the request fails

### Requirement: Persist workflow draft
The system SHALL save edited workflow name, description, nodes, and edges via `PUT /agent/v1/workflows/{workflowId}`.

#### Scenario: Save draft
- **WHEN** the user clicks save draft with unsaved changes
- **THEN** the system SHALL send the full workflow definition to the API
- **AND** SHALL clear the dirty state on success
- **AND** SHALL surface API errors without faking success

### Requirement: Publish workflow version
The system SHALL publish the workflow via `POST /agent/v1/workflows/{workflowId}/publish` when the user clicks publish.

#### Scenario: Publish after edit
- **WHEN** the user clicks publish
- **THEN** the system SHALL call the publish endpoint
- **AND** SHALL update the displayed version on success

### Requirement: Designer shell and node library
The designer SHALL provide a node library panel, a canvas with draggable nodes, and an inspector for the selected node, using STO theme tokens from `docs/sto-design.md`.

#### Scenario: Add node from library
- **WHEN** the user picks a node type from the library
- **THEN** a new node SHALL appear on the canvas with default config for that type
- **AND** the workflow SHALL be marked dirty

### Requirement: Preserve design demo reference
The static design implementation SHALL remain available as `WorkflowBuilderDemo` for UI reference and non-persistent flows.

#### Scenario: Manual create from hero
- **WHEN** the user chooses manual create or AI generate entry
- **THEN** the system SHALL open `WorkflowBuilderDemo`, not the API-backed designer
