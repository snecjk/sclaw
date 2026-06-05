## 1. Main-Process Infrastructure

- [x] 1.1 Define shared TypeScript types for cloud cron tasks (`CloudCronJob`, `CloudCronSchedule`, `CloudTaskResult`) in `electron/shared/`
- [x] 1.2 Create `CloudTaskClient` service in `electron/services/` to wrap external Cloud Task API calls (create, update, delete, toggle, trigger, list, fetch results)
- [x] 1.3 Add Cloud Agent API client method to fetch user's cloud agent list (`GET /agents?environment=cloud`)
- [x] 1.4 Extend `electron/api/routes/cron.ts` with cloud task proxy routes (`POST /api/cron/cloud/jobs`, `PUT /api/cron/cloud/jobs/:id`, `DELETE /api/cron/cloud/jobs/:id`, `POST /api/cron/cloud/toggle`, `POST /api/cron/cloud/trigger`, `GET /api/cron/cloud/results`)
- [x] 1.5 Implement cloud result polling scheduler (`syncCloudResults`) with `lastSyncAt` cursor and pagination support
- [x] 1.6 Implement foreground polling (30s interval when Cron page active) and background polling (60s interval when app running)
- [x] 1.7 Add cloud result deduplication logic by result ID before writing to local cache

## 2. Frontend Types and State Management

- [x] 2.1 Extend `src/types/cron.ts` with cloud-specific types (`CloudCronJob`, `ExecutionLocation`, cloud execution status enum)
- [x] 2.2 Extend `src/stores/cron.ts` Zustand store to support cloud tasks: add `cloudJobs`, `cloudAgents`, `lastSyncAt`, and corresponding async actions (ref: Requirement: Cloud task creation, Requirement: Unified task list display)
- [x] 2.3 Implement `fetchCloudAgents()` action in cron store to populate cloud agent selector (ref: Requirement: Cloud agent selection)
- [x] 2.4 Implement unified `fetchJobs()` that merges local Gateway jobs and cloud jobs, sorted by next execution time (ref: Requirement: Unified task list display)
- [x] 2.5 Add cloud task CRUD actions: `createCloudJob()`, `updateCloudJob()`, `deleteCloudJob()`, `toggleCloudJob()`, `triggerCloudJob()` (ref: Requirement: Cloud task creation, Requirement: Cloud task editing, Requirement: Cloud task deletion, Requirement: Cloud task toggle, Requirement: Cloud task manual trigger)

## 3. Cron Page UI Adjustments

- [x] 3.1 Hide the "local execution" radio option in the cron job creation/edit form; default all new jobs to cloud execution (feature-flag controlled) (ref: Decision 6 in design.md)
- [x] 3.2 Add cloud agent selector dropdown in the cron job form, populated from `cloudAgents` store state (ref: Requirement: Cloud agent selection)
- [x] 3.3 Display empty-state guidance when no cloud agents are available (ref: Requirement: Cloud agent selection)
- [x] 3.4 Add cloud environment indicator (☁️ icon with tooltip) to cloud task cards (ref: Requirement: Unified task list display)
- [x] 3.5 Show warning banner on Cron page when Cloud Task API is unreachable, with cached jobs showing "sync pending" state (ref: Requirement: Unified task list display)
- [x] 3.6 Apply UI Token alignment: cloud indicator uses Info/Blue-6 (`#4760FE`) per `docs/sto-design.md`

## 4. Cloud Task Lifecycle Operations

