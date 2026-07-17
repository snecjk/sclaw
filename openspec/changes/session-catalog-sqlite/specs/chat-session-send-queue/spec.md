## ADDED Requirements

### Requirement: Per-session queue while answering

When a session has an active run (`sending` or equivalent runtime flag), new user messages for that session SHALL be enqueued in `useMessageQueueStore` instead of sending immediately. The queue is keyed by `sessionKey`, capped per session (existing limit), and stored in memory only.

#### Scenario: Message during active run

- **WHEN** the user submits a message while session S is answering
- **THEN** the message is appended to S's queue
- **AND** the chat input clears without starting a parallel run

### Requirement: Stop retains queue

When the user stops the current run, the system SHALL abort the run and SHALL NOT auto-send the next queued message as a consequence of that stop. Stop MUST use the existing `suspendAutoSend` path for the affected session.

#### Scenario: User presses Stop

- **WHEN** the user stops the active run on session S
- **THEN** the run aborts
- **AND** queued messages for S remain in the queue
- **AND** no queue item sends until the next successful run completion or explicit send-immediately

### Requirement: Send immediately

The queue panel SHALL offer send-immediately (↑) on each queued item. Activating it SHALL abort the current run for that session **without** calling `suspendAutoSend`, remove the chosen item from the queue, and send it as the next user message.

#### Scenario: Send immediately during run

- **WHEN** the user chooses send-immediately on queued item Q in session S while S is answering
- **THEN** the current run for S is aborted without suppressing auto-send for that abort
- **AND** Q is dequeued and sent
- **AND** remaining queue items stay ordered after Q's former position

### Requirement: Edit and delete queue items

The queue panel SHALL allow editing queued message text and deleting individual items without affecting other sessions' queues.

#### Scenario: Edit queued message

- **WHEN** the user edits item Q in session S's queue
- **THEN** the stored text for Q updates
- **AND** attachments/metadata on Q are preserved unless the edit flow replaces them

#### Scenario: Delete queued message

- **WHEN** the user deletes item Q from session S's queue
- **THEN** Q is removed
- **AND** other items retain relative order

### Requirement: Per-session auto-drain

When any session's run finishes successfully (runtime `sending` transitions true→false for that `sessionKey`, no error, not user-abort suppressed), the system SHALL dequeue and send at most one queued message for **that** session. Auto-drain MUST work for background sessions via `runtimeBySessionKey`, not only the current session's global `sending` flag.

#### Scenario: Background session completes

- **WHEN** session S (not the foreground session) finishes a successful run
- **AND** S has queued messages
- **THEN** exactly one queued message for S sends automatically

#### Scenario: Failed run does not drain

- **WHEN** a run finishes with an error set for session S
- **THEN** no queued message auto-sends for S

### Requirement: Queue panel UX

The chat surfaces SHALL render a Cursor-like pending queue panel listing queued items with edit, send-immediately, delete, and reorder controls (existing move up/down). UI MUST follow `docs/sto-design.md`.

#### Scenario: Panel visible with queue

- **WHEN** the active session has one or more queued messages
- **THEN** the pending queue panel displays above or adjacent to the composer per existing layout
