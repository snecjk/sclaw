## 1. OpenSpec

- [x] 1.1 Create `openspec/changes/overlay-scrollbar-surfaces/` proposal / design / tasks / specs
- [x] 1.2 Record confirmed parameters: stop 120ms, fade ~150ms, rail 10 / thumb 6 / min 32 / inset-y 4
- [x] 1.3 Record scope: Sidebar mid-scroll → Home `HomeMainConversation` (non-split then split) → Embed Chat
- [x] 1.4 Record non-scope: Settings / Agents / Skills / Models / non-target lists; do not delete global scrollbar CSS

## 2. Shared Overlay Scrollbar（开发任务 1）

Covers: `Overlay scrollbar does not consume layout width`; `Overlay scrollbar reflects viewport geometry`; `Overlay scrollbar appears during scrolling and hides when idle`; `Overlay scrollbar supports pointer dragging while native viewport scrolling remains keyboard accessible`; `Light dark reduced-motion and forced-colors remain usable`

- [x] 2.1 Add `src/lib/overlay-scrollbar-metrics.ts` pure geometry helpers + unit tests (`reflects viewport geometry`) — present `tests/unit/overlay-scrollbar-metrics.test.ts`
- [x] 2.2 Add `src/hooks/use-overlay-scrollbar.ts` activity / geometry sync — 120ms stop, no React state on scroll path
- [x] 2.3 Add `src/components/ui/overlay-scrollbar.tsx` with fixed props contract and DOM `data-*` attributes
- [x] 2.4 Add scoped `.sto-overlay-scroll-viewport` / `.sto-overlay-scrollbar` CSS in `globals.css` — hide native; forced-colors restore
- [x] 2.5 Hook + component unit tests / metrics tests present; typecheck whitelist only as needed

## 3. Sidebar pilot（开发任务 2）

Covers: `Sidebar retains one scroll viewport and sticky behavior`; `Target surfaces align scrollbars to their right edge`; `Non-target scroll surfaces remain unchanged`

- [x] 3.1 Wrap Sidebar mid-scroll with relative wrapper + `OverlayScrollbar` sibling
- [x] 3.2 Keep `scrollContainerRef` on sole real viewport; add `contentMeasureRef` only
- [x] 3.3 Protect user uncommitted diffs in session row files (no edits in task 2)
- [x] 3.4 Verify sticky headers, auto-collapse, overflow show/hide, no layout width consumption; other routes/surfaces untouched

## 4. Sidebar horizontal baseline（开发任务 3）

Covers: visual horizontal symmetry supporting `Target surfaces align scrollbars to their right edge` (content inset only; not scrollbar structure)

- [x] 4.1 Task 3A analysis completed in prior delivery
- [x] 4.2 Task 3B minimal padding/trailing-slot edits applied as needed
- [x] 4.3 Do not restore or change removed active `font-medium`; do not change scrollbar structure

## 5. Home full-bleed layout（开发任务 4A）

Covers: `Target surfaces align scrollbars to their right edge`; `Non-target scroll surfaces remain unchanged`

- [x] 5.1 Provide Home-only full-bleed body for `/` via MainLayout whitelist (`stoMainCardBodyHomeClass`)
- [x] 5.2 Keep landing visual inset inside Home; no negative margin / calc / portal
- [x] 5.3 Do not modify `src/pages/Chat/index.tsx` as runtime entry (`/chat` → `/`)
- [x] 5.4 Verify landing does not drift; other routes unchanged

## 6. Home non-split Overlay（开发任务 4B）

- [x] 6.1 Wire `OverlayScrollbar` to existing `scrollRef` / `contentRef` in `HomeMainConversation`
- [x] 6.2 Preserve `useStickToBottomInstant`, `useChatScrollFollow`, Jump to latest, search, user-away semantics
- [x] 6.3 Non-split accepted in prior delivery

## 7. Home split Overlay（开发任务 5）

- [x] 7.1 Split path reuses same Overlay host (no duplicated Overlay logic)
- [x] 7.2 Preview toggle / percent resize / scrollTop retention verified in prior delivery (geometry seam debt owned by workspace shell Change)
- [x] 7.3 Embed Chat deferred to task 8 (done below)

## 8. Embed Chat Overlay（开发任务 6）

- [x] 8.1 Wire Overlay to Embed Chat existing `scrollRef` / `contentRef` only (`SclawBrowserEmbedChat`)
- [x] 8.2 Do not modify webview/iframe document scrollbar
- [x] 8.3 Independent scroll + cleanup on unmount (implementation present)

## 9. Transition cleanup（开发任务 7）

- [x] 9.1 Transitional dead code cleaned only where confirmed
- [x] 9.2 Keep `useNativeScrollbarActivity` + tests if old Chat page still consumes
- [x] 9.3 Do not delete global scrollbar CSS

## 10. Final acceptance / dependency note（开发任务 8）

- [x] 10.1 Prior delivery reported matrix; unverified platforms remain explicit where noted
- [x] 10.2 README/rules patches only on confirmed conflicts
- [x] 10.3 Do not run auto-fix-all-repo lint unless user requests
- [x] 10.4 **Stage 0 note (2026-07-31):** `workspace-shell-architecture-upgrade` depends on this Change as **reuse-only**; shell work MUST NOT rewrite Overlay metrics/hook/component — only host/rail alignment for zero-seam
