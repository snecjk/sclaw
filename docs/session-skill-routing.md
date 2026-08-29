# Session Skill routing

Claude and Pi share a desktop-owned, per-session Skill router. The router persists
leases in SQLite (`session_skill_states`) and serializes every mutation by
`sessionKey`, so streaming tool events cannot overwrite a concurrent turn update.
State survives restart, is removed with the session, and stale rows are cleaned
after 30 days.

Users can turn Skill discovery off from the chat Skill picker. While disabled,
Claude and Pi skip routing-card synchronization, remote retrieval, and lease
updates for new turns, and receive every enabled Skill from the canonical local
catalog. The setting is enabled by default and takes effect on the next send.

Remote catalog synchronization and hybrid retrieval are owned by the independent
`SkillRoutingRemoteService`. It shares only the generic authenticated Memory Center
HTTP transport with Agent Memory; Skill Routing endpoints are not exposed by
`AgentMemoryRemoteService`.

At turn start the router reconciles enabled canonical-store packages and their
`sourceHash`, removes expired or invalid leases, and decides whether remote recall
is needed. Confirmed follow-ups reuse the current set; first turns, manifest changes,
new attachments or explicit Skills, topic changes, degraded searches, and the
five-turn refresh boundary search again. Remote failure falls back to local
slug/name/description and extension matching.

The remote index uses memory-center's independent DashVector collection
`sto_claw_skill_routing_cards` and Elasticsearch index `sto-claw-skill-routing`.
When the local manifest revision changes, the client upserts compact routing cards
through `/agent/v1/skill-routing/cards/upsert`. Search calls the stateless
`/agent/v1/skill-routing/search` endpoint, where memory-center performs BM25 and
embedding recall and combines the lists with RRF (`k=60`). Authentication,
`agentId`, engine, and mode filters remain server-owned; active-session state is
never stored remotely.

Lease order is explicit selection, agent-pinned, recently used, new recall, then
unused sticky selection. Explicit Skills and pinned Skills win truncation. Actual
Claude use is attributed only from a completed `Skill` `tool_use`; Pi use is
attributed only from `read` calls to the selected Skill's `SKILL.md` or
`references/`, plus explicit `/skill:name` commands. A successful use renews three
following turns; an unused selection receives one following turn. Failed or
interrupted turns do not promote usage.
