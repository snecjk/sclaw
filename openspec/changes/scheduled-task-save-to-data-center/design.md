## Context

`schedule_tasks` already has `my_artifact_folder_path` and `shared_artifact_folder_path`, and the Data Center upload route supports `sourceType = scheduled_task_artifact`. The missing pieces are user configuration, reusable target parsing, save status persistence, scheduled-task metadata, and executor integration.

## Decisions

### Generic Save Target Model

Use a generic target representation instead of baking "my/shared" into the sync service:

```ts
interface DataCenterArtifactTarget {
  uri: string;
  spaceType: string;
  spaceId?: string | null;
  parentEntryId: string;
  label?: string;
}
```

URI format:

```txt
data-center://{spaceType}/{parentEntryId}
data-center://{spaceType}/{spaceId}/{parentEntryId}
```

Current mappings:

```txt
data-center://qa_artifact/root
data-center://site_shared_artifact/{spaceId}/root
```

Future spaces can use the same grammar, for example:

```txt
data-center://department_artifact/{departmentId}/root
data-center://project_artifact/{projectId}/root
```

### Persist Current Scheduled Task Targets in Existing Columns

For the current two-space UI, persist targets in:

- `schedule_tasks.my_artifact_folder_path`
- `schedule_tasks.shared_artifact_folder_path`

Business code must immediately normalize these columns into `DataCenterArtifactTarget[]`. Future multi-target support can store `extra.artifactSaveTargets` without adding a column per space.

### Reusable Main Service

Add a Main-process service for artifact saving:

```ts
syncArtifactsToDataCenter({
  sourceType,
  sourceId,
  sourceTitle,
  runId,
  sessionId,
  artifacts,
  targets,
  idempotencyScope,
});
```

Scheduled tasks use `sourceType = scheduled_task_artifact`, `sourceId = task.id`, and `sourceTitle = task.name`. Workflows later reuse the same method with `sourceType = workflow_artifact`.

### Save Status Is Independent From Task Status

Scheduled task execution status and artifact save status are separate. A task can succeed while artifact saving partially or fully fails. Save failures are recorded and surfaced without changing the run terminal status.

### Scheduled Task Title Metadata

Every scheduled task artifact upload must include the related task title. Local save records store `source_title`, and upload payloads pass `sourceId/sourceTitle` metadata when supported by Data Center. Data Center list UI displays the related task title for `scheduled_task_artifact`.

### Path Changes Affect Future Runs Only

Editing the save path changes subsequent scheduled task runs. Historical artifacts and save records keep their original target URI/path metadata and are not automatically moved.

## Risks

- Artifact collection from arbitrary chat output may miss files if the runtime does not emit structured file metadata. The first implementation extracts user-facing media/file references from terminal assistant text and can later be expanded to read richer transcript/tool metadata.
- Data Center backend may not yet persist `sourceTitle`; the client stores it locally and sends it forward-compatible in the upload payload.
