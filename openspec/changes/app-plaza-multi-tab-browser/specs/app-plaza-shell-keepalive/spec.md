## ADDED Requirements

### Requirement: App plaza shell stays mounted when leaving the route
The system SHALL keep the App Plaza shell mounted for the signed-in desktop session while the user navigates to other claw primary routes. When the current route is not App Plaza, the shell MUST be completely non-visible (not shown in the layout) while keeping live webview processes alive. Returning to the App Plaza route MUST reveal the same shell without resetting tab order, selection, or live page state.

#### Scenario: Navigate away to chat
- **WHEN** the user has one or more live browser tabs open in App Plaza and navigates to a Chat (or other primary) route
- **THEN** the App Plaza shell MUST NOT be visible
- **AND** live browser webviews MUST remain running (not destroyed solely due to the route change)
- **AND** the system MUST NOT clear the tab list as a result of that navigation

#### Scenario: Navigate back to app plaza
- **WHEN** the user returns to the App Plaza route after visiting another primary route
- **THEN** the shell SHALL become visible again
- **AND** previously selected tab and live page state SHALL be preserved (suspended tabs remain suspended until selected)

### Requirement: Sidebar navigation must not destroy the app plaza tab workspace
Primary sidebar navigation MUST NOT close or reset the App Plaza multi-tab workspace merely because the user leaves `/more-apps`. Closing individual browser tabs or an explicit "close all" action MAY destroy those tabs.

#### Scenario: Sidebar pointerdown to another nav item
- **WHEN** the App Plaza shell has open browser tabs and the user activates another primary sidebar destination
- **THEN** the system MUST hide the shell without clearing tabs
- **AND** the system MUST NOT call a global close that destroys all live webviews solely due to that sidebar navigation

#### Scenario: User closes a browser tab
- **WHEN** the user closes a closable browser tab
- **THEN** the system SHALL remove that tab from the strip
- **AND** the system SHALL destroy that tab's webview and unregister its embed runtime if it was live

### Requirement: Dark mode keep-alive shell chrome remains consistent
When the shell is visible, its chrome (tab strip and browser toolbar) SHALL remain dark-mode compatible using semantic theme tokens. Hiding the shell MUST NOT leave interactive hit targets that intercept clicks on other routes.

#### Scenario: Hidden shell does not intercept input
- **WHEN** the App Plaza route is not active and the shell is hidden
- **THEN** the hidden shell MUST NOT receive pointer events intended for the visible route content
- **AND** focus MUST NOT remain trapped inside the hidden shell
