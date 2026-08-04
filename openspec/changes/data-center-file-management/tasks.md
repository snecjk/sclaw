## 1. OpenSpec And Scope

- [ ] 1.1 Review this OpenSpec change with product/backend and confirm phase-one scope, especially disabled handling for `网点共享产物`, `本地文件`, and `数据源` (Requirement: Data Center provides phase-one file management spaces)
- [ ] 1.2 Confirm whether the existing customer-relations iframe remains accessible, moves under a future entry, or is removed from `/data-center` phase 1 (Requirement: Data Center provides phase-one file management spaces)
- [ ] 1.3 Confirm artifact preview metadata availability for `sessionId`, `messageId`, `runId`, `workflowTemplateId`, `workflowRunId`, and stable `artifactKey` (Requirement: Artifact preview saves generated artifacts into Data Center)

## 2. Types And API Layer

- [ ] 2.1 Add `src/types/data-center.ts` for quota, entry, breadcrumb, trace, upload, temporary URL, and API error types (Requirement: Data Center provides phase-one file management spaces)
- [ ] 2.2 Add `src/lib/data-center-api.ts` JSON methods using `hostApiFetch('/ai-memory/agent/v1/data-center/...')` and response unwrap with `traceId` preservation (Requirement: Renderer data-center access follows the Main-owned backend boundary)
- [ ] 2.3 Implement error normalization that branches on `errCode` for documented data-center errors (Requirement: Data Center supports entry mutations)
- [ ] 2.4 Add unit tests for JSON API path mapping, query serialization, response unwrap, and business error handling (Requirement: Renderer data-center access follows the Main-owned backend boundary)

## 3. Main Upload Route

