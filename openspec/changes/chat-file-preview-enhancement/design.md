## Context

The Chat page displays a right-hand preview panel (`ChatPreviewPanel`) for files attached to messages (HTML, PDF, Markdown, etc.). The panel renders files via `FilePreviewViewer` using iframes for HTML/PDF and srcdoc for Markdown. The panel is currently fixed at 40vw width and lacks fullscreen or reliable file-switching behavior.

## Goals / Non-Goals

**Goals:**
- Ensure iframe content reliably reloads when the user switches between previewable files
- Allow users to enter fullscreen presentation mode for any previewed file
- Allow users to drag-resize the preview panel width between 320px and 900px
- Keep resize interactions at 60fps without React re-render lag

**Non-Goals:**
- Touch/gesture support for resizing (mouse only for now)
- Persisting panel width across app restarts (out of scope)
- Resizing the chat area independently (chat area uses flex-1, adapting automatically)

## Decisions

### 1. Use `key={filePath}` on iframes to force remount
- **Decision**: Add `key={filePath}` to every iframe element inside `FilePreviewViewer`.
- **Rationale**: Without a stable key, React's reconciler may reuse the iframe DOM node and only update the `src` attribute. Browsers do not always fully reload iframe content when `src` changes programmatically. A key change guarantees a fresh iframe mount.
- **Alternative considered**: Programmatically call `iframe.contentWindow.location.reload()` on file switch. Rejected because it is fragile (cross-origin restrictions, timing issues) and less idiomatic in React.

### 2. Use Fullscreen API on the preview container
- **Decision**: Trigger `requestFullscreen()` on the `FilePreviewViewer` container `<div>`, not on the iframe itself.
- **Rationale**: The container wraps the iframe plus a floating fullscreen toggle button. Entering the container into fullscreen preserves the button's accessibility while giving the iframe 100% viewport space. Entering the iframe itself directly would hide the toggle button.
- **Alternative considered**: Open the file in a new BrowserWindow via Electron. Rejected because it breaks the in-app flow and requires additional IPC complexity.

### 3. Direct DOM manipulation + RAF during resize drag
- **Decision**: During drag, update `previewPanelRef.current.style.width` directly; sync back to React state only on `mouseup`.
- **Rationale**: Calling `setState` inside a high-frequency `mousemove` handler causes React to re-render the entire Chat page on every pixel of movement, leading to visible jank. Direct DOM writes bypass React's render cycle entirely.
- **Alternative considered**: `useTransition` or `useDeferredValue` to defer React updates. Rejected because even deferred updates add overhead that is unnecessary for a pure layout change.

### 4. Full-screen transparent overlay to capture mouse events
- **Decision**: On `mousedown`, append a fixed-position transparent overlay (`z-index: 9999`) to `document.body` and listen for `mousemove`/`mouseup` on the overlay.
- **Rationale**: A narrow 3px resizer is easy to overshoot when the mouse moves quickly. The overlay covers the entire viewport, guaranteeing that all mouse events are captured regardless of cursor position or underlying element hierarchy.
- **Alternative considered**: `setPointerCapture` on the resizer element. Rejected because Pointer Events support in Electron's Chromium version is reliable, but the overlay approach is simpler and works identically across all event models.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Fullscreen API not supported or blocked by user preferences | Graceful fallback: button silently does nothing if `requestFullscreen` throws |
| Overlay left in DOM if component unmounts mid-drag | `cleanup()` removes overlay and cancels RAF; exposed via `useEffect` cleanup in `startResize` return |
| Very fast mouse movement causes width to jump past constraints | Clamp width with `Math.max(320, Math.min(900, ...))` on every move event |
