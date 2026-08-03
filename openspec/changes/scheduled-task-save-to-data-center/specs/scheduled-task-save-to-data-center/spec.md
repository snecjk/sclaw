## ADDED Requirements

### Requirement: Scheduled tasks can save outputs to Data Center

The system SHALL allow users to configure whether a scheduled task saves generated artifacts to Data Center. The option SHALL be disabled by default.

#### Scenario: User enables Data Center saving
- **WHEN** the user checks "保存到数据中心" in the scheduled task modal
- **THEN** the modal expands save target controls
- **AND** the user can choose one or more target spaces and folders

#### Scenario: User leaves Data Center saving disabled
- **WHEN** the user creates or updates a scheduled task without enabling Data Center saving
- **THEN** the system stores no save target
- **AND** the task run SHALL NOT attempt Data Center artifact upload

### Requirement: Save targets use an extensible Data Center target model

The system SHALL represent artifact save destinations as generic Data Center targets with `spaceType`, optional `spaceId`, `parentEntryId`, and a stable URI. The sync service SHALL NOT hard-code scheduled-task-only target handling.

#### Scenario: Current spaces are selected
- **WHEN** the user selects "我的产物"
- **THEN** the saved target URI SHALL identify `qa_artifact`
- **WHEN** the user selects "网点共享产物"
- **THEN** the saved target URI SHALL identify `site_shared_artifact` and its `spaceId`

#### Scenario: Future spaces are introduced
- **WHEN** Data Center adds a department or project space
- **THEN** the sync service can accept the new `spaceType` without changing scheduled task executor logic

### Requirement: Artifact save status is recorded independently

The system SHALL record Data Center save status per artifact and per target. Save status SHALL be independent from scheduled task execution status.

#### Scenario: Task succeeds but save fails
- **WHEN** a scheduled task run succeeds
- **AND** Data Center upload fails
- **THEN** the task run remains succeeded
- **AND** the save record is marked failed with an error message
- **AND** the user can see the save failure reason

#### Scenario: Save succeeds
- **WHEN** a scheduled task artifact is uploaded successfully
- **THEN** the save record is marked succeeded
- **AND** the record stores the Data Center entry id and target path label when available

### Requirement: Scheduled task artifact uploads include related task title

The system SHALL include related task metadata for scheduled task artifact uploads.

#### Scenario: Data Center displays a scheduled task artifact
- **WHEN** an artifact with `sourceType = scheduled_task_artifact` appears in Data Center
- **THEN** the entry SHALL expose the related scheduled task title when available
- **AND** the UI SHALL display "关联任务：{task title}" next to the scheduled task label

### Requirement: Save path edits affect future runs only

The system SHALL allow users to edit scheduled task save targets. Edited targets SHALL apply only to future runs and SHALL NOT move or rewrite historical Data Center artifacts.