- [ ] 3.1 Add a narrow `electron/api/routes/data-center.ts` route for `/api/data-center/files/upload` and `/api/data-center/artifacts/upload` (Requirement: Renderer data-center access follows the Main-owned backend boundary)
- [ ] 3.2 Validate local file existence, file type, non-empty size, and 200 MiB maximum before upload (Requirement: Data Center supports entry mutations)
- [ ] 3.3 Stream multipart data to memory-center `/files/upload` for `drive` uploads with `parentEntryId` and `idempotencyKey` (Requirement: Data Center supports entry mutations)
- [ ] 3.4 Stream multipart data to memory-center `/artifacts/upload` for saved artifacts with provenance fields (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 3.5 Ensure route logs do not include `stoToken`, signed URLs, or raw multipart/file contents (Requirement: Renderer data-center access follows the Main-owned backend boundary)
- [ ] 3.6 Add unit tests for upload validation, metadata forwarding, idempotency key reuse expectations, and sanitized error responses (Requirement: Renderer data-center access follows the Main-owned backend boundary)

## 4. Data Center State

- [ ] 4.1 Add `src/stores/data-center.ts` for current section, space, folder, breadcrumbs, entries, quota, search, sort, view mode, and loading/mutating states (Requirement: Data Center supports folder navigation and discovery)
- [ ] 4.2 Implement store actions for load, refresh, enter folder, search, sort, create folder, rename, delete, preview URL, download URL, and trace (Requirement: Data Center supports entry mutations)
- [ ] 4.3 Keep temporary preview/download URLs out of persisted state (Requirement: Data Center supports entry mutations)
- [ ] 4.4 Add unit tests for section switching, folder navigation, search behavior, mutation refresh, and temporary URL handling (Requirement: Data Center supports folder navigation and discovery)

## 5. Data Center UI

- [ ] 5.1 Replace `src/pages/DataCenter/index.tsx` with the native Data Center shell, preserving site-user route guard behavior (Requirement: Data Center provides phase-one file management spaces)
- [ ] 5.2 Add section navigation for `问答产物`, `我的文件`, and disabled/future `数据源` states (Requirement: Data Center provides phase-one file management spaces)
- [ ] 5.3 Add secondary tabs for `我的产物 / 网点共享产物` and `线上文件 / 本地文件`, with unsupported tabs disabled or future-state (Requirement: Data Center provides phase-one file management spaces)
- [ ] 5.4 Add toolbar controls for search, workflow filter placeholder, list/grid toggle, create folder, and upload actions (Requirement: Data Center supports folder navigation and discovery)
- [ ] 5.5 Add list and grid renderers with file/folder icons, file size, updated time, trace status, and action menus (Requirement: Data Center supports folder navigation and discovery)
- [ ] 5.6 Add create-folder, rename, delete-confirm, upload, preview, and trace dialogs (Requirement: Data Center supports entry mutations)
- [ ] 5.7 Implement preview fallback for `PREVIEW_UNSUPPORTED` and download fallback copy (Requirement: Data Center supports entry mutations)
- [ ] 5.8 Add empty, loading, quota exceeded, auth expired, service disabled, and generic error states (Requirement: Data Center supports entry mutations)
- [ ] 5.9 Verify all Data Center UI states in light and dark mode and check for hardcoded light-only colors (Requirement: Data Center UI remains theme-compatible)

## 6. Artifact Preview Save Flow

- [ ] 6.1 Locate the existing artifact preview toolbar and add the `保存产物` icon action with tooltip copy (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 6.2 Add a `保存产物` modal that displays the artifact filename, loads `qa_artifact` folders, supports new folder creation, and lets the user choose a target folder (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 6.3 Wire chat artifacts to `/artifacts/upload` with `sourceType=chat_artifact` and available conversation provenance fields (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 6.4 Wire workflow artifacts to `/artifacts/upload` with `sourceType=workflow_artifact` and available workflow provenance fields (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 6.5 Treat `traceStatus=pending` as save success and show "来源校验中" feedback (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 6.6 Add a success toast with an optional "查看产物" action that opens Data Center `问答产物` (Requirement: Artifact preview saves generated artifacts into Data Center)
- [ ] 6.7 Add unit/integration tests for opening the modal, selecting a folder, saving metadata, pending trace success, and save failure handling (Requirement: Artifact preview saves generated artifacts into Data Center)

## 7. Trace Navigation

- [ ] 7.1 Show `追溯对话` only for `qa_artifact` entries with `traceAvailable=true` (Requirement: Question-answer artifacts support trace back to their source)
- [ ] 7.2 Call `/entries/{entryId}/trace` on trace action and normalize unavailable trace responses (Requirement: Question-answer artifacts support trace back to their source)
- [ ] 7.3 Navigate to the matching chat session or workflow run using returned `sessionId`, `messageId`, `runId`, `workflowTemplateId`, or `workflowRunId` (Requirement: Question-answer artifacts support trace back to their source)
- [ ] 7.4 Add tests for trace action visibility and navigation payload handling (Requirement: Question-answer artifacts support trace back to their source)

## 8. Localization And Documentation

- [ ] 8.1 Add zh/en/ja i18n strings for Data Center sections, toolbar actions, dialogs, errors, trace states, and disabled future states (Requirement: Data Center UI remains theme-compatible)
- [ ] 8.2 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates after implementation (Requirement: Data Center provides phase-one file management spaces)
- [ ] 8.3 Document unsupported phase-one design areas and backend dependencies in the PR description (Requirement: Data Center provides phase-one file management spaces)

## 9. Validation

- [ ] 9.1 Run targeted unit tests for data-center API, store, upload route, UI components, and artifact preview save flow (Requirement: Renderer data-center access follows the Main-owned backend boundary)
- [ ] 9.2 Run `pnpm run lint` and fix issues (Requirement: Data Center UI remains theme-compatible)
- [ ] 9.3 Run `pnpm run typecheck` and fix issues (Requirement: Renderer data-center access follows the Main-owned backend boundary)
- [ ] 9.4 Run `pnpm test` or a documented targeted subset if unrelated existing failures block the full suite (Requirement: Data Center provides phase-one file management spaces)
- [ ] 9.5 Manually verify preview, download, upload, save artifact, trace, disabled future tabs, and dark mode against the design draft (Requirement: Data Center UI remains theme-compatible)
