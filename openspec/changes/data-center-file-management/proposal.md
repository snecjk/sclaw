## Why

The current `/data-center` page only exposes an online customer-relations iframe card. It does not provide the native data-center experience shown in the design draft: browsing question-answer artifacts, managing uploaded files, saving generated artifacts from preview, previewing/downloading cloud files, or tracing saved artifacts back to the originating conversation.

The memory-center backend now exposes SClaw data-center v1 APIs under `/agent/v1/data-center`, covering personal online file management for `drive` and `qa_artifact` spaces. SClaw needs a first-party implementation that connects the artifact preview "save artifact" entry point with the Data Center "问答产物" result surface.

## What Changes

- Replace the current card-only Data Center body with a native file-management surface aligned with the design draft
- Add `问答产物` backed by `spaceType=qa_artifact`
- Add `我的文件 > 线上文件` backed by `spaceType=drive`
- Add browsing, breadcrumbs, search, list/grid views, create folder, rename, delete, preview, download, quota display, and error states
- Add the artifact-preview toolbar action "保存产物", opening a target-folder picker and saving through `/artifacts/upload`
- Add Main-process upload support for local file streams and artifact provenance metadata
- Keep design-only capabilities without backend support, such as `网点共享产物`, `本地文件授权`, and `数据源`, disabled or out of scope for phase 1

## Capabilities

### New Capabilities
- `data-center-file-management`: Native Data Center file management for personal cloud files and saved QA artifacts

### Modified Capabilities
- `chat-file-preview`: Artifact preview toolbar gains a "保存产物" action that persists generated artifacts into Data Center
- `workflow-execution-completion`: Workflow-generated artifacts can be saved with workflow provenance when available

## Impact

- `src/pages/DataCenter/`: Replace the current iframe-card page with a native file management page
- `src/lib/data-center-api.ts`: New renderer API client for JSON data-center endpoints through host-api
- `src/types/data-center.ts`: New shared renderer types for quota, entries, breadcrumbs, trace, and errors
- `src/stores/data-center.ts`: New Zustand store for Data Center navigation and actions
- `src/components/file-preview/`: Add the save-artifact toolbar entry and modal integration
- `electron/api/`: Add a narrow upload route for local file stream multipart forwarding to memory-center
- `src/i18n/locales/*/common.json`: Add Data Center copy for actions, states, and errors
- Tests under `tests/unit/` for API mapping, store behavior, upload route behavior, and preview-save integration
- UI work MUST align with `docs/sto-design.md` and include dark-mode compatibility
