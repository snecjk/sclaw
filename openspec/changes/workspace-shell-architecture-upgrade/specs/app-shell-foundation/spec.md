## ADDED Requirements

### Requirement: Provincial AppShell uses two-column boundary geometry with an overlay resize hit area
The provincial AppShell SHALL lay out as a CSS Grid with columns `effectiveSidebarWidth | minmax(0,1fr)`. Sidebar right edge and Workspace left edge SHALL coincide without a width-consuming intermediary Grid track. When Sidebar resize is available, the 8px engineering hit area SHALL be an absolute overlay on the Workspace side of that boundary and SHALL NOT change Grid width or overlap the Sidebar OverlayScrollbar. The Workspace wrapper SHALL apply a stable 8px L0 Frame on top/right/bottom. Its start Frame SHALL be `0px` while Sidebar is expanded so the two tracks remain adjacent, and SHALL become `8px` when the provincial Sidebar is fully collapsed so the Workspace card does not touch the window edge. Collapse SHALL NOT be implemented by restoring a real intermediary Grid track. Provincial horizontal shell-frame math SHALL reserve only the remaining 8px Workspace right Frame (not the deleted intermediary Gap), and Workspace-centered Toast offset SHALL equal `effectiveSidebarWidth` without an extra provincial Gap.

#### Scenario: Expanded provincial shell
- **WHEN** the provincial layout is shown and the sidebar is not effectively collapsed
- **THEN** the shell SHALL render adjacent Sidebar and L1 Workspace tracks with `sidebarRight = workspaceLeft` within `1px`
- **AND** the Sidebar resize hit area SHALL overlay the Workspace side without consuming a Grid track
- **AND** the Workspace wrapper SHALL provide top/right/bottom 8px Frame without depending on collapsed-only padding

#### Scenario: Collapsed provincial shell (any reason)
- **WHEN** `effectiveCollapsed` is true for provincial layout (user, viewport, or context)
- **THEN** the Sidebar track SHALL be `0px`
- **AND** the resize hit area SHALL not render
- **AND** the Workspace main card SHALL remain `8px ± 1px` from the window start edge while top/right/bottom Frame also remain
- **AND** the start Frame SHALL belong to the Workspace wrapper rather than a recreated Grid track
- **AND** the shell SHALL NOT paint a collapsed-only background wedge to fake the Frame

#### Scenario: Dark-mode boundary continuity
- **WHEN** the adjacent Sidebar and Workspace boundary renders in dark theme
- **THEN** the shell SHALL keep the same two-column geometry as light theme
- **AND** it SHALL NOT paint a third color strip or reintroduce a width-consuming gap to express the resize affordance

#### Scenario: Geometry consumers drop the deleted Gap
- **WHEN** provincial Sidebar effective max and global Toast position are calculated after the two-column migration
- **THEN** horizontal shell Frame SHALL equal the remaining `8px` Workspace right Frame for effective-max math
- **AND** Toast layout offset SHALL equal `effectiveSidebarWidth` (or `0` for no-sidebar routes) without adding the deleted Gap

#### Scenario: Full legacy layout remains distinct
- **WHEN** `layoutVariant` is `full`
- **THEN** the shell SHALL retain the existing 72px collapsed rail behavior for that variant
- **AND** provincial `0px` collapse rules SHALL NOT be applied to full legacy

### Requirement: AppShellLayoutProvider owns effective sidebar snapshot
The system SHALL expose a single `AppShellLayoutProvider` that is an ancestor of both `Routes` and the global Toaster, does not introduce layout DOM, and publishes an `AppShellLayoutSnapshot` including `hasSidebar`, `layoutVariant`, `sidebarPreferredWidth`, `effectiveSidebarWidth`, `effectiveSidebarMax`, `effectiveCollapsed`, `collapseReasons`, and `canUserRestoreSidebar`. PreviewMode SHALL NOT live in this provider.

#### Scenario: Toast and Header read the same snapshot
- **WHEN** Sidebar width or collapse reasons change
- **THEN** Toast positioning and Header sidebar-restore controls SHALL read the same effective width and collapse flags from the provider
- **AND** neither Toast nor Header SHALL reimplement the width formula with hard-coded `72`/`260`

#### Scenario: Settings and no-sidebar routes
- **WHEN** the active route has no Sidebar (including provincial Settings, login, setup, sprite, float-icon)
- **THEN** the snapshot SHALL report `hasSidebar=false` and `effectiveSidebarWidth=0`

### Requirement: Collapse reasons are separated without a second user persistence key
Persisted user preference SHALL continue to use the existing `sidebarCollapsed` key (documented as user reason only). Viewport and context collapses SHALL be non-persisted flags. `effectiveCollapsed` SHALL be the OR of user, viewport, and context reasons. The system SHALL NOT introduce a second persisted `sidebarUserCollapsed` key. Workflow editor temporary hide SHALL set context reason only and SHALL NOT overwrite the user preference key as the sole truth.

#### Scenario: Workflow editor temporary collapse
- **WHEN** the workflow editor becomes active
- **THEN** context collapse SHALL hide the provincial Sidebar
- **AND** the persisted user `sidebarCollapsed` preference SHALL remain unchanged
- **AND** when the editor closes, context collapse SHALL clear without forcing a user expand/collapse write unless the user preference already differs

#### Scenario: Dark-mode shell ownership
- **WHEN** the app is in light or dark theme
- **THEN** L0 Page/Sidebar/Frame and L1 Workspace structural ownership SHALL remain identical
- **AND** appearance differences SHALL use semantic theme tokens consistent with `docs/sto-design.md` rather than collapse-only hard-coded fills
