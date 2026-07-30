## Context

`wf_run` already stores local workflow execution state and `session_key`. Chat cards currently have a second, renderer-only identity stored in `workflow_card` message blocks and localStorage recovery records.

## Goals / Non-Goals

**Goals:**
- Make SQLite authoritative for whether a new workflow run owns a chat card
- Keep one card in the run's originating session
- Poll each active card from a compact SQLite projection
- Isolate normal chat messages from workflow-card rendering state

**Non-Goals:**
- Backfill or display runs created before this migration
- Display a card when another session merely queries a run status
- Add cross-session run-card bindings
- Change workflow engine status-event behavior used outside chat cards

## Decisions

### 1. Store the single chat presentation on `wf_run`
- **Decision**: Add visibility, user-message anchor, title, and parameter summary columns to `wf_run`.
- **Rationale**: A run has at most one originating chat card, so a separate binding table is unnecessary.
- **Alternative considered**: A many-to-many binding table. Rejected because status queries in other sessions must not create cards.
- **Launch durability**: The chat tool's v1 start bridge passes card metadata into the runtime, and the engine persists it in the first `wf_run` upsert. Renderer tool-result delivery may enrich the anchor later but is not required for card existence.
- **Discovery boundary**: The host start response waits only until that first SQLite row is observable; when the chat turn settles, the active session reloads its card-reference list. This guarantees immediate discovery without subscribing the card to workflow status events.

### 2. Poll compact card snapshots
- **Decision**: Each mounted active card performs one non-overlapping SQLite-backed query at a time and stops at a terminal state.
- **Rationale**: This removes event ordering, buffering, and cross-session listener complexity.
- **Alternative considered**: IPC status pushes merged with hydration snapshots. Rejected because it recreates two competing state sources.

### 3. Render an independent timeline item
- **Decision**: Merge card references with display items using the originating user message ID; fall back to a standalone chronological item.
- **Rationale**: Gateway message replacement cannot delete or move the card, and normal assistant messages remain immutable.
- **Alternative considered**: Continue injecting a `workflow_card` content block. Rejected because those blocks are not durable Gateway history.

## Risks / Trade-offs

- [Risk] Per-card polling causes several SQLite reads in sessions with concurrent runs. → Mitigation: compact projections, terminal-stop behavior, visibility pause, and non-overlapping timers.
- [Risk] A tool-started run is registered before its user anchor is known. → Mitigation: register it as visible first, then idempotently enrich the anchor; render standalone meanwhile.
- [Risk] Removing legacy recovery hides old cards. → Mitigation: explicitly accepted; migration defaults old rows to invisible.
- [Risk] Card styling regresses in dark mode. → Mitigation: retain existing semantic foreground/background/border/status tokens from `docs/sto-design.md`.
