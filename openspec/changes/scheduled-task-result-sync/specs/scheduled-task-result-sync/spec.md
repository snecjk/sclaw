## ADDED Requirements

### Requirement: Main process polls cloud task execution results
The system SHALL periodically query the Cloud Task API for new scheduled task execution results while the StoClaw client is running. The polling SHALL run in the Main process, not the Renderer process. The polling SHALL use a serial queue (recursive `setTimeout` chain) to ensure that only one request is in flight at any given time.

#### Scenario: Global background poll discovers a new result
- **WHEN** the global polling interval (30 seconds) elapses
- **AND** the `listTasks()` response indicates a task whose `lastRunAt` is newer than the locally recorded `lastPolledAt` for that task
- **THEN** the system queries `GET /agent/v1/scheduled-tasks/{task_id}/runs` for that task
- **AND** receives the new run record(s)
- **AND** filters out runs whose `id` is already in the local `processedRunIds` set
- **AND** appends the new result to the local `scheduled-task:{taskId}` session

#### Scenario: Task-level high-frequency poll after manual trigger
- **WHEN** a user manually triggers a scheduled task
- **THEN** the system starts a high-frequency poll for that specific task
- **AND** queries `GET /agent/v1/scheduled-tasks/{task_id}/runs` every 5 seconds for the first 5 attempts
- **AND** thereafter queries every 10 seconds
- **AND** stops the high-frequency poll once a new run is discovered or after 2 minutes have elapsed

#### Scenario: Serial queue prevents concurrent requests
- **WHEN** the global polling tick begins while a previous tick is still awaiting a network response
- **THEN** the next tick SHALL be deferred until the current request completes
- **AND** no two polling requests SHALL be in flight simultaneously

### Requirement: Execution results are appended to local scheduled-task sessions
The system SHALL append newly discovered cloud execution results to the local session keyed by `scheduled-task:{taskId}`. The system SHALL reuse the existing `appendTriggerResultToSession` writer from `scheduled-task-session-writer.ts`. The appended messages SHALL use the same format as manual trigger results: `executionResult` as an `assistant` message and `logText` as a `system` message.

#### Scenario: Cloud run result appears in the same session as manual trigger results
- **WHEN** a cloud-scheduled run completes and the poller discovers it
- **THEN** the system appends the result to the existing `scheduled-task:{taskId}` session
- **AND** the Chat page renders the new message in chronological order alongside manual trigger results

#### Scenario: First cloud result creates the session if missing
- **WHEN** a cloud-scheduled run completes for a task that has never been triggered manually
- **AND** no `scheduled-task:{taskId}` session exists locally
- **THEN** the system creates the session via `ensureSession(taskId, taskName)`
- **AND** appends the result as the first message

### Requirement: Offline result compensation on startup
The system SHALL query for unsynchronized execution results when StoClaw starts. The query SHALL use the persisted `lastSyncTime` timestamp to fetch only results produced since the last successful sync. The system SHALL persist `lastSyncTime` and `processedRunIds` using `electron-store`.

#### Scenario: User opens StoClaw after being offline
- **WHEN** StoClaw launches
- **AND** the persisted `lastSyncTime` is older than the current time
- **THEN** the system performs an immediate poll before the first scheduled tick
- **AND** fetches all runs with `startedAt` greater than `lastSyncTime`
- **AND** appends them to the corresponding sessions in chronological order

#### Scenario: Duplicate run protection across restarts
- **WHEN** a run whose `id` is already in the persisted `processedRunIds` set is returned by the API
- **THEN** the system SHALL skip appending that run
- **AND** SHALL NOT update the session transcript

### Requirement: Processed run ID deduplication with bounded memory
The system SHALL maintain a `processedRunIds` set to prevent duplicate session writes. The set SHALL be persisted to `electron-store` and SHALL be bounded to the most recent 1000 run IDs (LRU eviction).

#### Scenario: Large batch of offline results
- **WHEN** the offline compensation query returns more than 50 new runs
- **THEN** the system processes them sequentially
- **AND** adds each run ID to `processedRunIds`
- **AND** if the set exceeds 1000 entries, the oldest entries are evicted

### Requirement: Network error resilience with exponential backoff
The system SHALL handle network or API failures gracefully. When a polling request fails, the system SHALL increase the next polling interval using exponential backoff (30s → 60s → 120s, capped at 5 minutes). The system SHALL resume the normal 30-second interval after a successful request.

#### Scenario: API temporarily unavailable
- **WHEN** a polling request receives a 5xx response or network timeout
- **THEN** the system logs a warning
- **AND** schedules the next tick with a doubled interval
- **AND** does not update `lastSyncTime`

#### Scenario: API recovers after outage
- **WHEN** a subsequent polling request succeeds after multiple failures
- **THEN** the system resets the polling interval to the base 30 seconds
- **AND** resumes normal operation
