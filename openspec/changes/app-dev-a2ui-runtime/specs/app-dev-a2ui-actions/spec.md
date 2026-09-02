## ADDED Requirements

### Requirement: Action registry execution
The template MUST execute page actions through `contracts/action-registry.v1.json`. Button `action.event.name` MUST match a registered `actionId`.

#### Scenario: mock action without url
- **WHEN** the user triggers a registered action whose `url` is empty
- **THEN** the host MUST return the action's `mockResponse` (or a success stub) without rendering Action Runtime debug logs in the business preview

#### Scenario: unregistered action rejected
- **WHEN** the user triggers an action name not present in the registry
- **THEN** the host MUST report a brief, user-visible failure (not a developer Action Runtime panel) naming the missing `actionId`

#### Scenario: action debug log placement
- **WHEN** developers or SClaw need Action Runtime traces
- **THEN** those logs MUST NOT appear inside the app preview chrome; they MAY appear in a separate SClaw workbench column/panel later

#### Scenario: local navigation action
- **WHEN** the user triggers `app.navigate` with `context.pageId` of a registered page
- **THEN** the host MUST switch the active page asset without rewriting business JSX

### Requirement: Multi-page asset loading
The host MUST load A2UI pages from `src/pages/` via a page registry and hash route.

#### Scenario: open customer list page
- **WHEN** the location hash is `#customer-list` or navigation action targets `customer-list`
- **THEN** the host MUST render messages from `src/pages/customer-list.page.json`
