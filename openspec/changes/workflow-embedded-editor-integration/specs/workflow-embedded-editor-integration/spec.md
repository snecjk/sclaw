## ADDED Requirements

### Requirement: Embedded workflow editor uses one business header
When compatible Host and Web capabilities are negotiated, the embedded workflow editor SHALL render exactly one 52px workflow business header owned by `memory-center-web`. The header SHALL contain back navigation, workflow name, edit affordance, latest saved time, version list, save draft, embedded trial run, and publish in the approved order. StoClaw MUST NOT simultaneously render its workflow title, local history, browser-open, or duplicate trial-run actions.

#### Scenario: Compatible embedded editor opens
- **WHEN** StoClaw and memory-center-web complete a capability handshake that includes `ownsHeader` and `localTrialRun`
- **THEN** the page SHALL display one Web-owned 52px workflow business header
- **AND** StoClaw SHALL hide its duplicate workflow business header actions

#### Scenario: Capability handshake is not complete
- **WHEN** the iframe has not advertised the required single-header capability
- **THEN** StoClaw SHALL retain the existing Host header as a compatibility fallback
- **AND** MUST NOT leave the page without navigation or window controls

### Requirement: Embedded trial run entry is capability gated
The Web-owned trial-run action SHALL appear only when the designer is embedded by a Host that explicitly advertises local trial-run support. Browser-standalone mode and incompatible Host versions MUST NOT display that action.

#### Scenario: Standalone Web editor opens
- **WHEN** the workflow designer is opened directly in a browser without a compatible Host handshake
- **THEN** the Web header SHALL NOT display the local trial-run action
- **AND** Web save, version list, publish, and browser navigation SHALL remain available

#### Scenario: AI generation locks the editor
- **WHEN** AI is actively generating or materializing the workflow
- **THEN** the embedded trial-run action SHALL be disabled
- **AND** the system SHALL NOT send a trial-run request to the Host

### Requirement: Trial run requires explicit confirmation
StoClaw SHALL display its existing confirmation dialog after receiving a valid Web trial-run request and before asking Web to save. The dialog SHALL explain that the current canvas will be automatically saved as a draft.

#### Scenario: User cancels trial run confirmation
- **WHEN** the user cancels the confirmation dialog
- **THEN** StoClaw SHALL NOT send a save-draft request
- **AND** the Web trial-run state SHALL return to idle

#### Scenario: User confirms trial run
- **WHEN** the user confirms the dialog stating that the current canvas will be saved as a draft
- **THEN** StoClaw SHALL request a persisted draft snapshot from the Web editor
- **AND** MUST NOT open the startup flow before that request succeeds

### Requirement: Trial run persists the current canvas before execution
For every confirmed trial-run attempt, memory-center-web SHALL persist the current WorkflowDefinition through the existing workflow PUT endpoint before returning a snapshot. This SHALL occur even when the Web dirty-state calculation reports no changes. StoClaw MUST execute only the `workflowVersionId` returned by that successful save response and MUST NOT fall back to a previously known version.

#### Scenario: Existing draft is tried
- **WHEN** the current editing version is already a draft and the user confirms trial run
- **THEN** Web SHALL save the current canvas into that draft
- **AND** the returned draft version ID SHALL be used for the local run
- **AND** the save MUST NOT create a new history version solely because trial run was requested

#### Scenario: Published version is tried
- **WHEN** the current editing version is published and the user confirms trial run
- **THEN** the existing backend save model SHALL create a new draft version
- **AND** the active published version SHALL remain unchanged
- **AND** StoClaw SHALL run the returned draft version

#### Scenario: Unchanged canvas is tried
- **WHEN** the current canvas has no unsaved differences and the user confirms trial run
- **THEN** Web SHALL still call the save endpoint
- **AND** the latest saved time SHALL reflect the successful server confirmation

### Requirement: Save and trial-run states are coordinated
The Host and Web SHALL coordinate `idle`, `confirming`, `saving`, `preparing`, `running`, and `error` states. During `saving`, Web MUST lock interactions that can mutate the persisted definition. During `running`, a second trial run MUST be disabled while normal post-save editing MAY continue.

#### Scenario: Draft save is in progress
- **WHEN** Web is persisting the canvas for a confirmed trial run
- **THEN** workflow definition editing, title editing, save, publish, and repeated trial-run actions SHALL be disabled
- **AND** the trial-run action SHALL expose a saving state

