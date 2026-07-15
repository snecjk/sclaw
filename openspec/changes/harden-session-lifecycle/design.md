## Context

Sessions are layered: Gateway/Claude JSONL is transcript authority; SQLite catalog holds org metadata; Zustand holds optimistic list rows, labels, activity, and in-flight user messages. Cron dated placeholders and client `session-{ts}` drafts exist so the sidebar stays useful before disk catches up. Prior fixes (adjacent user dedupe, pending virtual merge, first-trigger store) reduced some faults but left send-time label recovery races and agentId splits on cron trigger.

## Goals / Non-Goals

**Goals:**
- One canonical dated cron key per job/day across UI activating, host placeholder, and list.
- No synthetic opening-user injection or timestamp rewrite while `sending` for that session.
- Task-group within-group order follows recent activity; group order stays first-trigger.
- Unit coverage for the above regressions.

**Non-Goals:**
- Gateway idempotencyKey → user message id persistence (tracked separately; frontend remains text-window paired).
- Removing temporary client `session-{ts}` draft keys entirely.
- Rewriting catalog SQLite schema or send queue from `session-catalog-sqlite`.
- Changing STO theme tokens / visual chrome.

## Decisions

### 1. Disable label recovery during active send
**Choice:** Pass `sending` into `recoverInitialUserFromSessionLabel` / `ensureOpeningUserMessageFirst` (or skip calling them from `loadHistory` when `sending`). Keep mergeOptimistic + adjacent dedupe.
**Why:** Label is already set from first display text; recovery doubles the opener when history lags.
**Alt:** Delete label recovery entirely — rejected; cold restore for workflow sessions still needs it.

### 2. Opening synthetic id hard-dedupe
**Choice:** When history contains a visible user whose display text matches a `session-label-user-*` message, drop the synthetic id even if not adjacent.
**Why:** Adjacent-only dedupe can miss pairs separated by early assistant/tool lines.

### 3. Cron placeholder uses job agentId
**Choice:** On `/api/cron/trigger`, resolve job’s agent from `cron/jobs.json` (or RPC job payload) and call `ensureCronDatedExecutionSessionPlaceholder(jobId, agentId, …)`. MyTask/Cron UI keep building `agent:{task.agentId}:cron:…`. Fallback `main`.
**Why:** Fixes dual keys `agent:X:…` vs `agent:main:…`.
**Alt:** Force all UI keys to `main` — rejected; agent scoping would be wrong for non-main agents.

### 4. Within-group activity uses max
**Choice:** `getSessionActivityMs` uses `Math.max(store, meta)` for base activity; `getSessionFirstTriggerMs` keeps `Math.min` for earliest-trigger semantics.
**Why:** Recent list already uses max; min caused mid-run row reordering after placeholder mtime + later activity fight.

### 5. Activating handoff unchanged, but keys must match
**Choice:** Keep `markScheduledSessionActivating` / release logic; correctness depends on Decision 3 so boost and materialization share a key.

## Risks / Trade-offs

- [Cold history briefly missing opener while send finishes] → Mitigation: optimistic user still preserved by `mergeOptimisticUserIntoHistory` while `sending`.
- [Job JSON missing agentId] → Mitigation: default `main`; log warn.
- [Legacy dual keys already on disk] → Mitigation: list dedupe by jobId+date preferring matching UI agent; optional one-pass ignore of orphan `main` twin when non-main dated exists (document as best-effort in tasks).

## Migration Plan

1. Ship host agentId fix + UI already using task.agentId → new triggers create one key.
2. No forced disk migration; refresh/`loadSessions` dedupe suppresses duplicate twins when detectable.
3. Rollback: revert merge gates and cron route agentId (safe; stale dual keys remain worst-case).

## Open Questions

- None blocking implementation; Gateway id round-trip remains a future dependency tracked outside this change.
