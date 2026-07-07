## ADDED Requirements

### Requirement: Local recent message groups

The expanded sidebar SHALL render user-defined groups above the「最近」section. Groups SHALL sort by creation time ascending. Empty groups SHALL remain visible.

#### Scenario: Empty group expanded

- **WHEN** a group has no sessions and is expanded
- **THEN** the UI shows「暂无会话」

### Requirement: Ungrouped recent list

The「最近」section SHALL list only sessions without a group assignment. When expanded with no ungrouped sessions, it SHALL show「暂无未分组会话」.

### Requirement: Session group menu

Each recent session row SHALL expose a `...` menu with rename, group submenu, and delete. Grouped sessions SHALL include「不分组」in the submenu per product spec.

### Requirement: Auto-expand

- **WHEN** a session is assigned to a group or a new group is created with a session
- **THEN** that group expands
- **WHEN** the active session belongs to a collapsed group
- **THEN** that group expands automatically
