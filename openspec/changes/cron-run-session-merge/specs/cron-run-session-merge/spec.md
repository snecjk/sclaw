## ADDED Requirements

### Requirement: Cron run sessions filtered from session list during execution
The system SHALL remove temporary cron run sessions (`agent:{agentId}:cron:{jobId}:run:{runSessionId}`) from the session list when the corresponding job already has dated aggregate sessions.

#### Scenario: Run session filtered while dated session exists
- **WHEN** `loadSessions` loads a run session key `agent:main:cron:job-123:run:abc-def`
- **AND** a dated session `agent:main:cron:job-123:2026-06-21` exists for the same job
- **THEN** the run session SHALL NOT appear in the returned sessions list
- **AND** its runtime state SHALL be mapped to the dated session key

### Requirement: Cron run session runtime mapped to daily aggregate session
The system SHALL redirect runtime state updates for a run session to the corresponding daily aggregate session key.

#### Scenario: Gateway started event for run session
- **WHEN** the Gateway emits an `agent` event with `phase: 'started'` for session key `agent:main:cron:job-123:run:abc-def`
- **THEN** `handleChatEvent` SHALL write the runtime state to `runtimeBySessionKey['agent:main:cron:job-123:2026-06-21']` instead of the run session key
- **AND** the daily aggregate session SHALL display a loading indicator in the sidebar

#### Scenario: Gateway completed event for run session
- **WHEN** the Gateway emits an `agent` event with `phase: 'completed'` for session key `agent:main:cron:job-123:run:abc-def`
- **THEN** `handleChatEvent` SHALL clear the runtime state for the aggregate session key
- **AND** `maybeLoadSessions` SHALL refresh the session list
- **AND** the run session SHALL no longer appear in the sidebar

### Requirement: Auto-create daily aggregate session placeholder for first run
The system SHALL create a virtual daily aggregate session entry if a run session exists but no aggregate session for the current day exists.

#### Scenario: First run of a cron job today
- **WHEN** `loadSessions` detects a run session for job `job-123`
- **AND** no dated session `agent:main:cron:job-123:{today}` exists
- **THEN** the system SHALL synthesize a session entry with key `agent:main:cron:job-123:{today}` and label derived from the current date
- **AND** the run session SHALL still be filtered out
