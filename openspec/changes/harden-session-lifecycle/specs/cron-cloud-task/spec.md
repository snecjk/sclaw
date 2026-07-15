## ADDED Requirements

### Requirement: Trigger does not invent alternate-agent dated twin
When a cron job (local or cloud-backed) is force-run via host trigger, the system MUST NOT create a dated execution session under a different agentId than the job’s bound agent for the same jobId and calendar day.

#### Scenario: Force run after binding non-main agent
- **WHEN** a cron job is bound to a non-`main` agent and the user force-runs it
- **THEN** dated session materialization uses that bound agentId
- **AND** no additional same-day dated session is created solely under `main` for that job
