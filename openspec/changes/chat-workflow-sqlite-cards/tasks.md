## 1. SQLite and Host API

- [x] 1.1 Add `wf_run` chat presentation columns and Kysely types. (`New workflow runs persist their originating chat card`)
- [x] 1.2 Add repository and host interfaces for registration, session references, and compact snapshots. (`Renderer accesses workflow runtime through host API boundaries`)

## 2. Workflow Start Semantics

- [x] 2.1 Register cards only for newly started chat runs, with standalone fallback when the anchor is unavailable. (`New workflow runs persist their originating chat card`)
- [x] 2.2 Keep status-query tool calls text-only and prevent session/card mutation. (`New workflow runs persist their originating chat card`)

## 3. Chat Timeline and Polling

- [x] 3.1 Add independent workflow-run timeline items anchored by originating user message ID. (`Chat cards are discovered and rendered independently from messages`)
- [x] 3.2 Implement non-overlapping per-card polling, visibility pause, terminal stop, bounded backoff, and manual retry. (`Active cards poll SQLite snapshots`)
- [x] 3.3 Remove message-block injection, localStorage restoration, and event-driven chat-card updates. (`Active cards poll SQLite snapshots`)
- [x] 3.4 Verify semantic styling, interactions, and readability in light and dark mode. (`Workflow card presentation supports application themes`)

## 4. Validation and Documentation

- [x] 4.1 Add migration, repository, timeline, start/status semantics, and polling tests. (`New workflow runs persist their originating chat card`; `Active cards poll SQLite snapshots`)
- [ ] 4.2 Run typecheck, relevant unit tests, `comms:replay`, and `comms:compare`. (`Renderer accesses workflow runtime through host API boundaries`) — relevant tests and both comms checks pass; repository-wide typecheck remains blocked by pre-existing errors.
- [x] 4.3 Update the available README architecture documentation. (`Chat cards are discovered and rendered independently from messages`) — this checkout contains `README.md`; `README.zh-CN.md` and `README.ja-JP.md` are absent.
