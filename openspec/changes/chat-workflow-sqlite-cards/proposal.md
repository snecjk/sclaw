## Why

Workflow progress cards are currently attached to renderer-only chat message blocks and updated through asynchronous status events. History reloads and session switches can therefore remove or misplace cards. Persisting card ownership with the local workflow run makes SQLite the durable source of truth.

## What Changes

- Persist new-chat-run card visibility, anchor, title, and parameter summary on `wf_run`
- Discover cards by chat session and load each card snapshot from SQLite
- Render cards as independent chat timeline items instead of message content blocks
- Poll active card snapshots and stop using workflow status events for chat-card updates
- Keep workflow status-query tool calls as normal textual tool/model responses

## Capabilities

### New Capabilities
- `chat-workflow-progress-card`: Durable SQLite-backed progress cards in the originating chat session
- `host-api-workflow-runtime`: Compact chat-card registration and query projections

### Modified Capabilities
- None

## Impact

- Workflow runtime SQLite schema and repository
- Workflow runtime host API/IPC projections
- Chat timeline composition and workflow card rendering
- Workflow start/status tool-result handling
- Existing semantic card styling remains compatible with light and dark mode
