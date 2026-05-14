## ADDED Requirements

### Requirement: File preview iframe reloads content on file switch
The system SHALL ensure that switching from one previewable file to another causes the preview iframe to load the new file's content.

#### Scenario: Switching between two HTML files
- **WHEN** the user selects a different file from the preview panel file list
- **THEN** the preview iframe SHALL display the newly selected file's content
- **AND** the previous file's content SHALL no longer be visible

#### Scenario: Switching between HTML and PDF files
- **WHEN** the user switches from an HTML preview to a PDF preview
- **THEN** the preview iframe SHALL render the PDF document
- **AND** the HTML content SHALL be fully unloaded

### Requirement: Preview panel supports fullscreen presentation mode
The system SHALL provide a fullscreen toggle that expands the current file preview to occupy the entire screen.

#### Scenario: Entering fullscreen from toolbar
- **WHEN** the user clicks the fullscreen button in the preview panel toolbar
- **THEN** the preview content SHALL enter fullscreen mode
- **AND** the browser chrome and application UI SHALL be hidden

#### Scenario: Exiting fullscreen
- **WHEN** the user presses Escape or clicks the fullscreen toggle again
- **THEN** the preview content SHALL exit fullscreen mode
- **AND** the normal Chat page layout SHALL be restored

#### Scenario: Fullscreen state icon updates
- **WHEN** the preview is in fullscreen mode
- **THEN** the fullscreen toggle button SHALL display an exit-fullscreen icon
- **AND** when not in fullscreen mode, it SHALL display an enter-fullscreen icon

### Requirement: Preview panel width is draggable
The system SHALL allow the user to resize the preview panel by dragging a vertical resizer between the chat area and the preview panel.

#### Scenario: Dragging to widen the panel
- **WHEN** the user drags the resizer leftward
- **THEN** the preview panel width SHALL increase
- **AND** the chat area SHALL shrink accordingly

#### Scenario: Dragging to narrow the panel
- **WHEN** the user drags the resizer rightward
- **THEN** the preview panel width SHALL decrease
- **AND** the chat area SHALL expand accordingly

#### Scenario: Minimum width constraint
- **WHEN** the user drags the resizer such that the panel would be narrower than 320px
- **THEN** the panel width SHALL be clamped to 320px

#### Scenario: Maximum width constraint
- **WHEN** the user drags the resizer such that the panel would be wider than 900px
- **THEN** the panel width SHALL be clamped to 900px

### Requirement: Resize drag remains smooth at high cursor speeds
The system SHALL maintain smooth resizing even when the mouse is moved rapidly.

#### Scenario: Fast mouse movement during drag
- **WHEN** the user moves the mouse quickly while dragging the resizer
- **THEN** the panel width SHALL continue to update smoothly
- **AND** the drag operation SHALL NOT be interrupted when the cursor leaves the resizer element
- **AND** the drag operation SHALL NOT be interrupted when the cursor leaves the application container

## MODIFIED Requirements

None.
