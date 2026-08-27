# Chat Store

This directory contains the renderer transcript/decorations store and canonical chat runtime projection. Electron Main's `ChatRuntimeSupervisor` is authoritative for run lifecycle, ordering, timeout, history reconciliation, and restart recovery.

## Canonical runtime

- `shared/chat-runtime-protocol.ts` defines the versioned event and snapshot contract.
- `runtime-v2-store.ts` subscribes before active-snapshot hydration, buffers bootstrap events, and consumes monotonic `(epoch, sequence)` events. Sequence gaps pause projection, single-flight hydrate, and replay only contiguous buffered events.
- `client-session-reducer.ts` is the pure per-session reducer; foreground and background events share it.
- `display-model.ts` projects immutable transcript data with optimistic overlay and display-only decorations. Streaming remains an active-turn overlay and is never copied into transcript; when a follow-up starts before transcript takeover, the completed turn is materialized only into the display projection.
- Renderer no longer subscribes to raw `gateway:notification` / `gateway:engine-event` chat events. A single `chat-runtime:event` subscription updates the canonical per-session reducer and then runs non-runtime effects such as history refresh, unread marking, and tool-result dispatch.
- `runtime-selectors.ts` exposes phase-derived session views for chat pages, input controls, model selectors, queues, parameter forms, and sidebar status. Active run state is distinct from the completed overlay's transcript-takeover state, so terminal UI controls do not wait for history reconciliation.
- `ChatState` no longer contains top-level messages, run fields, or `runtimeBySessionKey`; transcript, decoration, streaming, optimistic, tool, error, sync, and phase state live only in `sessionsByKey`.

- `store.ts` is now the composition layer. It wires state, persistence, helper dependencies, and action factories.
- `session-lifecycle-actions.ts` owns `loadSessions`, `deleteSession`, and `newSession`.
- `history-load-actions.ts` owns transcript loading; history no longer infers terminal run state in Renderer.
- Main projects newly persisted current-turn history messages into canonical deltas while a run is active, filling OpenClaw reasoning/tool records that are absent from its live assistant text buffer.
- `send-actions.ts` owns `sendMessage`, `abortRun`, quota checks, optimistic user messages, and media send. Reliability polling and hard deadlines are Main-owned.
- Main persists `(sessionKey, idempotencyKey)` acceptance and active runtime metadata; renderer restart recovery uses canonical snapshots rather than reconstructing run state from transcript messages.
- UI/session/workflow helper actions are split into `runtime-ui-actions.ts`, `session-ui-actions.ts`, `session-navigation-actions.ts`, and `workflow-actions.ts`.
- Public store consumers continue importing `@/stores/chat`; `src/stores/chat.ts` is the compatibility entry that re-exports `./chat/store`.

Shared support modules live here as first-class chat modules, including message
helpers, cron/session utilities, history decoration, workflow form recovery,
send quota helpers, session metadata hydration, and public types.
