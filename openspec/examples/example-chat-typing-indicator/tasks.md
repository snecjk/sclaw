## 1. Setup

- [ ] 1.1 Add `typingUsers` field to `src/stores/chat.ts` store interface
- [ ] 1.2 Add typing event types to `electron/shared/ipc-channels.ts`

## 2. Core Implementation

- [ ] 2.1 Implement `hostApi.sendTypingStart(sessionId)` in `src/lib/host-api.ts`
- [ ] 2.2 Implement `hostApi.sendTypingStop(sessionId)` in `src/lib/host-api.ts`
- [ ] 2.3 Implement `hostApi.onTypingEvent(callback)` subscription in `src/lib/host-api.ts`
- [ ] 2.4 Add IPC handlers for typing events in `electron/main/ipc-handlers.ts`
- [ ] 2.5 Implement client-side debounce (2s) for typing stop in Chat input component
- [ ] 2.6 Implement auto-hide timeout (3s) for typing indicators in the Chat store

## 3. UI Implementation

- [ ] 3.1 Create `TypingIndicator` component in `src/components/chat/`
- [ ] 3.2 Integrate `TypingIndicator` into `src/pages/Chat/` message list
- [ ] 3.3 Support single user, two users, and "N others" display modes

## 4. Testing & Validation

- [ ] 4.1 Add unit tests for typing debounce logic
- [ ] 4.2 Add unit tests for typing indicator display modes
- [ ] 4.3 Run `pnpm run lint` and fix issues
- [ ] 4.4 Run `pnpm run typecheck` and fix issues
- [ ] 4.5 Run `pnpm run comms:replay` and `pnpm run comms:compare` (typing events are communication-path changes)
- [ ] 4.6 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates
