## ADDED Requirements

### Requirement: Trial-run terminal state is synchronized to the embedded header
StoClaw SHALL derive the embedded trial-run display state from the current local run and SHALL synchronize `running`, `cancelled`, `failed`, and `completed` to `memory-center-web`. The Web header MUST display the latest synchronized stable state until a new attempt starts or the workflow iframe session is reset.

#### Scenario: Active run completes while the drawer is closed
- **WHEN** the current local trial run reaches `completed` after the user has closed the result drawer
- **THEN** StoClaw SHALL send the `completed` state for the current request and workflow session
- **AND** the Web header SHALL display a running-complete status badge without requiring the drawer to be open

#### Scenario: Local run reaches a non-success terminal state
- **WHEN** the current local trial run reaches cancelled, failed, timed-out, or interrupted status
- **THEN** StoClaw SHALL map it to `cancelled` or `failed` as specified by the trial-run state model
- **AND** the Web header SHALL display the same semantic state as the StoClaw drawer

#### Scenario: Terminal state appears in dark theme
- **WHEN** a synchronized terminal status is displayed while the Web editor uses dark theme
- **THEN** the badge MUST use dark-compatible semantic background, text, border, icon, hover, focus, and disabled tokens consistent with `docs/sto-design.md`
- **AND** the status MUST remain distinguishable by icon and text without relying on color alone

### Requirement: Trial-run lifecycle is independent from drawer visibility
Closing the trial-run drawer SHALL only change its visibility. It MUST NOT cancel an active run, send `idle`, clear the synchronized run state, or invalidate the current run request.

#### Scenario: User closes a running drawer
- **WHEN** the user closes the result drawer while the local run is active
- **THEN** the local run SHALL continue in the background
- **AND** the header SHALL continue to display `running`
- **AND** the eventual terminal state SHALL still be synchronized

#### Scenario: Workflow session changes
- **WHEN** the workflow ID, iframe session identity, or editor route changes
- **THEN** StoClaw SHALL invalidate the old trial-run display session and reset the new session to `idle`
- **AND** a late event from the old session MUST NOT update the new workflow header or drawer

### Requirement: Trial-run mode uses the approved compact result drawer
The trial-run result UI SHALL visually align with MasterGo node `48:46129` and the approved five-state comparison covering running, cancelled, failed, completed-with-process-collapsed, and completed-with-process-expanded. It SHALL use a right-side drawer with a 500px target width, a 52px title area, 12px body side insets, a 476×42px status row, a scrollable content area, and a fixed 60px bottom action area. At narrow widths it MUST fit within the viewport. Running, cancelled, failed, and completed views SHALL use the approved state-specific hierarchy, spacing, borders, radii, typography, icons, scroll behavior, and actions.

#### Scenario: Running trial is displayed
- **WHEN** a local trial run is starting or active
- **THEN** the drawer SHALL show the running notice, current version, execution process, and a bottom `取消运行` action
- **AND** the notice SHALL explain that closing the drawer does not stop the run

#### Scenario: Cancelled or failed trial is displayed
- **WHEN** the current trial run is cancelled or failed
- **THEN** the drawer SHALL preserve any execution events already produced and show the matching Warning or Danger status
- **AND** the fixed bottom action SHALL be `继续运行` for cancelled or `重新运行` for failed

#### Scenario: Completed trial is displayed
- **WHEN** the current trial run completes
- **THEN** the drawer SHALL show Success status and independent collapsible `执行过程` and `产物名称` sections instead of tabs
- **AND** the fixed bottom action SHALL be `重新运行`

#### Scenario: Completed process section changes expansion state
- **WHEN** the user collapses the completed execution process
- **THEN** the `执行过程` control SHALL appear on the right side of the completed status row and the artifact card SHALL occupy the primary content area
- **AND** when expanded, the execution process SHALL render as a separate bordered card above the artifact card

#### Scenario: Execution timeline and artifact header align with the approved design
- **WHEN** the drawer renders execution events or an artifact section
- **THEN** events SHALL use the approved left dot-and-line timeline with left-aligned event text, right-aligned timestamps, indented details, and an internal thin scrollbar when needed
- **AND** the artifact header SHALL preserve the approved expand-or-open and download actions with visible hover, focus, and disabled states

