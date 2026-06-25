## 1. Session Loading & Filtering

- [x] 1.1 Modify `src/stores/chat/cron-session-utils.ts`: add `getCronRunSessionAggregateKey()` helper that maps `agent:{id}:cron:{jobId}:run:{runId}` → `agent:{id}:cron:{jobId}:{YYYY-MM-DD}` using today's date.
- [x] 1.2 Modify `src/stores/chat/session-actions.ts` `loadSessions`: after building `cronJobIdsWithDates`, also filter out run sessions (`parsed.runSessionId != null`) for jobs that have any dated session.
- [x] 1.3 Modify `src/stores/chat.ts` `loadSessions`: apply the same run session filtering logic in the Gateway-loaded sessions path.
- [x] 1.4 In `loadSessions` (both `session-actions.ts` and `chat.ts`): if a run session is filtered but no aggregate session exists for today, synthesize an aggregate session placeholder with `updatedAt = now`.

## 2. Runtime State Mapping

- [x] 2.1 Modify `src/stores/chat.ts` `handleChatEvent`: when `eventSessionKey` is a cron run session, derive the aggregate session key and call `handleBackgroundSessionEvent` with the aggregate key instead.
- [x] 2.2 Modify `src/stores/gateway.ts` `handleGatewayNotification`: when `sessionKey` is a cron run session, derive the aggregate key before calling `state.handleChatEvent` and `maybeLoadSessions`.
- [x] 2.3 Ensure `patchSessionRuntimeState` in `src/stores/chat.ts` works correctly with the mapped aggregate key (no changes needed if key mapping is done upstream).

## 3. Sidebar Loading Indicator

- [x] 3.1 Modify `src/components/layout/Sidebar.tsx` `SidebarScheduledTaskGroup`: check `runtimeBySessionKey` for each session in the group. If the aggregate session has `sending: true`, render a loading dot (spinner) next to the session label.
- [x] 3.2 Use existing `useChatStore((s) => s.runtimeBySessionKey)` selector to access runtime state.
- [x] 3.3 Loading indicator styling: use `animate-pulse` on a small circular element consistent with existing loading patterns in the app.

## 4. Defensive Fixes

- [x] 4.1 Add missing `modelSwitching: false` initial state in `src/stores/chat.ts` store definition (fixes pre-existing typecheck error).

## 5. Verification

- [x] 5.1 Run `pnpm run typecheck` to ensure TypeScript compiles without errors (excluding pre-existing TS6305/TS6133 issues).
- [x] 5.2 Review `README.md`, `README.zh-CN.md`, `README.ja-JP.md` for any documentation updates needed.
- [x] 5.3 If communication paths are touched (gateway event handling), run `pnpm run comms:replay` and `pnpm run comms:compare`.
