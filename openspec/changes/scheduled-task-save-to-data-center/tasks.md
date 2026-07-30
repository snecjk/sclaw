## 1. Specification

- [x] Add OpenSpec requirement for scheduled task Data Center save configuration.
- [x] Add OpenSpec requirement for save records and failure visibility.
- [x] Add OpenSpec requirement for source title metadata.

## 2. Shared Model and Persistence

- [x] Add Data Center target URI parser/builder.
- [x] Add `artifact_save_records` migration and typed table.
- [x] Add artifact save record repository and route for querying records.

## 3. Scheduled Task Configuration UI

- [x] Add default-off save-to-Data-Center section in task modal.
- [x] Persist selected targets through scheduled task create/update payloads.
- [x] Support editing paths; changes affect future runs only.

## 4. Sync Service and Executor Integration

- [x] Add reusable Main-process artifact sync service.
- [x] Include scheduled task title metadata in records and upload payloads.
- [x] Trigger sync after successful scheduled task runs.
- [x] Emit/save user-visible success/failure summaries.

## 5. Verification

- [x] Add focused unit coverage for target URI parsing and save records.
- [x] Run typecheck or targeted tests.