#### Scenario: Local run is active
- **WHEN** StoClaw has started a local run for the saved version
- **THEN** the Web trial-run action SHALL remain unavailable for a second launch
- **AND** later canvas edits SHALL NOT alter the version bound to the active run

### Requirement: Save failures never run stale workflow content
Save errors, save timeout, missing version ID, invalid response, iframe reload, iframe close, route change, or workflow ID change SHALL terminate the pending trial-run attempt. The system MUST NOT use an earlier version ID as a fallback.

#### Scenario: Save request fails
- **WHEN** memory-center rejects or fails the automatic draft save
- **THEN** StoClaw SHALL NOT open the startup flow or create a local run
- **AND** the current canvas content SHALL remain available for correction and retry

#### Scenario: Save response arrives after timeout
- **WHEN** a save response arrives after its Host request has timed out or been invalidated
- **THEN** the response SHALL be ignored
- **AND** no local run SHALL be created from that response

#### Scenario: User cancels startup inputs
- **WHEN** draft save succeeds but the user cancels the startup parameter dialog
- **THEN** the saved draft SHALL remain persisted
- **AND** the system SHALL NOT create a local run record

### Requirement: Workflow bridge messages are authenticated and idempotent
Every workflow bridge business message SHALL validate the expected origin, iframe or parent window source, protocol, nonce, workflow ID, request ID, and message schema. A single iframe SHALL process at most one save-type trial-run request at a time, and duplicate requests or responses MUST NOT create duplicate local runs.

#### Scenario: Bridge envelope is invalid
- **WHEN** any required origin, source, protocol, nonce, workflow ID, request ID, or schema validation fails
- **THEN** the receiver SHALL ignore the message
- **AND** MUST NOT change trial-run state or start a run

#### Scenario: Trial-run request is duplicated
- **WHEN** the same request ID is delivered more than once
- **THEN** the system SHALL reuse or ignore the existing request outcome
- **AND** SHALL create at most one local run

### Requirement: Embedded back navigation preserves Web leave protection
The Web editor SHALL evaluate its existing unsaved-change and unpublished-draft leave rules before requesting embedded navigation. Only after the user is allowed to leave SHALL Web send a back request to StoClaw. Browser-standalone navigation SHALL continue to use the Web router.

#### Scenario: Embedded editor has protected changes
- **WHEN** the user activates back while Web leave protection requires confirmation
- **THEN** Web SHALL show its leave confirmation before sending a Host back request
- **AND** cancelling the confirmation SHALL keep the current editor route

#### Scenario: Embedded editor may leave
- **WHEN** Web leave protection permits navigation
- **THEN** Web SHALL send one validated back request to StoClaw
- **AND** StoClaw SHALL navigate to its workflow list route

### Requirement: Version status is consolidated in the version list
The workflow header SHALL NOT render a separate current-editing/current-active version summary. The version list or drawer SHALL continue to identify the current editing draft and current active published version using its existing badges.

#### Scenario: User inspects versions
- **WHEN** the user opens the version list from the unified header
- **THEN** the version list SHALL identify the current editing and current active versions
- **AND** the header SHALL remain free of the removed duplicate version summary

### Requirement: Header preserves native controls and theme accessibility
The unified header SHALL preserve Host-owned native window operations on macOS and Windows. Geometry SHALL align with the approved MasterGo layout, while color, typography contrast, background, border, focus, hover, selected, disabled, and status presentation MUST use semantic theme tokens consistent with `docs/sto-design.md` in both light and dark themes.

#### Scenario: macOS embedded editor
- **WHEN** the unified editor opens on macOS
- **THEN** Web content SHALL reserve a safe area for native traffic lights
- **AND** MUST NOT draw simulated traffic-light controls

#### Scenario: Windows embedded editor
- **WHEN** the unified editor opens on Windows
- **THEN** Host-owned minimize, maximize, and close controls SHALL remain visible and operable
- **AND** hiding the duplicate business header MUST NOT remove those controls

#### Scenario: Dark theme editor header
- **WHEN** the application uses dark theme
- **THEN** header surfaces, text, borders, focus indicators, hover, selected, disabled, and error states SHALL use dark-compatible semantic tokens
- **AND** text and controls SHALL remain readable and distinguishable without light-only hardcoded fills
