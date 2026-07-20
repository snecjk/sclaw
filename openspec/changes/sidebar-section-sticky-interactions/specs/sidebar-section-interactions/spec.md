## ADDED Requirements

### Requirement: Expanded account area opens account menu
When the sidebar is expanded and the user profile card is shown, the account name/company block MUST be the `DropdownMenuTrigger` for the account menu. The expanded-state gear icon MUST NOT be rendered. The help (`SidebarSupportQrTooltip`) control MUST remain an independent button. Account menu and help QR MUST remain mutually exclusive. Collapsed full/provincial layouts MUST keep a compact account/settings entry. Light and dark themes MUST show readable default, hover, focus-visible, and `data-[state=open]` styles on the account hotzone using sidebar semantic tokens (aligned with `docs/sto-design.md`).

#### Scenario: Click account text opens menu
- **WHEN** the expanded sidebar shows the user profile card and the user activates the account name/company area
- **THEN** the existing account dropdown opens and no gear icon is present in the expanded footer

#### Scenario: Help button stays independent
- **WHEN** the user activates the help control
- **THEN** only the support QR opens, the account menu closes if open, and the help control is not inside the account trigger

#### Scenario: Collapsed compact entry remains
- **WHEN** the sidebar is collapsed (full or provincial)
- **THEN** a compact control still opens the account menu

#### Scenario: Account hotzone in dark theme
- **WHEN** the account hotzone is hovered, focused, or open in dark theme
- **THEN** background, text, and focus ring remain readable via semantic / sidebar tokens without a light-only hardcoded fill as the sole state cue

### Requirement: Sidebar section headers share interaction styling
Project, task, and recent section headers MUST share one layout-private collapsible label component with the same label/chevron styling, full-row hover/focus-visible treatment, and `aria-expanded` on the main toggle. Optional right-side actions MUST render outside the main toggle button and MUST NOT invoke the section `onToggle`.

#### Scenario: Shared header toggle
- **WHEN** the user activates the main header toggle for project, task, or recent
- **THEN** that section’s module open state toggles and the chevron reflects `aria-expanded`

#### Scenario: Right actions do not toggle section
- **WHEN** the user activates a header right-side action (e.g. create project or collapse-all)
- **THEN** the section module open state does not change as a result of that action click

#### Scenario: Header hover and focus in both themes
- **WHEN** a section header is hovered or keyboard-focused in light or dark theme
- **THEN** the hover/focus visuals remain readable and use shared sidebar section surface classes

### Requirement: Project task and recent headers form a sticky stack
In the single middle scroll container, project, task, and recent headers MUST stick at `0`, `1 × --sto-sidebar-section-sticky-h`, and `2 × --sto-sidebar-section-sticky-h` respectively, with opaque `--sto-sidebar-bg` shells so list text does not show through. Crossing the project→task threshold while projects are open MUST collapse only the project module open state once per crossing. Crossing the task→recent threshold while tasks are open MUST collapse only the task module open state once per crossing. Auto-collapse MUST NOT clear group expansion maps. Manual re-expand of a stuck section MUST scroll to reveal that section’s content without unconditionally resetting the container to `scrollTop = 0`, and MUST suppress the immediate next auto-collapse.

#### Scenario: Three-level sticky tops
- **WHEN** the user scrolls a long project+task+recent list
- **THEN** project, task, and recent headers stick at the three computed tops with opaque backgrounds

#### Scenario: Auto-collapse project then task
- **WHEN** the task header reaches the project sticky bottom while projects are open
- **THEN** the project module closes once without clearing project group expansion
- **WHEN** the recent sentinel reaches the task sticky bottom while tasks are open
- **THEN** the task module closes once without clearing task group expansion

#### Scenario: Manual expand while stuck
- **WHEN** the user manually re-opens a stuck project or task module
- **THEN** the scroll position reveals that module’s content and the next auto-collapse is suppressed for that transition

### Requirement: Project and task groups support expand all and collapse all
Project and task sections MUST each maintain an independent group-expansion map. The batch control MUST decide its next action from whether every expandable group is expanded: if all expandable groups are expanded, the control SHALL collapse all groups; if any expandable group is not expanded (including partial expansion or all collapsed), the control SHALL expand all expandable groups. The product MUST NOT maintain or restore a historical expansion snapshot. Opening or closing a single group MUST leave other groups unchanged. Closing a module MUST NOT clear its group-expansion map. The batch control MUST NOT be shown when the module is closed, when there is no primary list, or when no group has expandable secondary content. Light and dark themes MUST keep the batch icon button, tooltip, hover, and focus-visible styles readable via sidebar semantic tokens.

#### Scenario: All expanded collapses all
- **WHEN** every expandable project or task group is expanded and the user activates the batch control
- **THEN** all expandable groups collapse, secondary content hides, and primary rows remain

#### Scenario: Partial expansion expands all
- **WHEN** some expandable groups are open and others are closed and the user activates the batch control
- **THEN** every expandable group becomes expanded and already-open groups stay open

#### Scenario: All collapsed expands all
- **WHEN** no expandable group is expanded and the user activates the batch control
- **THEN** every currently expandable group with secondary content expands

#### Scenario: Batch control hidden when module closed or empty
- **WHEN** the project or task module is closed, or there are no expandable secondary groups
- **THEN** the batch expand/collapse control is not shown

### Requirement: Task groups support independent expansion
Task and scheduled-task groups MUST support multiple simultaneously expanded groups via a map-like expansion state. Toggling group B MUST NOT force-close group A. Auto-focus / running-task sidebar focus MUST add the target group to the expansion map without replacing other open groups. Top-level “show more” pagination MUST NOT overwrite the group expansion map.

#### Scenario: Expand two task groups
- **WHEN** the user expands task group A and then task group B
- **THEN** both A and B remain expanded

#### Scenario: Auto-focus appends only
- **WHEN** auto-focus targets a running or current task group while other groups are expanded
- **THEN** the target group is added to the expansion map and other open groups stay open

### Requirement: Project hierarchy and empty state follow the approved design
When there are no projects, the projects section MUST show the approved empty illustration/copy (“暂无项目” via i18n) and the create-project action, without the batch control. Expandable projects MUST show a primary chevron; expanding one project MUST NOT close others. Project secondary sessions MUST show a hierarchy guide line per design. Selected project-session font weight MUST remain the existing medium weight. The project row overflow menu MUST NOT include a duplicate “new chat in project” item while the hover new-chat button remains.

#### Scenario: Empty projects state
- **WHEN** there are zero projects
- **THEN** the empty-state copy and create-project control are shown and the batch control is hidden

#### Scenario: Project hierarchy and menu
- **WHEN** a project with sessions is rendered
- **THEN** the chevron and secondary hierarchy line follow the approved layout, and the overflow menu omits the duplicate new-chat item

### Requirement: Existing project and session workflows remain unchanged
Creating a project via the existing dialog, project inline rename, session inline rename (including double-click per `sidebar-project-session-navigation`), project new-chat draft timing, session pin/unread/running/failed priority, and project creation-time ordering MUST remain unchanged by this capability.

#### Scenario: Unchanged create and rename flows
- **WHEN** the user creates a project or renames a project/session via existing inline flows
- **THEN** behavior matches the pre-change workflows and `sidebar-project-session-navigation` requirements
