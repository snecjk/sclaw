## 1. Fix iframe reload on file switch

- [ ] 1.1 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (HTTP URL branch)
- [ ] 1.2 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (PDF branch)
- [ ] 1.3 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (HTML branch)
- [ ] 1.4 Add `key={filePath}` to iframe in `FilePreviewViewer.tsx` (Markdown branch)

## 2. DOM Fullscreen presentation — WITHDRAWN
<!-- Superseded by workspace-shell-architecture-upgrade / PreviewMode.expanded -->

- [x] 2.0 Document withdrawal: do not implement/extend `requestFullscreen` as product expand
- [ ] 2.1 Shell Stage 3 removes Fullscreen API paths from `FilePreviewViewer.tsx` / `ChatPreviewPanel.tsx` (tracked in workspace Change tasks 3.1)

## 3. Preview width persistence / shared hook
<!-- Final seam/Handle/Header owned by workspace-layout-modes -->

- [x] 3.1 Persist preview width as `previewSplitPercent` (30–70, default 50)
- [x] 3.2 Drive width via unified Grid `--sto-split-preview-col` on `<main>`
- [ ] 3.3 **SUPERSEDED** Zero structural seam + delete 10px bilateral insets → workspace Change Stage 3
- [x] 3.4 Shared `SplitPanelResizeHandle` exists (interim geometry); Stage 3 rewrites to Body-only / no `row-span-2` / no `translate-x(10px)`
- [ ] 3.5 Confirm Pointer Events + cleanup on `use-split-panel-resize` (keep; shell may adjust)
- [x] 3.6 Chat and Home wire shared handle + `isResizing`
- [ ] 3.7 **SUPERSEDED** Do not apply MCP 10px half-side structural inset as target design
- [ ] 3.8 **SUPERSEDED** Final inset tokens / hint geometry → workspace Change
- [x] 3.9 Chat header zone fills first Grid column (interim); final `previewActions` rename → workspace Change

## 4. ContentHeader actions — SUPERSEDED naming
<!-- Final: chatActions + previewActions + layoutMode; NO panelActions -->

- [x] 4.0 Do **not** add `panelActions`
- [ ] 4.1 Migrate preview-column slot to `previewActions` under workspace Stage 3
- [ ] 4.2 Replace `isSplitLayout` / living `actions` dual-use with `layoutMode` under workspace Stage 3
- [ ] 4.3 Verify non-split consumers after shell migration

## 5. Testing & Validation

- [ ] 5.1 Verify iframe reloads between two HTML files
- [ ] 5.2 Verify iframe reloads between HTML and PDF
- [ ] 5.3 **REMOVED** Fullscreen enter/exit checks as acceptance for this Change
- [ ] 5.4 Verify Pointer resize 30/70 clamp + cleanup (interim)
- [ ] 5.5 Directed ESLint + typecheck on files this Change still owns
- [ ] 5.6 Dark-mode check on preview chrome touched here
- [ ] 5.7 README review only if user-visible preview behavior (non-shell) changes
