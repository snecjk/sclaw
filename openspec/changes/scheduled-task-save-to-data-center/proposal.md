## Why

Scheduled task outputs can currently remain only in the task chat/session surface. Users need an explicit option to save generated artifacts to Data Center so they can manage, share, and trace them later.

The feature must stay extensible: current UI exposes "my artifact" and "site shared artifact", but Data Center may later add department, project, or other scoped spaces. The implementation should avoid hard-coding upload logic to scheduled tasks only so workflow and chat artifacts can reuse the same capability.

## What Changes

- Add a scheduled task creation/edit option for saving outputs to Data Center.
- Keep the option disabled by default; when enabled, expand target path selection.
- Persist selected targets on scheduled tasks using existing artifact folder path columns for current spaces.
- Introduce a shared Data Center artifact sync service that accepts generic save targets.
- Record per-artifact, per-target save status and failure reasons.
- Include scheduled task title metadata when saving scheduled task artifacts so Data Center can show the related task title.
- Notify users of save success/failure through scheduled task session events and expose records for detail views.

## Impact

- Renderer: scheduled task modal, task save payload, Data Center entry metadata display.
- Main: scheduled task executor, Data Center upload proxy payload, new artifact save record repository/service.
- SQLite: new `artifact_save_records` table.
- Tests: target URI parsing, save record repository, scheduled task modal payload, executor sync service behavior.
