## Context

The Chat page displays a right-hand preview panel (`ChatPreviewPanel`) for files attached to messages (HTML, PDF, Markdown, etc.). Chat and Home share a unified CSS Grid on `<main>` with `previewSplitPercent` (30%–70%, default 50%).

**Supersession (2026-07-31 Stage 0):** Workspace Frame, zero structural seam, Body-only handle, `PreviewMode.expanded`, and final Header naming (`chatActions + previewActions + layoutMode`) are owned by `openspec/changes/workspace-shell-architecture-upgrade`. This Change keeps iframe remount and must not expand DOM Fullscreen or reintroduce 10px/`row-span-2`/`panelActions` directions.

## Goals / Non-Goals

**Goals:**
- Ensure iframe content reliably reloads when the user switches between previewable files
- Keep percent-based resize persistence (`previewSplitPercent`) and shared Pointer/RAF hook until the shell Change fully owns geometry
- Cooperate with shell Change for Header action placement (final names: `chatActions` + `previewActions`)

**Non-Goals:**
- DOM Fullscreen / `requestFullscreen` as product expand path (**deleted direction**)
- Re-specifying 10px bilateral structural seams or Handle `row-span-2` + `translate-x(10px)` (**deleted direction**)
- Introducing `panelActions` as a third living Header semantic (**deleted direction**)
- Touch/gesture resize; changing 30–70 persist schema; reworking scan/open/share/download/transport
- Rewriting OverlayScrollbar

## Decisions

### 1. Use `key={filePath}` on iframes to force remount
- **Decision**: Add `key={filePath}` to every iframe element inside `FilePreviewViewer`.
- **Rationale**: Guarantees fresh iframe mount on file switch.
- **Alternative considered**: `iframe.contentWindow.location.reload()` — rejected (fragile / cross-origin).

### 2. Preview expand is Workspace PreviewMode (NOT DOM Fullscreen)
- **Decision**: Product expand/restore is `PreviewMode.expanded` / restore-to-split under `workspace-layout-modes`. Existing `requestFullscreen` code is deprecated and MUST be removed in shell Stage 3; this Change MUST NOT add further Fullscreen UI.
- **Rationale**: Preserves Conversation mount, shell Frame, and Overlay host; matches T2 master outline.
- **Alternative considered**: Keep Fullscreen API on preview container — **rejected / deleted**.

### 3. Percent Grid column + RAF during resize drag (retained)
- **Decision**: Width owned by `--sto-split-preview-col`; RAF during drag; commit on pointer up.
- **Rationale**: Shared boundary for Header/Body without per-frame React rerenders.
- **Alternative considered**: Fixed px `style.width` — rejected.

### 4. Final seam/Handle geometry owned by shell Change
- **Decision**: Zero structural seam; Body-only Preview-side overlay handle; no `row-span-2`; no `translate-x(10px)` compensation. Any interim 10px inset in current code is **migration debt**, not the target.
- **Rationale**: Chat OverlayScrollbar rail must coincide with Preview left border.
- **Alternative considered**: Keep 10px×2 visual gutter as structural inset — **rejected**.

### 5. Final Header slots: chatActions + previewActions (+ layoutMode)
- **Decision**: Do not add `panelActions`. Migrate preview-column actions to `previewActions` under the shell Change; retire living `actions` dual-use after migration adapter expiry.
- **Rationale**: T2 forbids three parallel semantics (`actions` / `panelActions` / `previewActions`).
- **Alternative considered**: Add `panelActions` now — **rejected**.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Parallel edits fight shell Change | Layout/Header/seam tasks deferred; iframe keys remain local |
| Legacy Fullscreen code confuses QA | Spec withdraws Fullscreen requirement; Stage 3 deletes API path |
| Overlay left mid-drag | Existing Pointer cleanup in `useSplitPanelResize` |
| Dark mode residual fills | Transparent hit shell; local `#FFD6BA` hint only when shell keeps it |
