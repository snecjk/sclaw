## ADDED Requirements

### Requirement: Shell surfaces follow L0–L3 ownership
The application chrome SHALL preserve a stable ownership hierarchy: L0 Window/Shell (Page, Sidebar, 8px Frame), L1 Workspace, L2 Workbench panels (Preview, Composer, content cards), L3 Floating (Toast, Popover, Modal). Theme, Sidebar collapse, and PreviewMode SHALL NOT reassign structural ownership between these layers.

#### Scenario: Collapse does not re-parent Workspace
- **WHEN** the Sidebar collapses for any reason
- **THEN** L1 Workspace SHALL remain the same structural owner of main content
- **AND** L0 Frame gaps SHALL continue to belong to the shell, not to page-level compensatory padding

#### Scenario: PreviewMode does not promote Preview to L0
- **WHEN** PreviewMode is `expanded`
- **THEN** Preview SHALL remain an L2 panel filling L1 Workspace
- **AND** it SHALL NOT become a document-level Fullscreen L0 surface

### Requirement: Light and dark share hierarchy with tokenized appearance
Light and dark themes SHALL use the same L0/L1/L2/L3 hierarchy. Color, border, and shadow differences SHALL be expressed with semantic tokens aligned to `docs/sto-design.md`. Stage-4 tuning MAY adjust token values but SHALL NOT introduce collapse-only or mode-only structural CSS that exists in only one theme.

#### Scenario: Dark Page/Sidebar/Workspace continuity
- **WHEN** the user switches between light and dark themes on provincial shell
- **THEN** Page, Sidebar, and Workspace SHALL remain distinct layers with readable foreground/background/border contrast
- **AND** agents SHALL NOT “fix” hierarchy by painting collapsed wedges or absolute overlays unique to one theme

#### Scenario: Toast remains L3 floating
- **WHEN** Toast is shown over any PreviewMode
- **THEN** Toast SHALL remain an L3 floating surface centered to the main content using AppShell effective geometry
- **AND** Toast SHALL NOT be laid out as an L1 Workspace child that consumes grid tracks

### Requirement: Integration acceptance preserves protected behaviors
The upgraded shell SHALL preserve OverlayScrollbar behavior on target surfaces, conversation draft/scrollTop/message state across PreviewMode changes, Settings special routing, App Plaza and Browser Embed hosts, and full legacy Sidebar rail rules. Directed tests listed in stage docs SHALL pass before claiming phase completion.

#### Scenario: Settings route isolation
- **WHEN** the user opens Settings on provincial layout
- **THEN** Sidebar SHALL not appear and effective sidebar width for Toast SHALL be `0`
- **AND** returning to Home SHALL restore shell geometry without leftover Settings padding hacks

#### Scenario: Acceptance matrix themes
- **WHEN** integration acceptance runs light and dark samples from the stage-4 matrix
- **THEN** hierarchy, Frame, and PreviewMode behaviors SHALL hold in both themes
- **AND** unverified OS/theme combinations SHALL be explicitly listed rather than claimed
