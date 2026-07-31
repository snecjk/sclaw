## Context

The design draft at `/Users/zzj/Downloads/数据中心设计稿` shows Data Center as a native file-management area inside SClaw. It includes:

- A Data Center sidebar section with `问答产物`, `我的文件`, and `数据源`
- `问答产物` with `我的产物 / 网点共享产物`, search, workflow filter, list/grid switch, folders, files, preview/download/share/more actions, and trace conversation actions
- `我的文件` with `线上文件 / 本地文件`, online file upload, new folder, preview, rename, delete, and local file authorization UI
- A generated artifact preview toolbar where a top-right icon opens `保存产物`

The backend document `/Users/zzj/Desktop/workspace/sto/ai-memory-center/memory-center/docs/sclaw-data-center-api.md` currently implements only the v1 online file-management API under `/agent/v1/data-center`. Supported spaces are:

- `drive`: personal uploaded files
- `qa_artifact`: saved chat or workflow artifacts

Shared artifacts, local file authorization, and data-source management are not included in the current API contract.

## Goals / Non-Goals

**Goals:**
- Implement phase-1 Data Center using the available memory-center v1 API
- Make "保存产物" from artifact preview the primary source path for `qa_artifact`
- Keep renderer backend access behind `hostApiFetch` and Main-process host routes
- Preserve `stoToken` secrecy by letting Main inject auth for memory-center calls
- Provide list and grid views that match the design direction while using existing SClaw theme tokens
- Provide robust user feedback for quota, unsupported preview, name conflict, empty folder restrictions, and auth failures

**Non-Goals:**
- Implement `网点共享产物` before backend shared-space APIs exist
- Implement local directory authorization or local indexing before backend/local service contracts exist
- Implement `数据源` before a data-source API is defined
- Implement forwarding/sharing to external channels as part of phase 1
- Replace existing customer-relations iframe behavior unless product confirms it should move under another entry

## Decisions

### 1. Use a native React Data Center surface instead of the existing iframe card
- **Decision**: `/data-center` becomes the native file-management shell. The current customer-relations iframe card is removed from the primary Data Center page or moved behind a separate future online-data entry.
- **Rationale**: The design draft and backend API are both centered on native file and artifact management. Keeping the iframe card as the page body would block the new workflows and confuse the `数据中心` navigation semantics.
- **Alternative considered**: Keep the current iframe card as the first tab and add file management as disabled tabs. Rejected because the design and API indicate file management is now the main phase-1 deliverable.

### 2. Model `问答产物` as the result of artifact preview save actions
- **Decision**: Users save generated artifacts from the artifact preview toolbar. That action opens a `保存产物` modal, lets the user choose or create a target folder in `qa_artifact`, and calls `/artifacts/upload`.
- **Rationale**: The user flow in the screenshot makes artifact preview the source of truth. `qa_artifact` should not be treated as a generic manual upload space; it must preserve provenance fields such as `sessionId`, `messageId`, `runId`, `workflowTemplateId`, and `workflowRunId`.
- **Alternative considered**: Add an upload button directly inside `问答产物`. Rejected for phase 1 because it would bypass artifact provenance and make trace behavior unreliable.

### 3. Use the existing `/ai-memory/agent/v1/*` proxy for JSON APIs
- **Decision**: Renderer JSON calls use `hostApiFetch('/ai-memory/agent/v1/data-center/...')`, which maps to memory-center `/agent/v1/data-center/...`.
- **Rationale**: `electron/api/server.ts` explicitly instructs new memory-center `/agent/v1` APIs to reuse `handleAiMemoryAgentV1Routes`. The proxy injects `stoToken` and avoids direct renderer calls to backend domains.
- **Alternative considered**: Create a dedicated Electron route for every data-center JSON endpoint. Rejected because it duplicates the generic proxy and conflicts with the server guidance.

### 4. Add a dedicated Main-process upload route for multipart file streams
- **Decision**: File and artifact uploads use a narrow local route, such as `/api/data-center/files/upload` and `/api/data-center/artifacts/upload`, where the renderer passes local `filePath` plus metadata and Main streams multipart data to memory-center.
- **Rationale**: The current `hostApiFetch` IPC proxy serializes request bodies and is not a good fit for browser `FormData` or local file streams. Main already owns token injection and can avoid logging sensitive headers or local file contents.
- **Alternative considered**: Send `FormData` directly from renderer through `hostApiFetch`. Rejected because IPC serialization cannot reliably preserve multipart boundaries or binary streams.

### 5. Keep unavailable design elements visible only as disabled or future placeholders
- **Decision**: `网点共享产物`, `本地文件`, `授权本地文件`, and `数据源` are either hidden, disabled with clear copy, or represented as empty future tabs depending on product preference. They MUST NOT call fake APIs.
- **Rationale**: The interface document does not define backend behavior for these areas. Fake data would create implementation debt and user confusion.
- **Alternative considered**: Mock the missing areas locally. Rejected because Data Center is a data-management feature where fake persistence is risky.

