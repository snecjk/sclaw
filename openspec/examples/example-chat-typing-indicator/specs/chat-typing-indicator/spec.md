## ADDED Requirements

### Requirement: Chat page displays typing indicators for active participants
The system SHALL display a typing indicator in the Chat page when one or more other participants are actively typing.

#### Scenario: Single user typing
- **WHEN** another participant sends a `typing:start` event for the current chat session
- **THEN** the Chat page SHALL display "[Username] is typing..." below the last message

#### Scenario: Multiple users typing
- **WHEN** two or more participants send `typing:start` events simultaneously
- **THEN** the Chat page SHALL display "[User1] and [User2] are typing..."
- **AND** when more than three users are typing, the page SHALL display "[User1], [User2], and N others are typing..."

### Requirement: Typing indicator auto-hides after inactivity
The system SHALL automatically remove the typing indicator when no typing events have been received for a configurable timeout period.

#### Scenario: Typing stops naturally
- **WHEN** a participant sends a `typing:stop` event
- **THEN** the Chat page SHALL immediately remove that participant from the typing indicator

#### Scenario: Typing timeout
- **WHEN** no `typing:stop` event is received within 3 seconds of the last `typing:start` event
- **THEN** the Chat page SHALL automatically remove that participant from the typing indicator

### Requirement: Typing events are debounced on the client
The system SHALL debounce typing events on the client side to prevent excessive network traffic.

#### Scenario: User pauses while typing
- **WHEN** a user stops typing for 2 seconds
- **THEN** the client SHALL send a `typing:stop` event
- **AND** if the user resumes typing within the timeout, the client SHALL send another `typing:start` event

### Requirement: Renderer communicates typing events through host-api
The system SHALL send and receive typing events exclusively through the host-api layer, not via direct Gateway or IPC calls.

#### Scenario: Sending typing start
- **WHEN** the current user begins typing in the Chat input field
- **THEN** the client SHALL call `hostApi.sendTypingStart(sessionId)`
- **AND** the host-api SHALL proxy the event through the Main process to the Gateway

#### Scenario: Receiving typing event
- **WHEN** the Gateway pushes a `typing:start` event via WebSocket
- **THEN** the Main process SHALL forward it to the renderer through the host-api channel
- **AND** the renderer SHALL update the chat store through `hostApi.onTypingEvent(callback)`

> **⚠️ AGENTS.md Constraint**: Renderer code MUST NOT call `fetch('http://127.0.0.1:18789/...')` directly. All Gateway communication MUST use Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`).
