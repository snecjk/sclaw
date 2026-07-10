## 1. OpenSpec & fixtures (Phase 0)

- [x] 1.1 Create change `stabilize-chat-thinking-timeline` artifacts
- [x] 1.2 Add Claude tool placeholder fixtures under `tests/fixtures/chat-thinking-timeline/`
- [x] 1.3 Add failing-then-green unit test skeleton for Phase 1 cases

## 2. Tool input bleed fix (Phase 1)

- [x] 2.1 `Tool input preservation in streaming store` — `tool-input-merge.ts`, `extractToolUseUpdates`, `upsertToolStatuses`, `ToolStatus.input`
- [x] 2.2 `Done-turn tool source merge` — `resolveDoneTurnStreamingTools`, cache write merge
- [x] 2.3 `Tool card input state display` — `ChatToolCallCard` + `resolveToolInputState`
- [x] 2.4 Deduplicate `chat.ts` tool upsert path → import from helpers

## 3. TurnPart normalizer (Phase 2–4)

- [x] 3.1 `turn-parts.ts` / `turn-part-reducer.ts` / `turn-part-groups.ts` / `turn-part-adapter.ts`
- [x] 3.2 `normalize-thinking-turn.ts` re-export; `parseThinkingTurnLayout` wires reducer + adapter
- [x] 3.3 `buildMergedRawTurnEvents` exported for live/history same path

## 4. Tool identity (Phase 3)

- [x] 4.1 `resolveToolIdentity` / `thinkingTimelineToolIdentityKey` in `tool-input-merge.ts`
- [x] 4.2 Replace input-in-key dedupe in `thinking-turn-segments.ts`, `message-utils.ts`, `adjacent-group-phase.ts`
- [x] 4.3 `ensureClaudeDoneSegmentsIncludeStreamingTools` uses `shouldAppendStreamingExtraTool`
- [x] 4.4 `mergeRawTurnEvents` merges input on duplicate identity

## 5. UI + interrupt (Phase 5–6)

- [x] 5.1 Adapter dedupes timeline tools + enriches input (ThinkingTurnProcess unchanged structurally)
- [x] 5.2 `turn-interrupt-marker.ts` + Stop → `markTurnInterrupted` + `wasInterrupted` in parse
- [x] 5.3 i18n `streaming.awaitingReply` → 「等待你的回复…」; add `streaming.interrupted`

## 6. Verification

- [x] 6.1 `pnpm vitest run` thinking timeline unit tests (64 passed)
- [ ] 6.2 `pnpm run typecheck` (pre-existing repo errors unrelated)