- [x] 4.1 Wire up `createCloudJob()` to call `POST /api/cron/cloud/jobs` via `hostApiFetch`, with error handling and toast feedback (ref: Requirement: Cloud task creation)
- [x] 4.2 Wire up `updateCloudJob()` to call `PUT /api/cron/cloud/jobs/:id`, handle "task not found" by removing stale local entry (ref: Requirement: Cloud task editing)
- [x] 4.3 Wire up `deleteCloudJob()` to call `DELETE /api/cron/cloud/jobs/:id`, with undo toast support (ref: Requirement: Cloud task deletion)
- [x] 4.4 Wire up `toggleCloudJob()` to call `POST /api/cron/cloud/toggle`, optimistically update UI state (ref: Requirement: Cloud task toggle)
- [x] 4.5 Wire up `triggerCloudJob()` to call `POST /api/cron/cloud/trigger`, show confirmation toast (ref: Requirement: Cloud task manual trigger)
- [x] 4.6 Add loading states and error boundaries for all cloud task operations to prevent UI blocking

## 5. Result Synchronization

- [x] 5.1 Implement foreground polling: when Cron page is active, poll `GET /api/cron/cloud/results?since={lastSyncAt}` every 30 seconds (ref: Requirement: Online result polling)
- [x] 5.2 Implement background polling: when StoClaw is running, poll cloud results every 60 seconds and trigger system notifications for new completions (ref: Requirement: Online result polling)
- [x] 5.3 Implement startup result sync: on app launch, call `GET /api/cron/cloud/results?since={lastSyncAt}` with cursor pagination to fetch all offline-period results (ref: Requirement: Offline result pull)
- [x] 5.4 Implement network-recovery result sync: detect online/offline state changes and trigger incremental pull when connectivity is restored (ref: Requirement: Offline result pull)
- [x] 5.5 Add bulk sync progress indicator UI for large offline result batches (ref: Requirement: Offline result pull)
- [x] 5.6 Implement local cache format for cloud results matching existing `cron/runs/*.jsonl` structure (ref: Requirement: Cloud result local caching)
- [x] 5.7 Add cache size limit and eviction policy for cloud result logs (ref: Requirement: Cloud result local caching)

## 6. Notifications and History

- [x] 6.1 Implement Toast notification for real-time cloud execution success with task name and click-to-chat action (ref: Requirement: Execution result notification)
- [x] 6.2 Implement batch summary notification for offline result pull completion (ref: Requirement: Execution result notification)
- [x] 6.3 Implement failure Toast with categorized error reason and "View Details" action (ref: Requirement: Execution result notification)
- [x] 6.4 Ensure run history view renders cloud results from local cache alongside local results, unified chronological ordering (ref: Requirement: Unified run history rendering)
- [x] 6.5 Add execution environment tag (cloud/local) to each history entry (ref: Requirement: Unified run history rendering)
- [x] 6.6 Implement cloud execution metadata display in history detail (cloud agent version, model, duration) (ref: Requirement: Unified run history rendering)
- [x] 6.7 Integrate cloud result synthesis into chat session system: create/update session keyed by `agent:{cloudAgentId}:cron:{cloudJobId}` with system metadata + assistant response (ref: Requirement: Chat session synthesis for cloud results)
- [x] 6.8 Add "cloud execution" source indicator in chat session header when viewing synthesized cloud sessions (ref: Requirement: Chat session synthesis for cloud results)

## 7. Internationalization and Documentation

- [x] 7.1 Add cloud cron i18n keys to `src/i18n/locales/en/cron.json`, `zh/cron.json`, `ja/cron.json` (cloud execution labels, notifications, error messages)
- [x] 7.2 Review and update `README.md`, `README.zh-CN.md`, `README.ja-JP.md` to document cloud cron execution feature
- [x] 7.3 Update AGENTS.md if any build/run instructions change due to new cloud service dependencies

## 8. Testing

- [x] 8.1 Add unit tests for `CloudTaskClient` service (mock external API, verify request/response handling)
- [x] 8.2 Add unit tests for cron store cloud actions (create, update, delete, toggle, fetch with merging)
- [x] 8.3 Add unit tests for result deduplication and cursor-based sync logic
- [x] 8.4 Add Playwright E2E test for cloud cron job creation flow (mock Cloud Task API)
- [x] 8.5 Run `pnpm run comms:replay` and `pnpm run comms:compare` to verify polling-based result sync does not break existing communication patterns
