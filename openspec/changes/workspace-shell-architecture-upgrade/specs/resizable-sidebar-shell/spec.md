## ADDED Requirements

### Requirement: Sidebar preferred width is user-resizable within approved bounds
The provincial (and full expanded) Sidebar SHALL support pointer resize with preferred width clamped to a minimum of `200px`, a default of `260px`, and a maximum of `400px`, further capped by `effectiveSidebarMax` derived from viewport minus shell Frame minus the Stage-0-approved workspace minimum for the current layout mode. Pointer move SHALL update CSS variables via `requestAnimationFrame` only; React state, Zustand, and electron-store writes SHALL occur on pointer up (or cancel), not on every move.

#### Scenario: Default and clamp
- **WHEN** a user has no stored preferred width
- **THEN** the Sidebar SHALL render at `260px` while expanded
- **AND** when the user commits a drag below `200` or above `400`, the stored preferred width SHALL clamp into `[200, 400]`

#### Scenario: Resize performance
- **WHEN** the user drags the Sidebar resize handle
- **THEN** pointermove handlers SHALL NOT call React `setState` or Zustand setters each frame
- **AND** width transitions SHALL be disabled for the duration of the drag

### Requirement: Collapse and restore respect snap thresholds and reasons
Dragging left past the approved collapse threshold SHALL set user collapse without destroying preferred width. Restoring from Header/user control SHALL restore the last preferred width (not hard-reset to `260` unless no preferred exists). Viewport collapse SHALL engage when `effectiveMax < 200` and SHALL clear when space returns, without overwriting user preference. Full legacy collapsed rail (`72px`) SHALL remain available only for `layoutVariant=full`.

#### Scenario: User collapse from drag
- **WHEN** raw drag width crosses the approved collapse threshold while expanded
- **THEN** user collapse SHALL become true
- **AND** `sidebarPreferredWidth` SHALL retain the pre-collapse preferred value for later restore

#### Scenario: Viewport auto-collapse
- **WHEN** viewport space yields `effectiveMax < 200`
- **THEN** `sidebarViewportCollapsed` SHALL be true and effective width SHALL follow provincial `0` / full `72` rules by variant
- **AND** when space returns above the threshold, viewport collapse SHALL clear without flipping the persisted user preference

### Requirement: Workspace minimum widths gate effectiveMax
`effectiveSidebarMax` computation SHALL use the Stage-0-approved values recorded in this Change’s design: `closedWorkspaceMin = 560`, `splitChatMin = 480`, `splitPreviewMin = 560`, `expandedPreviewMin = 640` (pixels). Agents SHALL NOT substitute other pixel values from artboard samples or window minima.

#### Scenario: Closed preview workspace reservation
- **WHEN** PreviewMode is `closed` (or the page has no preview split)
- **THEN** `workspaceRequiredWidth` SHALL be `560` (`closedWorkspaceMin`)
- **AND** `effectiveMax` SHALL equal `min(400, viewportWidth - shellFrameWidth - workspaceRequiredWidth)`

#### Scenario: Split preview workspace reservation
- **WHEN** PreviewMode is `split`
- **THEN** `workspaceRequiredWidth` SHALL be `480 + 560` (`splitChatMin + splitPreviewMin`)
- **AND** `effectiveMax` SHALL equal `min(400, viewportWidth - shellFrameWidth - workspaceRequiredWidth)`

#### Scenario: Expanded preview workspace reservation
- **WHEN** PreviewMode is `expanded`
- **THEN** `workspaceRequiredWidth` SHALL be `640` (`expandedPreviewMin`)
- **AND** `effectiveMax` SHALL equal `min(400, viewportWidth - shellFrameWidth - workspaceRequiredWidth)`

#### Scenario: Dark-mode resize affordance
- **WHEN** the resize handle is shown in light or dark theme
- **THEN** hit target and focus-visible ring SHALL remain visible using semantic tokens
- **AND** the handle SHALL NOT rely on light-only fills such as hard-coded `bg-white` without a dark counterpart
