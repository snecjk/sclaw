# Chat Store

This directory contains the modular chat store implementation.

- `store.ts` is now the composition layer. It wires state, persistence, helper dependencies, and action factories.
- `session-lifecycle-actions.ts` owns `loadSessions`, `deleteSession`, and `newSession`.
- `history-load-actions.ts` owns `loadHistory` and history reconciliation.
- `send-actions.ts` owns `sendMessage`, `abortRun`, quota checks, optimistic user messages, media send, and history polling.
- `foreground-event-actions.ts` owns the active-session gateway event state machine.
- `run-lifecycle.ts` rejects stale/terminal run events before mutation; `runtime-timers.ts` owns watchdog timers keyed by session so concurrent sessions cannot cancel each other.
- `SessionRuntimeState.sendAcceptance` tracks pending, accepted, and uncertain sends; history polling reconciles timed-out requests by idempotency key before the UI allows another send.
- UI/session/workflow helper actions are split into `runtime-ui-actions.ts`, `session-ui-actions.ts`, `session-navigation-actions.ts`, and `workflow-actions.ts`.
- Public store consumers continue importing `@/stores/chat`; `src/stores/chat.ts` is the compatibility entry that re-exports `./chat/store`.

Shared support modules live here as first-class chat modules, including message
helpers, cron/session utilities, history merge, workflow form recovery, run
completion, send quota helpers, session metadata hydration, and public types.
