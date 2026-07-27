# service-git-checkpoint

## ADDED Requirements

### Requirement: Automatic checkpoint per agent turn
The system SHALL create a git commit (checkpoint) in the app repository after each agent turn that modified files, with a message summarizing the turn, without exposing git terminology to the user.

#### Scenario: Agent modifies files
- **WHEN** an agent turn completes and the working tree has changes
- **THEN** the system SHALL stage and commit all changes as one checkpoint

#### Scenario: No changes in a turn
- **WHEN** an agent turn completes with no file changes
- **THEN** no checkpoint SHALL be created

### Requirement: One-click restore to previous checkpoint
The workbench SHALL offer a restore action that reverts the working tree to a selected (default: previous) checkpoint, creating a safety backup reference before restoring so the discarded state remains recoverable.

#### Scenario: Restore previous version
- **WHEN** the user triggers "恢复上一版"
- **THEN** the system SHALL create a backup reference of the current state, restore the working tree to the previous checkpoint, and refresh the preview

### Requirement: Graceful degradation without git
The system SHALL detect git availability per platform; when git is unavailable, checkpoint/restore UI SHALL be hidden with an explanatory hint, and creation/development SHALL proceed unaffected.

#### Scenario: Machine without git
- **WHEN** no usable git binary is found
- **THEN** app creation SHALL still succeed (skipping `git init`)
- **AND** the workbench SHALL hide restore controls and show a capability hint
