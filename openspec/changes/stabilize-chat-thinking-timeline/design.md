## Architecture

- **Phase 1 (bleed fix)**: preserve tool `input` in store upsert path; merge done tools from cache + assistant snapshot + tool_result by input quality; distinguish `inputState` in UI
- **Phase 2+ (planned)**: `TurnPart[]` reducer in `src/pages/Chat/thinking/`; UI reads grouped parts only

## Code map (must read before edit)

| Area | File | Risk |
| --- | --- | --- |
| Turn entry | `AssistantTurnMessage.tsx` | live vs done source split |
| Parser | `thinking-turn-segments.ts` | tool key includes input (Phase 3) |
| Store extract | `chat/helpers.ts` `extractToolUseUpdates` | drops Anthropic `block.input` |
| Store merge | `chat/helpers.ts` `upsertToolStatuses` | spread overwrites input |
| Done tools | `thinking-done-tools.ts` | cache-first short-circuit |
| Cache | `thinking-turn-tools-cache.ts` | saves placeholder tools |
| UI | `chat-tool-call-card.tsx` | unknown input →「无参数」 |

## Decisions

### D1: Input quality merge helper

- **Choice**: `src/lib/tool-input-merge.ts` with `hasMeaningfulToolInput` / `mergeToolInput`
- **Rationale**: single rule for store, cache, done-tools
- **Alternative**: inline in each file — rejected (drift)

### D2: Done tools merge order

- **Choice**: merge all sources; per-tool input from highest-quality source (message > streaming > tool_result > cache)
- **Rationale**: doc §4 Step 4; cache must supplement not override
- **Alternative**: cache-first — current bug

### D3: UI unknown input

- **Choice**: `resolveToolInputState`; running+unknown shows loading, not「无参数」
- **Rationale**: doc §4 Step 7
- **Alternative**: rename string only — rejected

## Risks

- **[Risk]** `{}` may mean true empty args or pending — **Mitigation**: Phase 1 treats completed empty as `unknown`; `none` only when caller sets explicitly (Phase 2)
- **[Risk]** Duplicate logic in `chat.ts` — **Mitigation**: import `collectToolUpdates` / `upsertToolStatuses` from helpers

## References

- `docs/对话流思考过程稳定化-Cursor开发文档.md`
- sai-desktop `message.parts` pattern (read-only reference)
