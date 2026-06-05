## Why

Users currently cannot see when another participant is typing in the Chat page, leading to awkward wait times and repeated message sends. A typing indicator will improve real-time collaboration perception and reduce message duplication.

## What Changes

- Add a typing indicator UI component in the Chat page message list
- Implement typing status synchronization between chat participants via the Gateway WebSocket
- Add a new Zustand store slice for typing state management
- Add host-api methods for typing start/stop events

## Capabilities

### New Capabilities
- `chat-typing-indicator`: Real-time typing status display and synchronization in the Chat page

### Modified Capabilities
<!-- No existing capabilities modified -->

## Impact

- `src/pages/Chat/`: New typing indicator component and integration
- `src/stores/chat.ts`: New typing state slice
- `src/lib/host-api.ts`: New typing event methods
- `electron/main/ipc/`: New IPC handlers for typing events (if Gateway proxy is insufficient)
- Gateway WebSocket events: New `typing:start` and `typing:stop` event types
