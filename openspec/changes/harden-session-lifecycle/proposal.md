## Why

Chat and My Tasks sessions use layered optimistic compensation (client-only keys, message merge, cron placeholders). That makes the UI snappy, but still causes empty shells to look “real,” duplicate opening user turns under send/history races, disordered task-list rows after cron trigger, and dated-session key splits when UI agentId ≠ host `main`. We need lifecycle hardening now so sidebar order and in-session history stay coherent without waiting on Gateway id round-trip.

## What Changes

- Tighten first-send message reconciliation: disable label-based opening-user recovery and opening reorder while a send is in flight; strengthen opening-user dedupe for synthetic `session-label-user-*` ids.
- Align cron dated session keys so My Tasks trigger, host placeholders, and list supplements use the same agentId (job’s agent, default `main`).
- Fix task-group within-group activity sorting to prefer recent activity (`max` of store/meta), reserving `min` for first-trigger group ordering only.
- Keep client temporary `session-{ts}` shells as draft UX, but ensure unused shells are cleaned consistently and do not become durable “ghost” rows after refresh.
- Add/extend unit tests covering merge races, dated-key agentId, and activity sort.

## Capabilities

### New Capabilities
- `chat-session-reconcile`: Rules for optimistic user ↔ history merge, label recovery, and opening-user ordering relative to `sending`.
- `cron-dated-session-identity`: Single canonical dated cron session key per job/day/agent across UI trigger, host placeholder, and sidebar list.

### Modified Capabilities
- `cron-cloud-task`: Clarify that trigger/list paths must not invent a second dated row under a different agentId for the same job/day.

## Impact

- Renderer: `src/stores/chat.ts`, `src/stores/chat/user-message-merge.ts`, `src/pages/MyTask/index.tsx`, `src/pages/Cron/index.tsx`, `src/lib/scheduled-task-group-name.ts`, related unit tests.
- Host: `electron/api/routes/cron.ts`, `electron/utils/ensure-dated-execution-session.ts` (agentId from job when available).
- No package/dependency or build-config changes. No intentional UI theme changes (sto-design.md N/A).
