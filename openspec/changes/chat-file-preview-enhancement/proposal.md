## Why

The Chat page's file preview panel has UX issues that affect daily usage:

1. **Iframe does not reload when switching files**: When multiple HTML/PDF files are attached to a chat session, switching between them in the preview panel leaves the previous file's content visible because React reuses the iframe DOM node.
2. **No fullscreen/presentation mode**: Users cannot view generated HTML reports (e.g., PPT-style pages) in fullscreen, which is essential for presentation and review scenarios.
3. **Resize / three-column chrome**: Preview width must stay a persisted percentage (30%–70%, default 50%) on the unified Grid; the old 4px resizer column and short grey divider must be removed in favor of a 0px logical boundary with an overlay transparent hit target **and a `#FFD6BA` / 2px hint edge aligned to the preview left stroke** (hidden by default; visible on hover / dragging / focus-visible). Session tools (search / refresh / thinking) must sit on the chat header column when split (flush to the column's right edge); the preview toggle stays on the preview column. Dark-mode compatibility is required for header icons and the hit shell (no light-only residual fills).

## What Changes

- Force iframe remount on file switch by adding stable `key` props
- Add fullscreen toggle to the preview panel toolbar and a floating overlay button inside the iframe container
- Align resize with `previewSplitPercent` + unified Grid `--sto-split-preview-col`
- Introduce `panelActions` ContentHeader slot; split Chat/Home header actions
- Replace layout-width resizer + grey line with shared `SplitPanelResizeHandle` (transparent hit + `#FFD6BA` hint edge)
- Chat and Home share the same handle / hook behavior (Pointer Events + cleanup)

## Capabilities

### New Capabilities
- `chat-file-preview-fullscreen`: Fullscreen presentation mode for file previews
- `chat-file-preview-resize`: Draggable width adjustment between chat and preview panels

### Modified Capabilities
- `chat-file-preview`: Fix iframe reload behavior on file switch

## Impact

- `src/components/file-preview/FilePreviewViewer.tsx`: iframe key fix + fullscreen button
- `src/pages/Chat/ChatPreviewPanel.tsx`: toolbar fullscreen button
- `src/components/layout/content-header-context.tsx` / `ContentHeader.tsx`: `panelActions` slot
- `src/pages/Chat/ChatSearchBar.tsx`: split conversation vs panel action components
- `src/pages/Chat/index.tsx` / `src/pages/Home/HomeMainConversation.tsx`: shared handle wiring
- `src/lib/surfaces.ts` / `src/hooks/use-split-panel-resize.ts`: 0px Grid + Pointer Events
- `src/components/layout/split-panel-resize-handle.tsx`: shared separator (transparent hit + orange edge)
