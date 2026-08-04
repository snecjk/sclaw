## 1. OpenSpec

- [x] 1.1 Create `openspec/changes/overlay-scrollbar-surfaces/` proposal / design / tasks / specs
- [x] 1.2 Record confirmed parameters: stop 120ms, fade ~150ms, rail 10 / thumb 6 / min 32 / inset-y 4
- [x] 1.3 Record scope: Sidebar mid-scroll → Home `HomeMainConversation` (non-split then split) → Embed Chat
- [x] 1.4 Record non-scope: Settings / Agents / Skills / Models / non-target lists; do not delete global scrollbar CSS

## 2. Shared Overlay Scrollbar（开发任务 1）

Covers: `Overlay scrollbar does not consume layout width`; `Overlay scrollbar reflects viewport geometry`; `Overlay scrollbar appears during scrolling and hides when idle`; `Overlay scrollbar supports pointer dragging while native viewport scrolling remains keyboard accessible`; `Light dark reduced-motion and forced-colors remain usable`

- [ ] 2.1 Add `src/lib/overlay-scrollbar-metrics.ts` pure geometry helpers + unit tests (`reflects viewport geometry`)
- [ ] 2.2 Add `src/hooks/use-overlay-scrollbar.ts` activity / geometry sync — 120ms stop, no React state on scroll path (`appears during scrolling and hides when idle`)
- [ ] 2.3 Add `src/components/ui/overlay-scrollbar.tsx` with fixed props contract and DOM `data-*` attributes (`pointer dragging` + keyboard via native viewport)
- [ ] 2.4 Add scoped `.sto-overlay-scroll-viewport` / `.sto-overlay-scrollbar` CSS in `globals.css` — hide native; forced-colors restore (`does not consume layout width`; `light dark reduced-motion and forced-colors`)
- [ ] 2.5 Hook + component unit tests (fake timers, ResizeObserver/pointer stubs); typecheck whitelist only

## 3. Sidebar pilot（开发任务 2）

Covers: `Sidebar retains one scroll viewport and sticky behavior`; `Target surfaces align scrollbars to their right edge`; `Non-target scroll surfaces remain unchanged`

- [ ] 3.1 Wrap Sidebar mid-scroll with relative wrapper + `OverlayScrollbar` sibling (`align … right edge`)
- [ ] 3.2 Keep `scrollContainerRef` on sole real viewport; add `contentMeasureRef` only (`retains one scroll viewport and sticky behavior`)
- [ ] 3.3 Protect user uncommitted diffs in session row files (no edits in task 2)
- [ ] 3.4 Verify sticky headers, auto-collapse, overflow show/hide, no layout width consumption; other routes/surfaces untouched (`non-target … unchanged`)

## 4. Sidebar horizontal baseline（开发任务 3）

Covers: visual horizontal symmetry supporting `Target surfaces align scrollbars to their right edge` (content inset only; not scrollbar structure)

- [ ] 4.1 Task 3A analysis only: measure region / left inset / right inset / trailing slot; no patch
- [ ] 4.2 After human confirm, Task 3B minimal padding/trailing-slot edits only
- [ ] 4.3 Do not restore or change removed active `font-medium`; do not change scrollbar structure

## 5. Home full-bleed layout（开发任务 4A）

Covers: `Target surfaces align scrollbars to their right edge`; `Non-target scroll surfaces remain unchanged`

- [ ] 5.1 Provide Home-only full-bleed body for `/` via MainLayout whitelist (`align … right edge`)
- [ ] 5.2 Keep landing visual inset inside Home; no negative margin / calc / portal
- [ ] 5.3 Do not modify `src/pages/Chat/index.tsx`, `HomeMainConversation`, or `OverlayScrollbar`
- [ ] 5.4 Verify landing does not drift; other routes unchanged (`non-target … unchanged`)

## 6. Home non-split Overlay（开发任务 4B）

Covers: `Chat retains existing follow and user-scroll behavior`; `Overlay scrollbar reflects viewport geometry`; `Overlay scrollbar appears during scrolling and hides when idle`; `Target surfaces align scrollbars to their right edge`

- [ ] 6.1 Wire `OverlayScrollbar` to existing `scrollRef` / `contentRef` in `HomeMainConversation` (`reflects viewport geometry`; `follow and user-scroll`)
- [ ] 6.2 Preserve `useStickToBottomInstant`, `useChatScrollFollow`, Jump to latest, search, user-away semantics (`follow and user-scroll`)
- [ ] 6.3 Accept non-split only; run targeted tests + typecheck (`appears during scrolling…`)

## 7. Home split Overlay（开发任务 5）

Covers: `Chat retains existing follow and user-scroll behavior`; `Target surfaces align scrollbars to their right edge`

- [ ] 7.1 If task 4B structure already covers split, verify with zero or minimal diff (no duplicated Overlay logic)
- [ ] 7.2 Verify preview toggle, 30%/70% resize, scrollTop retention, resize-handle hit target
- [ ] 7.3 Do not touch Embed Chat

## 8. Embed Chat Overlay（开发任务 6）

Covers: `Chat retains existing follow and user-scroll behavior`; `Overlay scrollbar does not consume layout width`; `Non-target scroll surfaces remain unchanged` (webview document scrollbar out of scope)

- [ ] 8.1 Wire Overlay to Embed Chat existing `scrollRef` / `contentRef` only (`follow and user-scroll`)
- [ ] 8.2 Do not modify webview/iframe document scrollbar (`non-target … unchanged` for page content)
- [ ] 8.3 Verify independent scroll on both sides and cleanup on unmount

## 9. Cleanup（开发任务 7）

Covers: `Non-target scroll surfaces remain unchanged`

- [ ] 9.1 Run doc-specified `rg` searches; remove only confirmed-dead transitional code
- [ ] 9.2 Keep `useNativeScrollbarActivity` + tests if old Chat page still consumes; do not rewrite old page to delete Hook
- [ ] 9.3 Do not delete global scrollbar CSS (`non-target … unchanged`)

## 10. Final acceptance（开发任务 8）

Covers: all nine Requirements in `specs/overlay-scrollbar-surfaces/spec.md`

- [ ] 10.1 Review-only: report §8 matrix coverage; mark unverified platforms explicitly
- [ ] 10.2 Propose README/rules patches only on confirmed direct conflicts (describe first; no drive-by)
- [ ] 10.3 Do not run auto-fix-all-repo lint unless user requests
