## Why

The Chat page's file preview panel has UX issues that affect daily usage:

1. **Iframe does not reload when switching files**: When multiple HTML/PDF files are attached to a chat session, switching between them in the preview panel leaves the previous file's content visible because React reuses the iframe DOM node.
2. **Preview expand belongs to Workspace shell architecture**: Presentation/expand MUST use in-workspace `PreviewMode.expanded` from `workspace-shell-architecture-upgrade`, **not** the DOM Fullscreen API.
3. **Resize / three-column chrome ownership moved**: Zero structural seam, Body-only handle, and final Header slot naming (`chatActions + previewActions + layoutMode`) are owned by `workspace-shell-architecture-upgrade`. This Change MUST NOT reintroduce 10px bilateral seams, `row-span-2` + `translate-x(10px)` handles, or a third `panelActions` semantic.

## What Changes

- Force iframe remount on file switch by adding stable `key` props (still owned here).
- **REMOVED direction**: DOM Fullscreen toggle / `requestFullscreen` / `fullscreenchange` as the product expand path — superseded by Workspace `PreviewMode.expanded`.
- **DEFERRED / SUPERSEDED**: split seam removal, Handle geometry, Header slot rename — tracked in `openspec/changes/workspace-shell-architecture-upgrade` (`workspace-layout-modes`).
- Keep shared percent persistence (`previewSplitPercent` 30–70) and Pointer resize hook reuse unless the shell Change replaces them.
- Dark-mode compatibility remains required for any preview chrome this Change still touches.

## Capabilities

### New Capabilities
- ~~`chat-file-preview-fullscreen`~~ **WITHDRAWN** — expand is `workspace-layout-modes` / `PreviewMode.expanded`
- `chat-file-preview-resize` — **narrowed**: persistence + hook reuse only; seam/Handle/Header final geometry owned by shell Change

### Modified Capabilities
- `chat-file-preview`: Fix iframe reload behavior on file switch

## Impact

- `src/components/file-preview/FilePreviewViewer.tsx`: iframe `key` fix; Fullscreen API path to be removed when shell Stage 3 lands (do not expand Fullscreen further)
- `src/pages/Chat/ChatPreviewPanel.tsx`: same Fullscreen deprecation
- Layout/Header/seam files: **owned by** `workspace-shell-architecture-upgrade` — avoid parallel edits here
- Depends on: `openspec/changes/workspace-shell-architecture-upgrade`
