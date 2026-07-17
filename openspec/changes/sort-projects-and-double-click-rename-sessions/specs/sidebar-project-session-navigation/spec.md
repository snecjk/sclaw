## ADDED Requirements

### Requirement: Projects are ordered by creation time
The sidebar SHALL display projects in ascending creation-time order, with the earliest-created project first.

#### Scenario: Multiple projects have different creation times
- **WHEN** the sidebar renders multiple projects
- **THEN** projects are ordered from earliest to latest `createdAt`

#### Scenario: Projects have equal or missing creation times
- **WHEN** projects have equal or unavailable creation timestamps
- **THEN** the sidebar preserves their existing relative order

### Requirement: Sessions support double-click rename
The sidebar SHALL allow a user to enter the existing inline rename state by double-clicking a real session row in either the project or recent section. The inline editor MUST use semantic background, text, and border tokens that remain readable in dark mode.

#### Scenario: Double-click a project session
- **WHEN** the user double-clicks a real session under a project
- **THEN** that session enters the existing inline rename state

#### Scenario: Double-click a recent session
- **WHEN** the user double-clicks a real session in the recent section
- **THEN** that session enters the existing inline rename state

#### Scenario: Double-click a project new-chat draft
- **WHEN** the user double-clicks the project “new chat” draft
- **THEN** the draft MUST NOT enter rename state

#### Scenario: Inline rename in dark theme
- **WHEN** a project, session, or recent-group inline rename editor is shown in dark theme
- **THEN** its background, text, and Brand focus border use the corresponding semantic dark-theme tokens without a hardcoded white fill
