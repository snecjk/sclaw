## 1. Chat send-time reconcile

- [x] 1.1 Gate `recoverInitialUserFromSessionLabel` / `ensureOpeningUserMessageFirst` so they no-op when `sending` is true (call sites in `chat.ts` / merge helpers)
- [x] 1.2 Harden dedupe to drop `session-label-user-*` when any display-matching history user exists (non-adjacent)
- [x] 1.3 Unit tests for mid-send history poll (no double opener) and synthetic hard-dedupe

## 2. Cron dated key identity

- [x] 2.1 Resolve job agentId in `/api/cron/trigger` and pass it to `ensureCronDatedExecutionSessionPlaceholder` / revive helpers
- [x] 2.2 Best-effort list dedupe: same jobId+date prefer the key matching job agent; suppress orphan `main` twin when non-main dated exists
- [x] 2.3 Unit/integration-style test or route helper test for agentId selection on trigger

## 3. Sidebar within-group activity

- [x] 3.1 Change `getSessionActivityMs` base to `Math.max(store, meta)`; keep `getSessionFirstTriggerMs` on `Math.min`
- [x] 3.2 Unit tests for activity max vs first-trigger min

## 4. Verify

- [x] 4.1 Run targeted unit tests for merge, activity sort, and cron agent helper

## 5. Trigger path twin collapse (follow-up)

- [x] 5.1 Do not append pending local dated cron when remote already has same jobId+date under another agent
- [x] 5.2 After `sessionsWithCurrent`, collapse agent twins again preferring activating/current key; migrate activating spinner onto surviving key
