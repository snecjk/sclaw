## ADDED Requirements

### Requirement: Enqueue while session is answering

When a session has an active model run (`sending`), a new user send for that same session MUST be enqueued instead of interrupting the active run, unless the user explicitly chooses send-immediately. Each session MUST have an independent queue keyed by `sessionKey`.

#### Scenario: Follow-up enqueued during active run

- **WHEN** session A is answering and the user submits a new message for session A
- **THEN** the message is added to session A's queue
- **AND** the active run for session A continues without abort

#### Scenario: Queues are isolated by session

- **WHEN** session A is answering and the user submits a message for session B
- **THEN** session B's send path is independent of session A's queue
- **AND** session A's queue is unchanged by session B's send

### Requirement: Send immediately aborts then runs

The system SHALL provide a send-immediately action on a queued item. Invoking it MUST abort the active run for that session (if any), then send that queued item without applying the Stop-path auto-send suppression, while leaving other queued items for that session in place to drain after the new run completes.

#### Scenario: Send immediately from queue

- **WHEN** session A is answering and has queued item Q
- **AND** the user chooses send-immediately on Q
- **THEN** the active run for session A is aborted
- **AND** Q is removed from the queue and sent as the next user message
- **AND** remaining queued items for session A stay queued

#### Scenario: Stop does not auto-drain

- **WHEN** the user stops the active run without choosing send-immediately
- **THEN** the run aborts
- **AND** queued messages for that session remain queued
- **AND** they MUST NOT auto-send solely because of that abort

### Requirement: Per-session auto-drain

When a session's run finishes successfully (sending transitions true→false without abort-suppress and without a blocking error), the system MUST dequeue and send at most one queued message for **that** session. Auto-drain MUST key off that session's runtime sending state so background sessions can drain without being the current UI session.

#### Scenario: Background session drains its own queue

- **WHEN** session B finishes a successful run while the user is viewing session A
- **AND** session B has a non-empty queue
- **THEN** exactly one message is dequeued and sent for session B
- **AND** session A's queue and run state are unaffected

#### Scenario: Failed run does not chain-send

- **WHEN** a session run ends with an error
- **THEN** the system MUST NOT auto-dequeue the next queued message for that session

### Requirement: Queue item edit and delete

The queue UI SHALL allow deleting a queued item and editing a queued item's text (and attachments when present) before it is sent. Queue chrome MUST follow `docs/sto-design.md` semantic surfaces (muted/Grey text; destructive affordance for delete) rather than ad-hoc hex colors.

#### Scenario: Edit queued text

- **WHEN** the user edits a queued item's text and confirms
- **THEN** the stored queued message text is updated
- **AND** the item remains in its queue position

#### Scenario: Delete queued item

- **WHEN** the user deletes a queued item
- **THEN** that item is removed from the session queue
- **AND** other items keep their relative order

### Requirement: Queue is not catalog storage

Send-queue state MUST remain renderer runtime state and MUST NOT be persisted as rows in the SQLite session catalog. Catalog APIs remain organization-only.

#### Scenario: Catalog schema has no queue table

- **WHEN** migration `0002-session-catalog` is applied
- **THEN** the schema does not require a send-queue table for this capability
- **AND** queue behavior continues to use the in-memory per-session queue store
