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

- [ ] 3.1 Add `previewPanelWidth` state (default 480px) to `Chat/index.tsx`
- [ ] 3.2 Add `isResizing` state to `Chat/index.tsx`
- [ ] 3.3 Add `previewPanelRef` (useRef) to `Chat/index.tsx` for DOM direct access
- [ ] 3.4 Implement `startResize` handler with full-screen overlay + RAF in `Chat/index.tsx`
- [ ] 3.5 Replace fixed `w-[40vw] min-w-[380px] max-w-[560px]` classes with dynamic `style={{ width: previewPanelWidth }}`
- [ ] 3.6 Render resizer div between chat area and preview panel in `Chat/index.tsx`
- [ ] 3.7 Ensure resizer visual feedback during drag (color transition, cursor change)

## 4. Testing & Validation

- [ ] 4.1 Verify iframe reloads correctly when switching between two HTML files
- [ ] 4.2 Verify iframe reloads correctly when switching between HTML and PDF
- [ ] 4.3 Verify fullscreen enters and exits correctly from both toolbar button and floating button
- [ ] 4.4 Verify fullscreen icon updates between Maximize and Minimize states
- [ ] 4.5 Verify panel resizes smoothly with fast mouse movement
- [ ] 4.6 Verify panel respects 320px minimum and 900px maximum width constraints
- [ ] 4.7 Verify drag works even when cursor moves outside the application window
- [ ] 4.8 Run `pnpm run lint` and fix issues
- [ ] 4.9 Run `pnpm run typecheck` and fix issues
- [ ] 4.10 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates
