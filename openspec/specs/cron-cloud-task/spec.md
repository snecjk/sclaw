## ADDED Requirements

### Requirement: Cloud task creation
The system SHALL create cloud tasks through the external Cloud Task API when the user saves a new cron job. The task configuration SHALL include schedule expression, payload message, target cloud agent ID, and session target mode.

#### Scenario: User creates a cloud cron job
- **WHEN** the user fills in the cron job form with name, schedule, message, and selects a cloud agent
- **THEN** the system submits the task to the Cloud Task API via the Main-process proxy
- **AND** the task appears in the cron job list with a cloud execution indicator

#### Scenario: Cloud task creation fails due to network error
- **WHEN** the user submits a new cloud cron job but the Cloud Task API is unreachable
- **THEN** the system displays an error toast with a retry option
- **AND** the task is NOT added to the local task list

### Requirement: Cloud agent selection
The system SHALL present a cloud agent selector when the user creates a cloud task. The selector SHALL list available cloud agents fetched from the external Cloud Agent API. Each option SHALL display the agent name and model information.

#### Scenario: User selects a cloud agent for a new task
- **WHEN** the user opens the cron job creation form
- **THEN** the system fetches the cloud agent list from the Cloud Agent API
- **AND** the agent selector is populated with available cloud agents
- **AND** the user MUST select one agent before saving the task

#### Scenario: Cloud agent list is empty
- **WHEN** the user opens the cron job creation form and no cloud agents exist
- **THEN** the system displays a message indicating no cloud agents are available
- **AND** provides a link or guidance to create a cloud agent first

### Requirement: Unified task list display
The system SHALL display both local and cloud tasks in a unified cron job list. Each task card SHALL show the execution environment indicator (local or cloud), bound agent name, schedule expression, and current status.

#### Scenario: User views the cron job list with mixed tasks
- **WHEN** the user navigates to the Cron page
- **THEN** the system fetches local tasks from Gateway RPC and cloud tasks from Cloud Task API
- **AND** merges them into a single sorted list ordered by next execution time
- **AND** each cloud task displays a cloud environment indicator

#### Scenario: Cloud Task API is unavailable during list fetch
- **WHEN** the user opens the Cron page but the Cloud Task API is unreachable
- **THEN** the system displays local tasks normally
- **AND** shows a warning banner indicating cloud tasks could not be loaded
- **AND** displays cached cloud task statuses with a "sync pending" indicator

### Requirement: Cloud task editing
The system SHALL allow the user to edit cloud task properties (name, schedule, message, target agent) through the Cloud Task API. The edited properties SHALL be persisted to the cloud and reflected in the local task list.

#### Scenario: User edits a cloud task
- **WHEN** the user opens the edit dialog for a cloud task and modifies the schedule
- **THEN** the system sends the update to the Cloud Task API
- **AND** updates the local cached state upon success
- **AND** displays a success toast notification

#### Scenario: User attempts to edit a task that was deleted on the cloud
- **WHEN** the user submits an edit for a cloud task that no longer exists on the cloud
- **THEN** the system displays an error indicating the task was not found
- **AND** removes the stale task from the local list

### Requirement: Cloud task deletion
The system SHALL allow the user to delete a cloud task. Deletion SHALL invoke the Cloud Task API to remove the task from the cloud, and upon success, remove the task reference from local storage.

#### Scenario: User deletes a cloud task
- **WHEN** the user clicks the delete button on a cloud task card and confirms
- **THEN** the system sends a delete request to the Cloud Task API
- **AND** removes the task from the local list upon confirmation
- **AND** displays a success toast with an undo option

### Requirement: Cloud task toggle
The system SHALL allow the user to enable or disable a cloud task. The toggle operation SHALL call the Cloud Task API to update the enabled state.

#### Scenario: User disables a cloud task
- **WHEN** the user toggles off a cloud task
- **THEN** the system sends the state change to the Cloud Task API
- **AND** updates the local task card to show the disabled state
- **AND** the task stops scheduling on the cloud

#### Scenario: User enables a cloud task
- **WHEN** the user toggles on a previously disabled cloud task
- **THEN** the system sends the state change to the Cloud Task API
- **AND** the cloud scheduler resumes execution according to the configured schedule

### Requirement: Cloud task manual trigger
The system SHALL allow the user to manually trigger an immediate execution of a cloud task through the Cloud Task API.

#### Scenario: User triggers a cloud task manually
- **WHEN** the user clicks the "Run Now" button on a cloud task card
- **THEN** the system sends a trigger request to the Cloud Task API
- **AND** displays a "Task triggered" confirmation
- **AND** the execution result is delivered through the result sync channel when complete
