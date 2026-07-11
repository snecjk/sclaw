## Why

Claude/OpenClaw assistant turns are rebuilt from many sources (streaming message, streamingTools cache, tool_result, parser segments). Event ordering drift causes thinking text to jump or vanish, final reply conflicts with process narration, and tool cards show many false「无参数」entries.

## What Changes

- Phase 1 (this change): stop losing tool `input`, merge done-stage tool sources by input quality, cache merge on write, UI `inputState` for tool cards
- Later phases: `TurnPart[]` normalizer, unified tool identity (no input in key), live/history single pipeline

## Capabilities

### New Capabilities

- `chat-thinking-timeline`: stable chronological thinking/tool timeline and tool input enrichment

### Modified Capabilities

- `chat-thinking-process-surface` (future UI grouping; Phase 1 touches tool card input display only)

## Impact

- `src/stores/chat/helpers.ts`, `src/stores/chat/types.ts`, `src/stores/chat.ts`
- `src/lib/tool-input-merge.ts`, `src/lib/thinking-done-tools.ts`, `src/lib/thinking-turn-tools-cache.ts`
- `src/components/chat/chat-tool-call-card.tsx`, `src/pages/Chat/message-utils.ts`
- `tests/unit/*`, `tests/fixtures/chat-thinking-timeline/`
- Reference: `docs/对话流思考过程稳定化-Cursor开发文档.md`
