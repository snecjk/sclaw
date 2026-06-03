## 1. API Layer — Query Cloud Task Runs

- [ ] 1.1 Add `ScheduledTaskRun` interface and `getTaskRuns(taskId)` method to `electron/services/scheduled-task-service.ts` (Requirement: Main process polls cloud task execution results)
- [ ] 1.2 Handle snake_case to camelCase field mapping (`execution_result`, `log_text`, `started_at`, `completed_at`) in `getTaskRuns`
- [ ] 1.3 Add unit tests for `getTaskRuns` with mocked fetch responses

## 2. Persistent State — Poller Store

- [ ] 2.1 Create `electron/utils/scheduled-task-poller-store.ts` using `electron-store` (Requirement: Offline result compensation on startup)
- [ ] 2.2 Define schema: `lastSyncTime?: string`, `lastPolledAt: Record<string, string>`, `processedRunIds: string[]` (bounded to 1000)
- [ ] 2.3 Implement helper functions: `getLastSyncTime()`, `setLastSyncTime()`, `getLastPolledAt(taskId)`, `setLastPolledAt(taskId, time)`, `isRunProcessed(runId)`, `markRunProcessed(runId)`

## 3. Core Poller — ScheduledTaskResultPoller

- [ ] 3.1 Create `electron/services/scheduled-task-result-poller.ts` with singleton class `ScheduledTaskResultPoller` (Requirement: Main process polls cloud task execution results)
- [ ] 3.2 Implement global low-frequency poll (30s base, serial `setTimeout` chain) with `listTasks()` + `lastRunAt` filter to reduce unnecessary requests
- [ ] 3.3 Implement task-level high-frequency poll (5s for first 5 attempts, then 10s, max 2min) with `startTaskPoll(taskId)` / `stopTaskPoll(taskId)`
- [ ] 3.4 Implement `processResults(results)`: dedupe via `processedRunIds`, call `appendTriggerResultToSession`, update `lastSyncTime`
- [ ] 3.5 Implement exponential backoff on network errors (30s → 60s → 120s, cap 5min) and interval reset on success (Requirement: Network error resilience with exponential backoff)
- [ ] 3.6 Implement startup compensation: perform immediate sync before first scheduled tick if `lastSyncTime` is stale
- [ ] 3.7 Add IPC notification `mainWindow?.webContents.send('scheduled-task:new-result', payload)` after processing new results
- [ ] 3.8 Add unit tests for poller logic with mocked `ScheduledTaskService` and mocked store

## 4. Main Process Integration

- [ ] 4.1 Import and instantiate `ScheduledTaskResultPoller` in `electron/main/index.ts` after `registerIpcHandlers`
- [ ] 4.2 Call `poller.attachMainWindow(window)` and `poller.start()` during app initialization
- [ ] 4.3 Call `poller.stop()` on app `before-quit` or window close
- [ ] 4.4 Add `'scheduled-task:new-result'` to `validChannels` in `electron/preload/index.ts` (on/once/off sections)
- [ ] 4.5 Ensure `startTaskPoll` is triggered after `triggerTask` in `electron/api/routes/scheduled-tasks.ts` (Requirement: Task-level high-frequency poll after manual trigger)

## 5. Renderer — Unread Badge Store & Sidebar

- [ ] 5.1 Create `src/stores/scheduled-task-unread.ts` Zustand store with `unreadTaskIds: Set<number>`, `addUnread(taskId)`, `markRead(taskId)`, `markAllRead()`, `hasUnread()` (Requirement: Sidebar displays unread badge for scheduled task results)
- [ ] 5.2 Subscribe to `scheduled-task:new-result` IPC event in a root-level hook or `App.tsx` effect, calling `addUnread(taskId)` on receive
- [ ] 5.3 Add red dot badge to Scheduled Tasks nav item in `src/components/layout/Sidebar.tsx` using `hasUnread()` (Requirement: Sidebar displays unread badge for scheduled task results)
- [ ] 5.4 Ensure badge style aligns with `docs/sto-design.md` semantic tokens (use `bg-[hsl(var(--destructive))]` for the dot, consistent with existing unread patterns)

## 6. Renderer — Scheduled Tasks Page Unread Clear

- [ ] 6.1 In `src/pages/ScheduledTasks/index.tsx`, call `markAllRead()` from the unread store on component mount / route activation (Requirement: Unread state is cleared when user views Scheduled Tasks page)
- [ ] 6.2 Ensure unread is NOT added when the user is already on `/scheduled-tasks` and a new IPC event arrives

## 7. Verification & Documentation

- [ ] 7.1 Run `pnpm run typecheck` and fix any TypeScript errors
- [ ] 7.2 Run `pnpm run lint` and fix any lint errors
- [ ] 7.3 Run `pnpm test` (Vitest) and ensure new unit tests pass
- [ ] 7.4 Run `pnpm run comms:replay` and `pnpm run comms:compare` if any communication paths were touched
- [ ] 7.5 Review `README.md`, `README.zh-CN.md`, `README.ja-JP.md` for updates related to scheduled task behavior
