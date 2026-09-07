# Session Skill routing

Claude and Pi share a desktop-owned, per-session Skill router. The router persists
leases in SQLite (`session_skill_states`) and serializes every mutation by
`sessionKey`, so streaming tool events cannot overwrite a concurrent turn update.
State survives restart, is removed with the session, and stale rows are cleaned
after 30 days.

Users can turn pre-turn Skill discovery off from the chat Skill picker. While
disabled, Claude and Pi skip routing-card synchronization and remote pre-routing.
The always-active runtime catalog tools remain available, while both engines
preserve their native all-enabled projection.

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

## Runtime discovery and loading

Both engines expose the common `search_skills` extension tool through the typed
Main Host API:

- `search_skills` searches the complete enabled canonical catalog. It combines
  remote hybrid results with deterministic local slug/name/description matching,
  and continues locally when Memory Center is unavailable.
- Main resolves every remote slug back through the enabled canonical catalog and
  adds real, locally validated `skillRoot` and `skillMdPath` values. Remote services
  never provide or authorize local filesystem paths.

The model selects a result and uses Claude `Read` or Pi `read` to read `skillMdPath`
and any referenced package files. Only paths under a candidate's real Skill root
receive the current-turn read authorization. A successful native read revalidates
the enabled package and source hash in Main, attaches it as `loaded`, records it as
`used`, and renews its three-turn lease.

Pi keeps unmanaged native/project Skill scanning disabled, but passes the bounded
pre-turn Top-K paths to Pi's native resource loader. Claude passes the bounded slug
set to its SDK. In both engines runtime search and native file reading are only used
when execution discovers that the native start-of-turn set is insufficient.

## Default engine Skills

Reviewed foundational Skills are declared in the shared
`DEFAULT_ENGINE_SKILL_RULES` list. Rules can target Claude, Pi, interactive, or
scheduled sessions. A rule only takes effect when its package exists and is enabled
in the canonical catalog; it is then pinned ahead of ordinary recall and loaded
through the engine's normal Skill mechanism. `sai-cli` is the current baseline.