### 6. Use existing SClaw theme tokens and compact operational UI density
- **Decision**: The Data Center UI uses the existing SClaw shell, shadcn primitives, lucide icons, `docs/sto-design.md` semantic colors, and both light/dark theme states. It should be dense and scan-friendly, not a marketing-style landing page.
- **Rationale**: The design is an operational file manager. Existing app conventions reduce visual drift and keep the page ergonomic for repeated use.
- **Alternative considered**: Copy the design draft pixel-for-pixel with hardcoded light colors. Rejected because the app requires theme consistency and dark-mode compatibility.

## Architecture

### Renderer API Layer

Create `src/lib/data-center-api.ts`:

- `getDataCenterQuota()`
- `listDataCenterEntries(params)`
- `getDataCenterEntry(entryId)`
- `createDataCenterFolder(params)`
- `renameDataCenterEntry(entryId, name)`
- `deleteDataCenterEntry(entryId)`
- `getDataCenterDownloadUrl(entryId)`
- `getDataCenterPreviewUrl(entryId)`
- `getDataCenterTrace(entryId)`
- `uploadDriveFileFromPath(params)` through `/api/data-center/files/upload`
- `uploadArtifactFromPath(params)` through `/api/data-center/artifacts/upload`

JSON methods unwrap `{ success, data, traceId }`, preserve `traceId` on thrown errors, and branch on `errCode` rather than localized `errMessage`.

### Renderer State

Create `src/stores/data-center.ts` with:

- `spaceType`: `drive | qa_artifact`
- `activeSection`: `qa_artifact | drive | data_source`
- `parentEntryId`, `breadcrumbs`
- `items`, `total`, `pageNo`, `pageSize`
- `keyword`, `sortField`, `sortOrder`, `viewMode`
- `quota`, `loading`, `mutating`, `uploading`
- Actions for load, refresh, enter folder, search, create folder, rename, delete, upload, preview, download, trace

Use URL query state for shareable/navigation-safe location where practical, while keeping transient dialogs in local component state.

### Main Upload Route

Add `electron/api/routes/data-center.ts` only for multipart forwarding:

- Validate local file path exists and is a file
- Validate non-empty and <= 200 MiB before network upload
- Create a stable `idempotencyKey` on renderer or Main, and preserve it on retry
- Build multipart request with `file`, `parentEntryId`, `idempotencyKey`, and artifact provenance fields
- Use Main-side memory-center base URL and `stoToken` auth headers
- Return memory-center response unchanged except for normalized transport errors
- Do not log `stoToken`, signed URLs, or raw multipart bodies

### Artifact Preview Save Flow

The file preview surface needs a save action in the top-right toolbar:

1. User previews a generated artifact in chat or workflow output.
2. User clicks the `保存产物` icon.
3. The modal loads `qa_artifact` folder choices from Data Center APIs.
4. User may create a folder inside `qa_artifact`.
5. User confirms a target folder.
6. The app uploads through `/artifacts/upload` with artifact provenance.
7. On success, the modal closes, a success toast appears, and Data Center state invalidates `qa_artifact`.
8. If `traceStatus=pending`, the upload is still treated as successful with "来源校验中" copy.

### Data Center Page

`/data-center` renders:

- Page title/subtitle
- Section navigation for `问答产物`, `我的文件`, `数据源`
- Section-specific secondary tabs
- Toolbar: search, workflow filter placeholder, view switch, create folder/upload actions
- Breadcrumb row for folder navigation
- List/grid content views
- Empty, loading, error, quota, and disabled-future states
- Preview dialog using temporary preview URL only on demand
- Action menu for download, preview, trace, rename, delete

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| [Risk] Renderer upload cannot send multipart correctly through current IPC proxy | Add a dedicated Main-process upload route that streams local files |
| [Risk] `qa_artifact` entries lose traceability if saved without provenance | Make artifact-preview save the only phase-1 artifact upload entry and require provenance fields |
| [Risk] Design includes capabilities missing from backend | Mark those entries as out of scope, disabled, or future placeholders; do not mock persistence |
| [Risk] Temporary preview/download URLs expire | Request URLs only on user action and refresh URL after OSS 403 or expiry |
| [Risk] Duplicate uploads after timeout | Preserve original `idempotencyKey` across retries for the same logical save/upload |
| [Risk] Light-only design draft colors regress dark mode | Use `docs/sto-design.md` semantic tokens and add dark-mode verification tasks |
| [Risk] Non-site users access site-only Data Center | Keep existing sidebar visibility and route guard semantics unless product changes access policy |

## Open Questions

- Should the current customer-relations iframe remain accessible, move under `数据源`, or be removed from `/data-center` phase 1?
- Should `问答产物` default to the root folder or a generated "临时会话" folder in the save modal?
- Should "关联工作流" filter remain disabled until backend exposes workflow filtering, or should it filter client-side by available trace metadata after list load?
- Should successful artifact saves navigate users to Data Center immediately, or only show a toast with an optional "查看产物" action?
