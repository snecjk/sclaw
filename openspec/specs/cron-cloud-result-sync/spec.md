## ADDED Requirements

### Requirement: Online result polling
The system SHALL periodically query the Cloud Task API for new cloud task execution results while the StoClaw client is running. When new results are found, the system SHALL persist them to local storage and update the corresponding task's run history.

#### Scenario: Cloud task completes while user is viewing Cron page
- **WHEN** the user is on the Cron page and the polling interval (30 seconds) elapses
- **AND** a cloud task has finished execution since the last poll
- **THEN** the system receives the new result from the Cloud Task API
- **AND** writes the result to local cache `cron/runs/{cloudJobId}.jsonl`
- **AND** updates the task's run history with the new entry
- **AND** displays a Toast notification

#### Scenario: Background polling discovers new results
- **WHEN** StoClaw is running in the background and the polling interval (60 seconds) elapses
- **AND** new cloud task results are available
- **THEN** the system fetches the results via HTTP query
- **AND** persists them to local storage
- **AND** triggers a system notification for new completed executions

#### Scenario: Duplicate result from polling overlap
- **WHEN** a polling query returns a result that was already received in the previous poll
- **THEN** the system detects the duplicate by result ID
- **AND** discards the duplicate without updating the UI

### Requirement: Offline result pull
The system SHALL query the Cloud Task API for unsynchronized execution results when StoClaw starts or when network connectivity is restored after being offline. The query SHALL use a cursor-based mechanism to fetch only results produced since the last successful sync.

#### Scenario: User opens StoClaw after being offline
- **WHEN** StoClaw launches and detects previous network downtime
- **THEN** the system queries the Cloud Task API with `lastSyncAt` timestamp
- **AND** receives all cloud task results generated during the offline period
- **AND** persists them to local storage in chronological order

#### Scenario: Large batch of offline results
- **WHEN** the offline result query returns more than 50 entries
- **THEN** the system fetches results in paginated batches using cursor pagination
- **AND** continues fetching until all unsynchronized results are retrieved
- **AND** displays a progress indicator during bulk sync

### Requirement: Cloud result local caching
The system SHALL store cloud task execution results in a local cache using the same format as local task run logs. The cache SHALL be readable offline and SHALL support the existing run history rendering logic without differentiation between local and cloud sources.

#### Scenario: User views cloud task history while offline
- **WHEN** the user opens the run history of a cloud task without network connectivity
- **THEN** the system renders the history from the local cache
- **AND** displays all previously synchronized results
- **AND** shows a subtle indicator that the history may be incomplete due to offline state

#### Scenario: Local cache eviction
- **WHEN** the local cache for a cloud task exceeds a configurable size limit
- **THEN** the system retains the most recent results and archives older entries
- **AND** archived entries remain queryable through the Cloud Task API

### Requirement: Execution result notification
The system SHALL display a Toast notification when a cloud task execution result is received, whether through real-time push or offline pull. The notification SHALL include the task name, execution status (success/failure), and a link to view the full result.

#### Scenario: Polling discovers success notification
- **WHEN** a periodic poll discovers that a cloud task execution succeeded
- **THEN** the system displays a Toast notification with a success icon
- **AND** the notification text reads "☁️ {taskName} executed successfully"
- **AND** clicking the notification navigates to the task's chat session

#### Scenario: Batch offline results notification
- **WHEN** StoClaw finishes pulling offline results and finds 3 new completed executions
- **THEN** the system displays a single summary notification
- **AND** the text reads "You have 3 cloud task results from while you were offline"
- **AND** clicking the notification opens the Cron page

#### Scenario: Execution failure notification
- **WHEN** a cloud task execution fails and the result is received
- **THEN** the system displays a warning Toast with the failure reason
- **AND** the notification includes a "View Details" action
- **AND** the failure reason is categorized (quota exceeded / model error / timeout / agent config error)

### Requirement: Unified run history rendering
The system SHALL render cloud task execution results in the same run history view as local tasks. Each history entry SHALL display execution environment label, timestamp, duration, status, and output summary. The user SHALL NOT need to distinguish between local and cloud results in the history view.

#### Scenario: User views mixed run history
- **WHEN** the user opens a cloud task's run history
- **THEN** the system displays all executions in chronological order
- **AND** each entry shows the execution environment tag (cloud or local)
- **AND** the visual styling and interaction patterns match local task history

#### Scenario: User clicks a cloud history entry
- **WHEN** the user clicks a cloud execution result in the history
- **THEN** the system navigates to the corresponding chat session
- **AND** renders the execution output as synthetic chat messages
- **AND** displays cloud execution metadata (cloud agent version, model used, execution duration)

### Requirement: Chat session synthesis for cloud results
The system SHALL synthesize a chat session from cloud task execution results for display in the Chat page. The synthesized session SHALL include a system metadata message and the assistant's response, preserving the same conversational structure as local cron sessions.

#### Scenario: Cloud result appears in chat
- **WHEN** a cloud task result is synchronized to local storage
- **THEN** the system creates or updates the chat session keyed by `agent:{cloudAgentId}:cron:{cloudJobId}`
- **AND** inserts a system message with execution metadata (timestamp, status, duration)
- **AND** appends the assistant's response message with the execution output

#### Scenario: User opens chat from cloud task history
- **WHEN** the user clicks "View in Chat" from a cloud task history entry
- **THEN** the Chat page loads the synthesized session
- **AND** displays the conversation as if it had occurred locally
- **AND** marks the session source as "cloud execution" in the session header
