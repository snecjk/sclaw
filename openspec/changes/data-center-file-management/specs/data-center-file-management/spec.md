## ADDED Requirements

### Requirement: Data Center provides phase-one file management spaces
The system SHALL provide a native Data Center page that exposes phase-one online file management for `qa_artifact` and `drive` spaces using memory-center `/agent/v1/data-center` APIs.

#### Scenario: Opening question-answer artifacts
- **WHEN** a site user opens Data Center and selects `问答产物`
- **THEN** the page SHALL request entries with `spaceType=qa_artifact` and `parentEntryId=root`
- **AND** the page SHALL render folders and files returned by the backend without generating preview or download URLs up front

#### Scenario: Opening my online files
- **WHEN** a site user opens Data Center and selects `我的文件 > 线上文件`
- **THEN** the page SHALL request entries with `spaceType=drive` and the current `parentEntryId`
- **AND** the page SHALL render quota information when quota data is available

#### Scenario: Viewing unsupported phase-one areas
- **WHEN** the user selects a design-draft area without a backend contract such as `网点共享产物`, `本地文件`, or `数据源`
- **THEN** the page SHALL show a disabled or future-state surface
- **AND** the renderer SHALL NOT call mock or undocumented persistence APIs

### Requirement: Data Center supports folder navigation and discovery
The system SHALL support folder navigation, breadcrumbs, search, sorting, pagination, and list/grid view switching for backend entries.

#### Scenario: Entering a folder
- **WHEN** the user activates a folder entry
- **THEN** the page SHALL set that folder `entryId` as `parentEntryId`
- **AND** the page SHALL refresh entries and breadcrumbs from the backend response

#### Scenario: Searching entries
- **WHEN** the user enters a non-empty keyword
- **THEN** the page SHALL call the list endpoint with `keyword`
- **AND** the UI SHALL treat the results as space-wide search results rather than direct children of the current folder

#### Scenario: Switching view mode
- **WHEN** the user switches between list and grid view
- **THEN** the page SHALL render the same entry data in the selected layout
- **AND** text, icon buttons, hover, selected, disabled, and empty states SHALL remain readable in light and dark mode using semantic theme tokens

### Requirement: Data Center supports entry mutations
The system SHALL let users create folders, rename entries, delete entries, upload files to `drive`, preview files, and download files through documented data-center APIs.

#### Scenario: Creating a folder
- **WHEN** the user creates a folder in either supported space
- **THEN** the app SHALL call `/folder/create` with the current `spaceType`, current `parentEntryId`, and folder name
- **AND** the current directory SHALL refresh after success

#### Scenario: Uploading a local file to my files
- **WHEN** the user uploads a local file from `我的文件 > 线上文件`
- **THEN** Main SHALL validate the file is non-empty and not larger than 200 MiB
- **AND** Main SHALL forward multipart data to `/files/upload` with `parentEntryId` and `idempotencyKey`
- **AND** the page SHALL refresh entries and quota after success

#### Scenario: Handling entry mutation errors
- **WHEN** memory-center returns business errors such as `NAME_CONFLICT`, `FOLDER_NOT_EMPTY`, `FILE_TOO_LARGE`, `QUOTA_EXCEEDED`, or `PREVIEW_UNSUPPORTED`
- **THEN** the UI SHALL branch on `errCode`
- **AND** the UI SHALL preserve `traceId` for troubleshooting when available

#### Scenario: Previewing and downloading files
- **WHEN** the user previews or downloads a file
- **THEN** the app SHALL request a temporary URL only after the user action
- **AND** the app SHALL NOT persist temporary signed URLs in durable storage

### Requirement: Artifact preview saves generated artifacts into Data Center
The system SHALL provide a `保存产物` action in the artifact preview toolbar that saves generated chat or workflow artifacts into the `qa_artifact` space with provenance metadata.

#### Scenario: Opening the save artifact modal
- **WHEN** the user clicks the `保存产物` icon in the artifact preview toolbar
- **THEN** the app SHALL open a modal titled `保存产物`
- **AND** the modal SHALL show the artifact filename and allow the user to choose a target folder in `qa_artifact`

#### Scenario: Saving a chat artifact
- **WHEN** the user confirms saving a chat-generated artifact
- **THEN** Main SHALL upload the artifact through `/artifacts/upload`
- **AND** the request SHALL include `sourceType=chat_artifact`, `sessionId`, `artifactKey`, and any available `messageId` and `runId`

#### Scenario: Saving a workflow artifact
- **WHEN** the user confirms saving a workflow-generated artifact
- **THEN** Main SHALL upload the artifact through `/artifacts/upload`
- **AND** the request SHALL include `sourceType=workflow_artifact`, `sessionId`, `artifactKey`, and any available `workflowTemplateId`, `workflowRunId`, `messageId`, and `runId`

#### Scenario: Saving with pending trace verification
- **WHEN** `/artifacts/upload` succeeds with `traceStatus=pending`
- **THEN** the app SHALL treat the save as successful
- **AND** the UI SHALL indicate that source verification is still in progress

### Requirement: Question-answer artifacts support trace back to their source
The system SHALL let users trace verified `qa_artifact` files back to the originating SClaw conversation or workflow context.

#### Scenario: Showing trace action
- **WHEN** a `qa_artifact` file has `traceAvailable=true`
- **THEN** the Data Center action menu SHALL include `追溯对话`
- **AND** the action SHALL be hidden or disabled for entries without trace availability

#### Scenario: Tracing an artifact
- **WHEN** the user activates `追溯对话`
- **THEN** the app SHALL call `/entries/{entryId}/trace`
- **AND** the app SHALL navigate to the matching SClaw conversation or workflow run using returned identifiers such as `sessionId`, `messageId`, `runId`, `workflowTemplateId`, or `workflowRunId`

### Requirement: Renderer data-center access follows the Main-owned backend boundary
The system SHALL access memory-center data-center APIs through existing renderer-to-Main boundaries and MUST NOT call memory-center domains directly from renderer components.

#### Scenario: Calling JSON data-center APIs
- **WHEN** renderer code needs quota, entries, details, folder creation, rename, delete, preview URL, download URL, or trace
- **THEN** renderer code SHALL call `hostApiFetch` with `/ai-memory/agent/v1/data-center/...`
- **AND** Main SHALL inject `stoToken` through the existing memory-center proxy

#### Scenario: Uploading local files or artifacts
- **WHEN** renderer code needs to upload a local file path or generated artifact path
- **THEN** renderer code SHALL call a local host-api upload route
- **AND** Main SHALL stream multipart data to memory-center without logging `stoToken`, signed URLs, or raw file contents

### Requirement: Data Center UI remains theme-compatible
The Data Center UI SHALL align with `docs/sto-design.md` semantic foreground, background, border, focus, selected, disabled, danger, warning, and success tokens, and MUST support dark mode for every new renderer-visible state.

#### Scenario: Rendering operational controls in dark mode
- **WHEN** the app is in dark mode
- **THEN** Data Center toolbar controls, action menus, dialogs, previews, list rows, grid cards, breadcrumbs, and disabled future states SHALL maintain readable contrast and clear hover/focus affordances

#### Scenario: Showing destructive actions
- **WHEN** the user opens a delete confirmation or destructive menu action
- **THEN** the UI SHALL use Danger semantics consistent with `docs/sto-design.md`
- **AND** it SHALL avoid hardcoded light-only colors
