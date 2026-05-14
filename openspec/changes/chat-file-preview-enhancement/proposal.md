## Why

The Chat page's file preview panel has three UX issues that affect daily usage:

1. **Iframe does not reload when switching files**: When multiple HTML/PDF files are attached to a chat session, switching between them in the preview panel leaves the previous file's content visible because React reuses the iframe DOM node.
2. **No fullscreen/presentation mode**: Users cannot view generated HTML reports (e.g., PPT-style pages) in fullscreen, which is essential for presentation and review scenarios.
3. **Fixed panel width**: The preview panel is locked at 40vw (480px). Users with large monitors cannot expand it for better readability, nor shrink it to focus on the chat conversation.

## What Changes

- Force iframe remount on file switch by adding stable `key` props
- Add fullscreen toggle to the preview panel toolbar and a floating overlay button inside the iframe container
- Implement a draggable resizer between the chat area and the preview panel with smooth, lag-free resizing

## Capabilities

### New Capabilities
- `chat-file-preview-fullscreen`: Fullscreen presentation mode for file previews
- `chat-file-preview-resize`: Draggable width adjustment between chat and preview panels

### Modified Capabilities
- `chat-file-preview`: Fix iframe reload behavior on file switch

## Impact

- `src/components/file-preview/FilePreviewViewer.tsx`: iframe key fix + fullscreen button
- `src/pages/Chat/ChatPreviewPanel.tsx`: toolbar fullscreen button
- `src/pages/Chat/index.tsx`: draggable resizer overlay + DOM-direct width manipulation
