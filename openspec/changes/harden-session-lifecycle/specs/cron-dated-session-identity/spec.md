## ADDED Requirements

### Requirement: Canonical dated cron session key
For a given OpenClaw cron job and local calendar day, the system MUST use one session key of the form `agent:{agentId}:cron:{jobId}:{YYYY-MM-DD}`, where `agentId` is the job’s configured agent (default `main`). Host placeholder creation, UI activating markers, and sidebar list materialization MUST share this key.

#### Scenario: Trigger non-main agent job from My Tasks
- **WHEN** the user triggers a cron job bound to agent `ops`
- **THEN** the host creates or revives the placeholder for `agent:ops:cron:{jobId}:{today}`
- **AND** the UI `markScheduledSessionActivating` / `switchSession` target the same key
- **AND** the sidebar does not show a second same-day row under `agent:main:cron:{jobId}:{today}` for that trigger

#### Scenario: Job agent missing on trigger
- **WHEN** the host cannot resolve a job agentId
- **THEN** it uses `main` for the dated placeholder key

### Requirement: Within-group recent activity ordering
Within a scheduled-task sidebar group, dated sessions MUST sort by recent activity using the maximum of local `sessionLastActivity` and session `updatedAt` (plus activating/runtime boosts). Earliest-first (`min`) semantics MUST apply only to first-trigger group ordering, not within-group recent order.

#### Scenario: Placeholder then content update
- **WHEN** a dated session placeholder is created and later receives a newer activity timestamp
- **THEN** within its task group the session orders by the newer activity (not the older of the two stamps)
