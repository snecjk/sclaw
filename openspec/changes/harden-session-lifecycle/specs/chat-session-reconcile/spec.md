## ADDED Requirements

### Requirement: No label-based opening user while send is in flight
While a chat session has an active send (`sending` true for that session), the system MUST NOT inject a synthetic opening user message derived from the session label, and MUST NOT rewrite opening-user timestamps solely to force top placement.

#### Scenario: History poll during long chat.send
- **WHEN** the user sends the first message in a temporary session and Gateway `chat.send` blocks
- **AND** a history poll runs before the user turn appears in `chat.history`
- **THEN** the UI keeps at most the optimistic user bubble for that turn
- **AND** the system does not add a second user bubble from the derived session label

#### Scenario: Cold restore after send completes
- **WHEN** `sending` is false and history has assistant content but no visible opening user
- **AND** a non-placeholder session label exists
- **THEN** the system MAY reconstruct a single opening user from that label
- **AND** place it before assistant/workflow messages

### Requirement: Synthetic opening user hard-dedupe
When a synthetic opening user with id `session-label-user-{sessionKey}` coexists with any history user whose display-normalized text matches the label, the system MUST drop the synthetic message even if the two user messages are not adjacent.

#### Scenario: Assistant fragment between synthetic and history user
- **WHEN** messages contain `[session-label-user, assistant partial, history user with same display text]`
- **THEN** after reconciliation only one user turn with that display text remains

### Requirement: Optimistic user preserved until history echo
During an active send, if history omits the current user turn, the system MUST retain the optimistic user message in the visible transcript until a display-normalized (or id-matched) history echo appears.

#### Scenario: Empty history mid-send
- **WHEN** `sending` is true and `chat.history` returns no user messages yet
- **THEN** the optimistic user message remains visible
