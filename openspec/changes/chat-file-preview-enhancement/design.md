## Context

The Chat page displays a right-hand preview panel (`ChatPreviewPanel`) for files attached to messages (HTML, PDF, Markdown, etc.). The panel renders files via `FilePreviewViewer` using iframes for HTML/PDF and srcdoc for Markdown. Chat and Home conversation surfaces share a unified CSS Grid on `<main>` with `previewSplitPercent` (30%–70%, default 50%).

## Goals / Non-Goals

**Goals:**
- Ensure iframe content reliably reloads when the user switches between previewable files
- Allow users to enter fullscreen presentation mode for any previewed file
- Allow users to drag-resize the preview panel as a **percentage of the unified Grid** (30%–70%, default 50%), persisted via `previewSplitPercent`
- Keep resize interactions at 60fps without React re-render lag
- Place session tools (search / refresh / thinking) on the chat header column when split; keep the preview toggle on the preview column
- Use a **0px logical boundary** plus an overlay transparent **hit target** and a **hint edge** (`#FFD6BA` / 2px) aligned to the preview pane left stroke (shared `--sto-split-preview-inset-*`); edge is hidden by default and shown on hover / dragging / focus-visible (no layout-width resizer column, no short grey divider)

**Non-Goals:**
- Touch/gesture support for resizing
- Changing `previewSplitPercent` persist schema or 30–70 semantics
- Resizing via a second independent px/left/right React state
- Reworking preview scan, file open, share, download, or message transport

## Decisions

### 1. Use `key={filePath}` on iframes to force remount
- **Decision**: Add `key={filePath}` to every iframe element inside `FilePreviewViewer`.
- **Rationale**: Without a stable key, React's reconciler may reuse the iframe DOM node and only update the `src` attribute. Browsers do not always fully reload iframe content when `src` changes programmatically. A key change guarantees a fresh iframe mount.
- **Alternative considered**: Programmatically call `iframe.contentWindow.location.reload()` on file switch. Rejected because it is fragile (cross-origin restrictions, timing issues) and less idiomatic in React.

### 2. Use Fullscreen API on the preview container
- **Decision**: Trigger `requestFullscreen()` on the `FilePreviewViewer` container `<div>`, not on the iframe itself.
- **Rationale**: The container wraps the iframe plus a floating fullscreen toggle button. Entering the container into fullscreen preserves the button's accessibility while giving the iframe 100% viewport space. Entering the iframe itself directly would hide the toggle button.
- **Alternative considered**: Open the file in a new BrowserWindow via Electron. Rejected because it breaks the in-app flow and requires additional IPC complexity.

### 3. Percent Grid column + RAF during resize drag
- **Decision**: Width is owned by `--sto-split-preview-col` on the unified `<main>` Grid. During drag, update the CSS variable via `requestAnimationFrame`; commit clamped percent to `setPreviewSplitPercent` on pointer up.
- **Rationale**: Avoids per-pixel React re-renders of Chat/Home trees while keeping Header and Body on the same boundary.
- **Alternative considered**: Fixed 320–900px panel width with `style.width`. Rejected — superseded by `previewSplitPercent` and shared Grid.

### 4. Zero-width logical column + overlay hit target + aligned hint edge
- **Decision**: Grid template is `minmax(0,1fr) | 0px | var(--sto-split-preview-col,50%)` with **no** layout-width resizer column and **no** short grey divider. Shared CSS variables `--sto-split-preview-inset-x` (10px) and `--sto-split-preview-inset-y` (8px) drive Header/Body preview padding and the resize handle offset so the hit shell and visual edge share one geometry anchor on the preview card left stroke. A shared handle (`role="separator"`) spans header+body rows, uses ~12px transparent hit width that does not consume track width, `cursor: col-resize`, and Electron `no-drag`. Inside the handle, a `pointer-events-none` edge (`#FFD6BA`, 2px) is **opacity-0 by default** and becomes visible on handle hover, `data-resizing=true` (from `useSplitPanelResize.isResizing`), and focus-visible. Vertical extent matches preview body inset (not full Main height). Chat and Home both pass `isResizing` so the edge stays visible under the fullscreen drag overlay.
- **Rationale**: Product requires the hint on the preview stroke, not the 0px track center; dragging under overlay cannot rely on CSS `:hover` alone; color is a local split hint, not global primary.
- **Alternative considered**: Always-visible `bg-primary` 1px at logical center; or move only the edge without the hit target. Rejected — misalignment and wrong default visibility.

### 5. Split ContentHeader actions into session vs panel slots
- **Decision**: `ContentHeaderSlot` exposes `actions` (search/refresh/thinking) and `panelActions` (preview toggle). In split layout, `actions` render at the end of the chat header column; `previewTabs` + `panelActions` render in the preview header column.
- **Rationale**: A single Fragment placed in the preview column pushed session tools to the far right.
- **Alternative considered**: CSS translate / negative margin to move icons. Rejected by product rules.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Fullscreen API not supported or blocked by user preferences | Graceful fallback: button silently does nothing if `requestFullscreen` throws |
| Overlay left in DOM if component unmounts mid-drag | Centralized cleanup removes overlay, cancels RAF, restores `userSelect`/cursor; hook effect cleanup ends drag |
| Fast pointer movement jumps past constraints | Clamp with `clampPreviewPanelPercent` / 30–70 on every move |
| Double CSS `gap` around a middle column eats width | Remove dual `gap-x` around resizer; apply MCP panel visual inset as half-side padding on panes only |
| Dark mode residual fills on handle | Hit shell stays transparent; hint edge uses local `#FFD6BA` (not global primary); no grey capsule |