#### Scenario: Fixed footer aligns with the approved design
- **WHEN** any stable trial-run state is displayed
- **THEN** the 60px footer SHALL remain fixed below the scrolling content with 12px horizontal insets
- **AND** its primary action SHALL use the approved full-width 36px-height, 10px-radius high-emphasis treatment without being clipped by the viewport

#### Scenario: Compact drawer is used in dark theme
- **WHEN** the trial drawer is rendered in dark theme or at a narrow supported window width
- **THEN** its background, text, borders, status surfaces, buttons, focus, hover, disabled, empty, and error states MUST use responsive dark-compatible semantic tokens
- **AND** the drawer MUST remain usable without horizontal viewport overflow

### Requirement: Cancelled continue starts a new complete trial run
In the embedded workflow editor, the `继续运行` action SHALL start a new persisted trial-run attempt with a new `runId`. It MUST NOT resume or reopen the cancelled run, and the cancelled run SHALL remain terminal in history.

#### Scenario: User continues a cancelled trial
- **WHEN** the user clicks `继续运行` for a cancelled embedded trial run
- **THEN** the system SHALL use the existing save-before-rerun flow, request startup inputs and engine selection, and create a new local run
- **AND** the new run ID MUST differ from the cancelled run ID
- **AND** the system MUST NOT call same-run resume for the cancelled run

#### Scenario: New attempt fails before run creation
- **WHEN** saving the latest canvas or preparing startup inputs fails after the user clicks `继续运行`
- **THEN** the system SHALL NOT reopen the cancelled run or start an older saved version
- **AND** it SHALL show one actionable error and leave the cancelled history record unchanged

### Requirement: Interactive waiting states remain operable in the compact drawer
Local `waiting_approval` and `waiting_input` states SHALL remain part of the running presentation. The compact drawer MUST preserve the existing approval decision and supplemental-input actions required to continue the active run.

#### Scenario: Trial run waits for approval
- **WHEN** the current local run reaches `waiting_approval`
- **THEN** the header SHALL continue to display `running`
- **AND** the drawer SHALL present approve and reject controls with keyboard-visible focus

#### Scenario: Trial run waits for supplemental input
- **WHEN** the current local run reaches `waiting_input`
- **THEN** the header SHALL continue to display `running`
- **AND** the drawer SHALL present the supplemental input control and a validation-safe submit action

### Requirement: Trial and detail drawer presentations are isolated
The shared result component SHALL apply the compact MasterGo presentation only to trial-run mode. Existing detail-mode consumers, including history details and completion notifications, MUST retain their required information and actions unless separately redesigned.

#### Scenario: User opens a historical run detail
- **WHEN** a detail-mode consumer opens an existing run
- **THEN** the component SHALL render the detail presentation rather than the compact trial-only action model
- **AND** trial-only footer behavior MUST NOT remove detail-mode navigation or conversation actions

#### Scenario: Embedded Web runs standalone
- **WHEN** `memory-center-web` is opened without a compatible StoClaw Host
- **THEN** this change SHALL NOT activate the legacy Web result drawer or local-runtime status presentation
- **AND** standalone Web behavior SHALL remain unchanged

### Requirement: Trial-run bridge state remains authenticated and current
New terminal-state messages SHALL retain the existing authenticated bridge envelope and request correlation rules. Host and Web MUST reject invalid origin, source, protocol, nonce, workflow ID, request ID, schema, and stale-session messages.

#### Scenario: Old run sends a late terminal update
- **WHEN** an earlier run or request sends a terminal update after a new attempt has become current
- **THEN** Host and Web MUST ignore the stale update
- **AND** the current header and drawer state SHALL remain unchanged

#### Scenario: Web receives a stable terminal state
- **WHEN** Web accepts `cancelled`, `failed`, or `completed` for the current request
- **THEN** it SHALL release the active request so a new request ID can be created
- **AND** it SHALL retain the accepted terminal state for display until a new attempt or session reset
