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

### Requirement: Preview expand uses Workspace layout mode (Fullscreen API withdrawn)
The product preview expand path SHALL be Workspace-internal `PreviewMode.expanded` owned by `workspace-shell-architecture-upgrade` / `workspace-layout-modes`. This Change SHALL NOT require DOM Fullscreen (`requestFullscreen` / `fullscreenchange`) for presentation expand. Existing Fullscreen call sites are migration debt to remove in shell Stage 3.

#### Scenario: Expand is not DOM Fullscreen
- **WHEN** the user expands file preview for presentation
- **THEN** the experience SHALL be satisfied by Workspace `PreviewMode.expanded` once shell Stage 3 is delivered
- **AND** new work in this Change SHALL NOT add Fullscreen toolbar/floating controls as the target design

#### Scenario: Conversation state preserved (shell-owned acceptance)
- **WHEN** preview is expanded via Workspace mode
- **THEN** Conversation SHALL remain mounted per `workspace-layout-modes` requirements
- **AND** this Change SHALL NOT unmount Conversation to fake expand

### Requirement: Preview panel width persistence remains shared
The system SHALL persist preview width as `previewSplitPercent` (30%–70%, default 50%) driving `--sto-split-preview-col`. Final zero-seam geometry, Body-only handle, and Header slot rename are owned by `workspace-layout-modes`; this Change SHALL NOT reintroduce bilateral `10px` structural seams, Handle `row-span-2`, `translate-x(10px)` compensation, or a living `panelActions` slot.

#### Scenario: Percent clamp retained
- **WHEN** the user resizes the preview panel
- **THEN** committed width SHALL clamp to 30%–70% inclusive

#### Scenario: No third Header action semantic
- **WHEN** Header actions are split between conversation and preview columns
- **THEN** final naming SHALL be `chatActions` + `previewActions` (+ `layoutMode`) under the shell Change
- **AND** this Change SHALL NOT add `panelActions` as a parallel API

### Requirement: Resize drag remains smooth at high cursor speeds
The system SHALL maintain smooth resizing even when the pointer is moved rapidly. Drag SHALL use Pointer Events (including `pointercancel`), MAY use a full-viewport transparent overlay for capture across iframes, and MUST clean up overlay/RAF/`userSelect`/cursor on pointer end, cancel, and component unmount.

#### Scenario: Fast pointer movement during drag
- **WHEN** the user moves the pointer quickly while dragging the separator
- **THEN** the panel width SHALL continue to update smoothly via RAF/CSS variable writes
- **AND** the drag operation SHALL NOT be interrupted when the cursor leaves the separator element

#### Scenario: Unmount during drag
- **WHEN** the user navigates away or closes the preview while a drag is active
- **THEN** the system SHALL remove any overlay, cancel pending RAF, and restore text selection and cursor

#### Scenario: Dark-mode hit target
- **WHEN** the app is in dark mode and the pointer enters the resize hit target
- **THEN** the hit shell SHALL remain transparent without light-only residual fills

## MODIFIED Requirements

None.
