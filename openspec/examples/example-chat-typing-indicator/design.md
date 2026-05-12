## Context

The Chat page currently displays messages in a list but provides no feedback about whether other participants are composing a message. This is a standard feature in modern messaging applications.

## Goals / Non-Goals

**Goals:**
- Display a "User is typing..." indicator below the message list when another participant is typing
- Automatically hide the indicator 3 seconds after the last typing event
- Support multiple simultaneous typers (e.g., "Alice and Bob are typing...")

**Non-Goals:**
- Typing indicators in Channels or other pages (out of scope for this change)
- Typing sound effects or animations beyond a simple text indicator
- Typing speed analysis or "read receipt" features

## Decisions

### 1. Use Gateway WebSocket for typing events rather than polling
- **Decision**: Typing start/stop events are sent via the existing Gateway WebSocket connection (`gateway:httpProxy` → WebSocket).
- **Rationale**: WebSocket provides real-time delivery with lower latency than HTTP polling. The Gateway already maintains a WebSocket connection for chat messages, so no new connection is needed.
- **Alternative considered**: HTTP polling every 2 seconds. Rejected because it adds unnecessary network overhead and feels less responsive.

### 2. Debounce typing events on the client side
- **Decision**: Send `typing:stop` only after 2 seconds of inactivity, rather than on every keyup.
- **Rationale**: Prevents event spam when users pause briefly while typing. Reduces Gateway message volume.
- **Alternative considered**: Send stop immediately on blur. Rejected because it doesn't handle cases where the user switches windows without finishing.

### 3. Store typing state in the existing chat store rather than a new store
- **Decision**: Add a `typingUsers` field to the existing `src/stores/chat.ts` instead of creating `src/stores/chat-typing.ts`.
- **Rationale**: Typing state is tightly coupled with the current chat session. Keeping it in the chat store avoids cross-store synchronization complexity.
- **Alternative considered**: Separate `chat-typing` store. Rejected because it would require syncing session ID between two stores.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| High-frequency typing events overwhelm the Gateway | Client-side debounce (2s) and batching of multiple typers |
| Typing indicator persists if user disconnects unexpectedly | Server-side timeout: clear typing state if no heartbeat within 10s |
| UI clutter with many simultaneous typers | Cap display at 3 names: "Alice, Bob, and 2 others are typing..." |
