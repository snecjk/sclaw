## 1. Fix iframe reload on file switch

- [ ] 1.1 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (HTTP URL branch)
- [ ] 1.2 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (PDF branch)
- [ ] 1.3 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (HTML branch)
- [ ] 1.4 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (Markdown branch)

## 2. Add fullscreen presentation mode

- [ ] 2.1 Add fullscreen state (`isFullscreen`) and `toggleFullscreen` handler to `FilePreviewViewer.tsx`
- [ ] 2.2 Add `fullscreenchange` event listener to sync fullscreen state in `FilePreviewViewer.tsx`
- [ ] 2.3 Add floating fullscreen toggle button (bottom-right corner) inside `FilePreviewViewer.tsx`
- [ ] 2.4 Import `MonitorPlay` icon in `ChatPreviewPanel.tsx`
- [ ] 2.5 Add fullscreen button to `ChatPreviewPanel.tsx` toolbar ("产物" tab)
- [ ] 2.6 Add `data-preview-viewer` attribute to preview content container in `ChatPreviewPanel.tsx`

## 3. Implement draggable preview panel width
<!-- Requirement: Preview panel width is draggable ; Requirement: Resize drag remains smooth at high cursor speeds -->

- [x] 3.1 Persist preview width as `previewSplitPercent` (30–70, default 50) — already in settings store; do not change schema
- [x] 3.2 Drive width via unified Grid `--sto-split-preview-col` on `<main>`
- [ ] 3.3 **[本次修正]** Change Grid middle track to `0px`; remove dual `gap-x` around a layout-width resizer column
- [x] 3.4 **[本次新增/修正]** Add shared `SplitPanelResizeHandle` (transparent overlay hit + `#FFD6BA`/2px hint edge aligned to preview stroke; hover/dragging/focus-visible; `role="separator"`, `no-drag`)
- [ ] 3.5 **[本次修正]** Convert `use-split-panel-resize` to Pointer Events + unmount/`pointercancel` cleanup; keep RAF + percent commit on pointer up
- [x] 3.6 **[本次修正]** Wire Chat and Home to the shared handle + `isResizing`; delete short grey divider JSX
- [ ] 3.7 **[本次新增]** Apply MCP panel visual inset as half-side padding on panes only (not as resizer width)
- [x] 3.8 **[本次修正]** Shared `--sto-split-preview-inset-*`; verify 30/50/70 alignment; default-hidden hint edge
- [x] 3.9 **[本次修正]** Chat header zone fills first Grid column so session tools sit at the trailing edge

## 4. ContentHeader session vs panel actions
<!-- Requirement: Preview panel width is draggable (tool placement coupling) -->

- [ ] 4.1 **[本次新增]** Add `panelActions` to `ContentHeaderSlot` + equality / display plumbing
- [ ] 4.2 **[本次新增]** `ContentHeader` split layout: chat column ends with `actions`; preview column has `previewTabs` + `panelActions`
- [ ] 4.3 **[本次新增]** Split `ChatContentHeaderActions` into conversation actions + preview panel actions; wire Chat and Home
- [ ] 4.4 Verify workflow editor / TaskDetail non-split consumers still work; dual-column order matches MCP

## 5. Testing & Validation

- [ ] 5.1 Verify iframe reloads correctly when switching between two HTML files
- [ ] 5.2 Verify iframe reloads correctly when switching between HTML and PDF
- [ ] 5.3 Verify fullscreen enters and exits correctly from both toolbar button and floating button
- [ ] 5.4 Verify fullscreen icon updates between Maximize and Minimize states
- [ ] 5.5 **[本次修正]** Verify smooth Pointer resize, 30/70 clamp, overlay cleanup on unmount/route change
- [ ] 5.6 **[本次新增]** Unit tests for clamp / handle semantics / header action placement (`split-panel*`)
- [ ] 5.7 Run directed ESLint + `pnpm run typecheck` on touched files
- [ ] 5.8 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates
- [ ] 5.9 Dark-mode check: transparent hit shell, `#FFD6BA` hint on hover/drag only, no grey capsule
