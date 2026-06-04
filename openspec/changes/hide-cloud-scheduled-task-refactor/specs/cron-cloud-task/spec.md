## MODIFIED Requirements

### Requirement: Unified task list display
The system SHALL display cloud tasks in the dedicated `/scheduled-tasks` cloud task interface. The legacy `/cron` page SHALL display local Gateway tasks only during this release. Each cloud task card SHALL show the execution environment indicator (cloud), bound agent name, schedule expression, and current status when rendered in the cloud interface.

#### Scenario: User views the cloud task list in dedicated interface
- **WHEN** the user navigates to the `/scheduled-tasks` page
- **THEN** the system fetches cloud tasks from the Cloud Task API
- **AND** renders them in the cloud task grid with cloud environment indicators

#### Scenario: Cloud Task API is unavailable during list fetch
- **WHEN** the user opens the `/scheduled-tasks` page but the Cloud Task API is unreachable
- **THEN** the system displays a warning banner indicating cloud tasks could not be loaded
- **AND** displays cached cloud task statuses with a "sync pending" indicator

#### Scenario: User views legacy cron page
- **WHEN** the user navigates to the `/cron` page
- **THEN** the system fetches local tasks from Gateway RPC only
- **AND** does not fetch or merge cloud tasks into the local task list
