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
The system SHALL allow the user to resize the preview panel by dragging a vertical separator between the chat area and the preview panel. Width SHALL be expressed as a percentage of the unified Grid content width via `--sto-split-preview-col`, persisted as `previewSplitPercent`, clamped to 30%–70% inclusive, with default 50%. The Grid middle track SHALL be `0px` and SHALL NOT consume chat or preview width. The separator SHALL include (1) an overlay transparent hit target (engineering default 12px unless MCP specifies otherwise) that does not consume layout width, and (2) a visual hint edge of color `#FFD6BA` and width `2px`, `pointer-events-none`, aligned to the preview pane left stroke via shared `--sto-split-preview-inset-x` / `--sto-split-preview-inset-y` (not centered on the 0px track). The hint edge SHALL be hidden by default and SHALL become visible on handle hover, while `isResizing` / `data-resizing=true`, and on focus-visible; Chat and Home SHALL pass `isResizing` from `useSplitPanelResize` so the edge remains visible under the fullscreen drag overlay. The separator SHALL NOT render a short grey divider in default/hover/dragging/light/dark states, and SHALL use `cursor: col-resize` with Electron `no-drag`. When split is open, session tools (search / refresh / thinking) SHALL sit at the right end of the chat header column (the chat header zone MUST fill the first Grid column). Chat and Home/task-subitem conversation surfaces SHALL share the same resize implementation. Dark mode SHALL keep the hit shell transparent; the hint edge MAY keep the fixed `#FFD6BA` local color (not global primary).

#### Scenario: Dragging to widen the panel
- **WHEN** the user drags the separator leftward
- **THEN** the preview panel percentage width SHALL increase
- **AND** the chat area SHALL shrink accordingly
- **AND** Header and Body SHALL stay aligned on the same Grid boundary

#### Scenario: Dragging to narrow the panel
- **WHEN** the user drags the separator rightward
- **THEN** the preview panel percentage width SHALL decrease
- **AND** the chat area SHALL expand accordingly

#### Scenario: Minimum percentage constraint
- **WHEN** the user drags such that the preview panel would be narrower than 30%
- **THEN** the panel width SHALL be clamped to 30%

#### Scenario: Maximum percentage constraint
- **WHEN** the user drags such that the preview panel would be wider than 70%
- **THEN** the panel width SHALL be clamped to 70%

#### Scenario: No layout-width resizer column
- **WHEN** the three-column preview layout is open
- **THEN** the DOM/CSS SHALL NOT include a layout track that occupies 4px (or any fixed px hitbox width) between chat and preview
- **AND** no short grey vertical divider SHALL be visible
- **AND** the `#FFD6BA` hint edge SHALL be hidden by default

#### Scenario: Hint edge visibility matrix
- **WHEN** the pointer hovers the resize hit target, or dragging is active (`data-resizing=true`), or the separator is focus-visible
- **THEN** the `#FFD6BA` / 2px hint edge SHALL be visible
- **AND** the edge SHALL remain aligned to the preview left stroke (shared inset), not the 0px track center

#### Scenario: Dark-mode edge and hit target
- **WHEN** the app is in dark mode and the pointer enters the resize hit target
- **THEN** the cursor SHALL be `col-resize`
- **AND** the hit shell SHALL remain transparent
- **AND** no grey residual fills SHALL appear

#### Scenario: Session tools flush to chat column trailing edge
- **WHEN** the three-column preview layout is open
- **THEN** search, refresh, and thinking controls SHALL render in the chat header column
- **AND** the chat header zone SHALL fill the first Grid column so tools sit at that column's trailing edge near the split boundary
- **AND** the preview toggle SHALL remain in the preview header column

### Requirement: Resize drag remains smooth at high cursor speeds
The system SHALL maintain smooth resizing even when the pointer is moved rapidly. Drag SHALL use Pointer Events (including `pointercancel`), MAY use a full-viewport transparent overlay for capture across iframes, and MUST clean up overlay/RAF/`userSelect`/cursor on pointer end, cancel, and component unmount.

#### Scenario: Fast pointer movement during drag
- **WHEN** the user moves the pointer quickly while dragging the separator
- **THEN** the panel width SHALL continue to update smoothly via RAF/CSS variable writes
- **AND** the drag operation SHALL NOT be interrupted when the cursor leaves the separator element
- **AND** the drag operation SHALL NOT be interrupted when the cursor leaves the application container

#### Scenario: Unmount during drag
- **WHEN** the user navigates away or closes the preview while a drag is active
- **THEN** the system SHALL remove any overlay, cancel pending RAF, and restore text selection and cursor

## MODIFIED Requirements

None.
