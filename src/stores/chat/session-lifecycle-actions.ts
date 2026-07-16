import {
  applyWorkspaceDefaultToNewSession,
  syncSessionModelToGateway,
} from '@/lib/sync-workspace-default-to-chat';
import { isConcreteModelId, normalizeModelIdForChat } from '@/lib/chat-model-options';
import { hostApiFetch } from '@/lib/host-api';
import { fetchDeletedSessionKeys, omitDeletedSessionKeys, rememberOptimisticDeletedSessionKey } from '@/lib/deleted-session-filter';
import { notifySessionDeleteFailed, requestSessionDelete, resolveSessionDeleteEngineType } from '@/lib/session-delete';
import { touchSessionReadAt, useSessionUnreadStore } from '@/stores/session-unread';
import { useGatewayStore } from '../gateway';
import { useAgentsStore } from '../agents';
import {
  isVirtualTaskSessionKey,
  parseCronSessionKey,
  parseScheduledTaskAgentSessionKey,
  parseScheduledTaskSessionKey,
  parseClaudeScheduledTaskRunSessionKey,
  parseClaudeScheduledTaskSessionKey,
} from './cron-session-utils';
import { sanitizeSessionDisplayField, mergeSessionLastActivity } from './helpers';
import {
  resolveClaudeGroupNameFromSession,
  resolveCronGroupNameFromSession,
  resolveStoScheduledGroupNameFromSession,
} from '@/lib/scheduled-task-group-name';
import {
  appendPendingLocalVirtualTaskSessions,
  findCronDatedTwinKey,
  omitSupersededCronDatedAgentTwins,
} from '@/stores/chat/session-list-merge';
import {
  buildInitialSidebarRecentOrder,
  isSidebarRecentChatSessionKey,
  removeSidebarRecentOrderKey,
  scrubClaudeSessionLastActivity,
} from '@/lib/sidebar-recent-order';
import { isHiddenStoTaskSubitemChatSessionKey } from '@/lib/sto-task-session';
import {
  applyStoredSessionLabels,
  sanitizeGatewaySessionLabels,
  scrubCorruptedSessionLabels,
} from '@/lib/session-label';
import {
  DEFAULT_CANONICAL_PREFIX,
  DEFAULT_SESSION_KEY,
  type ChatSession,
} from './types';
import type { ChatGet, ChatSet, SessionActions } from './store-api';
import { clearSessionRuntimeTimers } from './runtime-timers';
import { clearSessionRunLifecycle } from './run-lifecycle';
import {
  captureTopLevelRuntime,
  clearActivatingSessionIfHandedOff,
  createIdleSessionRuntimeState,
} from './session-runtime';
import {
  clearSessionEntryFromMap,
  createTemporaryAgentSessionKey,
  getAgentIdFromSessionKey,
  getCanonicalPrefixFromSessions,
  isTemporaryAgentSessionKey,
} from './session-identity';
import {
  getBaseAgentIdFromProjectAgentId,
  resolveProjectAgentId,
} from '../../../shared/project-agent';
import {
  clearSessionSendReadiness,
  registerSessionSendReadiness,
  transferSessionSendReadiness,
} from '@/lib/session-send-readiness';

const NEW_SESSION_TEMP_LABEL = '新对话';
const SESSION_LOAD_MIN_INTERVAL_MS = 1_200;

let _loadSessionsInFlight: Promise<void> | null = null;
let _lastLoadSessionsAt = 0;

export interface SessionLifecycleDeps {
  parseSessionUpdatedAtMs: (value: unknown) => number | undefined;
  scheduleSessionLabelHydrationFromStore: (set: ChatSet, get: ChatGet) => void;
  getAgentEngineType: (agentId: string | undefined | null) => ChatSession['engineType'] | undefined;
  getCanonicalPrefixFromSessionKey: (sessionKey: string) => string | null;
}

export function createSessionLifecycleActions(
  set: ChatSet,
  get: ChatGet,
  deps: SessionLifecycleDeps,
): Pick<SessionActions, 'loadSessions' | 'deleteSession' | 'newSession'> {
  const {
    parseSessionUpdatedAtMs,
    scheduleSessionLabelHydrationFromStore,
    getAgentEngineType,
    getCanonicalPrefixFromSessionKey,
  } = deps;

  return {
    // ── Load sessions via sessions.list ──

    loadSessions: async (options?: { force?: boolean }) => {
      const force = options?.force === true;
      const now = Date.now();
      if (_loadSessionsInFlight) {
        await _loadSessionsInFlight;
        if (!force) {
          scheduleSessionLabelHydrationFromStore(set, get);
          return;
        }
      }
      if (!force && now - _lastLoadSessionsAt < SESSION_LOAD_MIN_INTERVAL_MS) {
        scheduleSessionLabelHydrationFromStore(set, get);
        return;
      }

      _loadSessionsInFlight = (async () => {
        try {
          const data = await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {});
          let rawSessions: Record<string, unknown>[] = [];
          if (data && Array.isArray(data.sessions)) {
            rawSessions = data.sessions;
          }

          // ── Merge local filesystem sessions (dated cron + scheduled-task runs) ──
          try {
            const [stRes, cronRes, claudeTaskRes] = await Promise.all([
              hostApiFetch('/api/scheduled-tasks/sessions').catch(() => null),
              hostApiFetch('/api/cron/sessions').catch(() => null),
              hostApiFetch('/api/claude-scheduled-tasks/sessions').catch(() => null),
            ]);
            const stData = stRes && typeof stRes === 'object' ? (stRes as Record<string, unknown>) : null;
            const cronData = cronRes && typeof cronRes === 'object' ? (cronRes as Record<string, unknown>) : null;
            const claudeTaskData = claudeTaskRes && typeof claudeTaskRes === 'object' ? (claudeTaskRes as Record<string, unknown>) : null;
            const stSessions = Array.isArray(stData?.sessions) ? (stData.sessions as Record<string, unknown>[]) : [];
            const cronSessions = Array.isArray(cronData?.sessions) ? (cronData.sessions as Record<string, unknown>[]) : [];
            const claudeTaskSessions = Array.isArray(claudeTaskData?.sessions) ? (claudeTaskData.sessions as Record<string, unknown>[]) : [];

            rawSessions = [...rawSessions, ...stSessions, ...cronSessions, ...claudeTaskSessions];
          } catch {
            // ignore
          }

          if (rawSessions.length > 0) {
            const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => {
              const key = String(s.key || '');
              const rawEngineType = s.engineType;
              const engineType: ChatSession['engineType'] | undefined =
                rawEngineType === 'claude' ? 'claude'
                  : rawEngineType === 'openclaw' ? 'openclaw'
                    : undefined;
              return {
                key,
                label: s.label ? String(s.label) : undefined,
                displayName: sanitizeSessionDisplayField(
                  key,
                  s.displayName ? String(s.displayName) : undefined,
                ),
                thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
                model: s.model ? String(s.model) : undefined,
                updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
                spawnedBy: typeof s.spawnedBy === 'string' ? s.spawnedBy : undefined,
                engineType,
              };
            }).filter((s: ChatSession) => s.key);

            // ── Identify which jobs already have real dated sessions ──
            const cronDated = new Set<string>();
            const scheduledTaskDated = new Set<string>();
            const claudeTaskDated = new Set<string>();
            // Most-recent dated aggregate key per task/job. Key order is lexicographic
            // == chronological for `...:{YYYY-MM-DD}` suffixes, so the greatest key is
            // today's. Used to redirect an active base/run key to its dated aggregate
            // below, so the dated-supersedes-base rule also governs the active session.
            const claudeTaskDatedKeyByTask = new Map<string, string>();
            const cronDatedKeyByJob = new Map<string, string>();
            const scheduledTaskDatedKeyByTask = new Map<number, string>();
            for (const session of sessions) {
              const cronParts = parseCronSessionKey(session.key);
              if (cronParts && cronParts.date) {
                cronDated.add(`agent:${cronParts.agentId}:cron:${cronParts.jobId}`);
                const prev = cronDatedKeyByJob.get(cronParts.jobId);
                if (!prev || session.key > prev) {
                  cronDatedKeyByJob.set(cronParts.jobId, session.key);
                }
              }
              const stParts = parseScheduledTaskAgentSessionKey(session.key);
              if (stParts && stParts.date) {
                scheduledTaskDated.add(`agent:main:scheduled-task:${stParts.taskId}`);
                const prev = scheduledTaskDatedKeyByTask.get(stParts.taskId);
                if (!prev || session.key > prev) {
                  scheduledTaskDatedKeyByTask.set(stParts.taskId, session.key);
                }
              }
              // Claude dated aggregate: claude-task:{taskId}:{YYYY-MM-DD}
              const claudeParts = parseClaudeScheduledTaskSessionKey(session.key);
              if (claudeParts && claudeParts.date) {
                claudeTaskDated.add(`claude-task:${claudeParts.taskId}`);
                const prev = claudeTaskDatedKeyByTask.get(claudeParts.taskId);
                if (!prev || session.key > prev) {
                  claudeTaskDatedKeyByTask.set(claudeParts.taskId, session.key);
                }
              }
            }

            // Filter out base sessions that have dated replacements
            // Also filter out run sessions when the job has dated aggregate sessions
            let filteredSessions = sessions.filter((s) => {
              if (cronDated.has(s.key)) return false;
              if (scheduledTaskDated.has(s.key)) return false;
              // Filter out claude-task base sessions when dated replacement exists
              if (claudeTaskDated.has(s.key)) return false;
              const cronParts = parseCronSessionKey(s.key);
              if (
                cronParts?.runSessionId
                && cronDated.has(`agent:${cronParts.agentId}:cron:${cronParts.jobId}`)
              ) {
                return false;
              }
              // Filter out claude-task-run sessions when their task has a dated aggregate
              const claudeRunParts = parseClaudeScheduledTaskRunSessionKey(s.key);
              if (claudeRunParts && claudeTaskDated.has(`claude-task:${claudeRunParts.taskId}`)) {
                return false;
              }
              return true;
            });

            const canonicalBySuffix = new Map<string, string>();
            for (const session of filteredSessions) {
              if (!session.key.startsWith('agent:')) continue;
              const parts = session.key.split(':');
              if (parts.length < 3) continue;
              const suffix = parts.slice(2).join(':');
              if (suffix && !canonicalBySuffix.has(suffix)) {
                canonicalBySuffix.set(suffix, session.key);
              }
            }

            // Deduplicate: if both short and canonical existed, keep canonical only
            // Also deduplicate cron dated sessions by jobId+date to prevent duplicates
            // Also deduplicate claude task dated sessions by taskId+date
            const seen = new Set<string>();
            const seenClaudeTaskDated = new Set<string>();
            const twinDeduped = omitSupersededCronDatedAgentTwins(filteredSessions);
            const dedupedSessions = twinDeduped.filter((s) => {
              if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
              if (seen.has(s.key)) {
                console.warn('[loadSessions] Duplicate session key filtered:', s.key);
                return false;
              }
              seen.add(s.key);
              // Dedup for claude task dated sessions: same taskId+date should only appear once
              const claudeParts = parseClaudeScheduledTaskSessionKey(s.key);
              if (claudeParts?.date) {
                const dedupKey = `${claudeParts.taskId}:${claudeParts.date}`;
                if (seenClaudeTaskDated.has(dedupKey)) {
                  console.warn('[loadSessions] Duplicate claude task dated session filtered:', s.key, 'dedupKey:', dedupKey);
                  return false;
                }
                seenClaudeTaskDated.add(dedupKey);
              }
              return true;
            });

            const deletedKeys = await fetchDeletedSessionKeys();
            const visibleDedupedSessions = omitDeletedSessionKeys(dedupedSessions, deletedKeys);

            const { currentSessionKey, sessions: localSessions } = get();
            const localByKey = new Map(localSessions.map((session) => [session.key, session]));
            const mergedRemoteSessions = visibleDedupedSessions.map((remote) => {
              const local = localByKey.get(remote.key);
              if (!local) return remote;
              return {
                ...remote,
                engineType: remote.engineType ?? local.engineType,
                model: remote.model ?? local.model,
              };
            });
            const mergedSessions = appendPendingLocalVirtualTaskSessions(
              mergedRemoteSessions,
              localSessions,
              deletedKeys,
            );
            let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
            if (!nextSessionKey.startsWith('agent:')) {
              const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
              if (canonicalMatch) {
                nextSessionKey = canonicalMatch;
              }
            }
            // If the active session is a claude-task / cron / scheduled-task base or
            // run key that has been superseded by a dated aggregate, redirect to that
            // dated key. Without this, sessionsWithCurrent below re-appends the
            // filtered-out base key and the sidebar shows two same-named entries
            // (dated + base). The loadHistory() call at the tail of loadSessions
            // reloads the dated aggregate's history, mirroring the canonical redirect
            // above.
            {
              const claudeBase = parseClaudeScheduledTaskSessionKey(nextSessionKey);
              const claudeRun = parseClaudeScheduledTaskRunSessionKey(nextSessionKey);
              const claudeTaskId = claudeBase?.taskId ?? claudeRun?.taskId;
              if ((Boolean(claudeRun) || Boolean(claudeBase && !claudeBase.date)) && claudeTaskId) {
                const datedKey = claudeTaskDatedKeyByTask.get(claudeTaskId);
                if (datedKey && mergedSessions.some((s) => s.key === datedKey)) {
                  nextSessionKey = datedKey;
                }
              }
              const cronParts = parseCronSessionKey(nextSessionKey);
              if (cronParts && (cronParts.runSessionId || !cronParts.date)) {
                const datedKey = cronDatedKeyByJob.get(cronParts.jobId);
                if (datedKey && mergedSessions.some((s) => s.key === datedKey)) {
                  nextSessionKey = datedKey;
                }
              }
              if (nextSessionKey.startsWith('agent:')) {
                const stParts = nextSessionKey.split(':');
                if (stParts.length === 4 && stParts[2] === 'scheduled-task') {
                  const stTaskId = Number(stParts[3]);
                  if (!Number.isNaN(stTaskId)) {
                    const datedKey = scheduledTaskDatedKeyByTask.get(stTaskId);
                    if (datedKey && mergedSessions.some((s) => s.key === datedKey)) {
                      nextSessionKey = datedKey;
                    }
                  }
                }
              }
            }
            if (!mergedSessions.find((s) => s.key === nextSessionKey) && mergedSessions.length > 0) {
              // Preserve only locally-created pending sessions.
              const hasLocalPendingSession =
                isTemporaryAgentSessionKey(nextSessionKey)
                || isHiddenStoTaskSubitemChatSessionKey(nextSessionKey)
                || localSessions.some((session) => session.key === nextSessionKey);
              // Virtual task/cron keys (e.g. a freshly triggered `claude-task:*` or
              // `agent:*:cron:*` dated session) are resolved by key prefix in
              // loadHistory and may not be in the backend list yet — keep them, or
              // the composer falls back to the default agent's engine.
              // On cold boot the default key (`agent:main:main`) must stay on the
              // new-chat home instead of jumping into the most recent session.
              if (
                nextSessionKey !== DEFAULT_SESSION_KEY
                && !hasLocalPendingSession
                && !isVirtualTaskSessionKey(nextSessionKey)
              ) {
                nextSessionKey = mergedSessions[0].key;
              }
            }

            // The trigger and host may materialize the same dated cron session under
            // different agents. Follow an already-listed twin instead of showing both.
            const activatingKeys = Object.keys(get().activatingScheduledSessionAt ?? {});
            const preferCronKey = activatingKeys.find((key) => parseCronSessionKey(key)?.date)
              ?? nextSessionKey;
            const cronTwinAlreadyListed = findCronDatedTwinKey(mergedSessions, nextSessionKey);
            if (
              cronTwinAlreadyListed
              && nextSessionKey
              && !mergedSessions.some((session) => session.key === nextSessionKey)
              && preferCronKey !== nextSessionKey
            ) {
              nextSessionKey = cronTwinAlreadyListed;
            }

            const localCurrentSession = localSessions.find((session) => session.key === nextSessionKey);
            const sessionsWithCurrent = !mergedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
              ? [...mergedSessions, {
                key: nextSessionKey,
                label: localCurrentSession?.label ?? NEW_SESSION_TEMP_LABEL,
                engineType: localCurrentSession?.engineType,
                model: localCurrentSession?.model,
              }]
              : mergedSessions;

            const twinCollapsedSessions = omitSupersededCronDatedAgentTwins(
              sessionsWithCurrent,
              preferCronKey,
            );
            const sessionKeyBeforeTwinCollapse = nextSessionKey;
            if (
              nextSessionKey
              && !twinCollapsedSessions.some((session) => session.key === nextSessionKey)
            ) {
              const left = parseCronSessionKey(nextSessionKey);
              const keptTwin = twinCollapsedSessions.find((session) => {
                const right = parseCronSessionKey(session.key);
                return Boolean(left?.date && right?.date
                  && left.jobId === right.jobId
                  && left.date === right.date);
              })?.key;
              if (keptTwin) nextSessionKey = keptTwin;
            }
            if (
              sessionKeyBeforeTwinCollapse
              && nextSessionKey
              && sessionKeyBeforeTwinCollapse !== nextSessionKey
            ) {
              const activatingAt = get().activatingScheduledSessionAt[sessionKeyBeforeTwinCollapse];
              if (activatingAt) {
                set((state) => {
                  const nextActivating = { ...state.activatingScheduledSessionAt };
                  delete nextActivating[sessionKeyBeforeTwinCollapse];
                  nextActivating[nextSessionKey] = activatingAt;
                  return { activatingScheduledSessionAt: nextActivating };
                });
              }
            }

            const scrubbedSessionLabels = scrubCorruptedSessionLabels(get().sessionLabels);
            const labeledSessions = sanitizeGatewaySessionLabels(
              applyStoredSessionLabels(twinCollapsedSessions, scrubbedSessionLabels),
            );

            // ── 定时任务会话名称富化：从任务定义 API 获取 displayName ──
          // 会话列表加载时补充任务定义名称，填充 displayName。
            // 当 startTask 异步分离执行时，后端 session 文件尚未写入，本地保留的会话条目缺少 displayName，
            // 导致侧边栏任务分组标题降级为技术 ID 而非人类可读的任务名。

            // 1) Cron jobs (openclaw)
            try {
              const jobsResult = await hostApiFetch<Array<{ id: string; name: string }>>('/api/cron/jobs');
              const jobNameMap = new Map(jobsResult.map((j) => [j.id, j.name]));
              const unresolvedCronJobIds = new Set<string>();
              for (const session of labeledSessions) {
                const parsed = parseCronSessionKey(session.key);
                if (parsed) {
                  const name = jobNameMap.get(parsed.jobId);
                  if (name) {
                    session.displayName = name;
                  } else {
                    unresolvedCronJobIds.add(parsed.jobId);
                  }
                }
              }
              if (unresolvedCronJobIds.size > 0) {
                try {
                  const fallbackJobs = await hostApiFetch<Array<{ id: string; name: string }>>('/api/cron/local-job-names');
                  const fallbackMap = new Map(fallbackJobs.map((j) => [j.id, j.name]));
                  for (const session of labeledSessions) {
                    const parsed = parseCronSessionKey(session.key);
                    if (parsed && unresolvedCronJobIds.has(parsed.jobId) && !session.displayName) {
                      const fallbackName = fallbackMap.get(parsed.jobId);
                      if (fallbackName) session.displayName = fallbackName;
                    }
                  }
                } catch {
                  // Fallback is best-effort
                }
              }
            } catch {
              // Ignore cron name enrichment failure
            }

            // 2) Scheduled tasks (STO)
            try {
              const tasksResult = await hostApiFetch<Array<{ id: number; name: string }>>('/api/scheduled-tasks');
              const taskNameMap = new Map(tasksResult.map((t) => [t.id, t.name]));
              for (const session of labeledSessions) {
                const parsed = parseScheduledTaskSessionKey(session.key);
                const stAgentParsed = parseScheduledTaskAgentSessionKey(session.key);
                if (parsed) {
                  const name = taskNameMap.get(parsed.taskId);
                  if (name) session.displayName = name;
                } else if (stAgentParsed) {
                  const name = taskNameMap.get(stAgentParsed.taskId);
                  if (name) session.displayName = name;
                }
              }
            } catch {
              // Ignore scheduled-task name enrichment failure
            }

            // 3) Claude scheduled tasks
            try {
              const tasksResult = await hostApiFetch<Array<{ id: string; name: string }>>('/api/claude-scheduled-tasks');
              const taskNameMap = new Map(tasksResult.map((task) => [task.id, task.name]));
              for (const session of labeledSessions) {
                const summaryParsed = parseClaudeScheduledTaskSessionKey(session.key);
                const runParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
                const taskId = summaryParsed?.taskId ?? runParsed?.taskId;
                if (!taskId) continue;
                const name = taskNameMap.get(taskId);
                if (name) session.displayName = name;
              }
            } catch {
              // Ignore Claude scheduled-task name enrichment failure
            }

            // 4) Label-based fallback when task APIs are unavailable (401 / Gateway down)
            for (const session of labeledSessions) {
              if (session.displayName?.trim()) continue;
              const stAgentParsed = parseScheduledTaskAgentSessionKey(session.key);
              const cronParsed = parseCronSessionKey(session.key);
              const claudeSummaryParsed = parseClaudeScheduledTaskSessionKey(session.key);
              const claudeRunParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
              const fromLabel = stAgentParsed
                ? resolveStoScheduledGroupNameFromSession(session)
                : cronParsed
                  ? resolveCronGroupNameFromSession(session)
                  : (claudeSummaryParsed || claudeRunParsed)
                    ? resolveClaudeGroupNameFromSession(session)
                    : undefined;
              if (fromLabel) session.displayName = fromLabel;
            }

            set((state) => {
              const discoveredActivity = Object.fromEntries(
                labeledSessions
                  .filter((session) => typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt))
                  .map((session) => {
                    const listedAt = session.updatedAt!;
                    if (session.engineType === 'claude') {
                      const persistedAt = state.sessionLastActivity[session.key] ?? 0;
                      // Claude registry updatedAt was previously bumped on history reads; prefer
                      // persisted transcript activity when we already have it locally.
                      if (persistedAt > 0) return [session.key, persistedAt];
                    }
                    return [session.key, listedAt];
                  }),
              );
              const sessionLastActivity = scrubClaudeSessionLastActivity(
                labeledSessions,
                mergeSessionLastActivity(state.sessionLastActivity, discoveredActivity),
              );
              let activatingScheduledSessionAt = state.activatingScheduledSessionAt;
              for (const sessionKey of Object.keys(discoveredActivity)) {
                activatingScheduledSessionAt = clearActivatingSessionIfHandedOff(
                  activatingScheduledSessionAt,
                  sessionKey,
                  state.runtimeBySessionKey,
                  sessionLastActivity,
                  labeledSessions,
                );
              }
              const recentSessions = labeledSessions.filter((session) => isSidebarRecentChatSessionKey(session.key));
              const recentKeys = recentSessions.map((session) => session.key);
              const sidebarRecentOrder = recentKeys.length > 0
                ? buildInitialSidebarRecentOrder(recentSessions, sessionLastActivity)
                : [];
              return {
                sessions: labeledSessions,
                currentSessionKey: nextSessionKey,
                currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
                sessionLastActivity,
                sessionLabels: scrubCorruptedSessionLabels(state.sessionLabels),
                activatingScheduledSessionAt,
                sidebarRecentOrder,
              };
            });

            if (currentSessionKey !== nextSessionKey) {
              void get().loadHistory();
            }

            // Background: hydrate sidebar titles from history (retries until Gateway is ready).
            scheduleSessionLabelHydrationFromStore(set, get);
          }
        } catch (err) {
          console.warn('Failed to load sessions:', err);
        } finally {
          _lastLoadSessionsAt = Date.now();
        }
      })();

      try {
        await _loadSessionsInFlight;
      } finally {
        _loadSessionsInFlight = null;
      }
    },

    // ── Delete session ──
    //
    // NOTE: The OpenClaw Gateway does NOT expose a sessions.delete (or equivalent)
    // RPC — confirmed by inspecting client.ts, protocol.ts and the full codebase.
    // Deletion is therefore a local-only UI operation: the session is removed from
    // the sidebar list and its labels/activity maps are cleared.  The underlying
    // JSONL history file on disk is intentionally left intact, consistent with the
    // newSession() design that avoids sessions.reset to preserve history.

    deleteSession: async (key: string, options?: {
      skipSessionRefresh?: boolean;
      additionalSuppressKeys?: string[];
    }) => {
      const session = get().sessions.find((item) => item.key === key);
      const deleteResult = await requestSessionDelete(
        key,
        resolveSessionDeleteEngineType(
          key,
          session,
          getAgentEngineType(get().currentAgentId ?? getAgentIdFromSessionKey(key)),
        ),
      );
      if (!deleteResult.success) {
        console.warn(`[deleteSession] IPC reported failure for ${key}:`, deleteResult.error);
        notifySessionDeleteFailed(deleteResult.error);
        return false;
      }

      rememberOptimisticDeletedSessionKey(key);
      void import('@/stores/session-catalog').then(({ useSessionCatalogStore }) => {
        void useSessionCatalogStore.getState().softDeleteSession(key);
      });
      const additionalSuppressKeys = (options?.additionalSuppressKeys ?? [])
        .map((suppressKey) => suppressKey.trim())
        .filter((suppressKey) => suppressKey && suppressKey !== key);
      for (const suppressKey of additionalSuppressKeys) {
        rememberOptimisticDeletedSessionKey(suppressKey);
      }
      if (additionalSuppressKeys.length > 0) {
        await Promise.all(additionalSuppressKeys.map(async (suppressKey) => {
          const suppressSession = get().sessions.find((item) => item.key === suppressKey);
          try {
            await requestSessionDelete(
              suppressKey,
              resolveSessionDeleteEngineType(
                suppressKey,
                suppressSession,
                getAgentEngineType(getAgentIdFromSessionKey(suppressKey)),
              ),
            );
          } catch {
            // Best-effort tombstone for virtual placeholder keys.
          }
        }));
      }

      useSessionUnreadStore.getState().markSessionRead(key);
      clearSessionRuntimeTimers(key);
      clearSessionRunLifecycle(key);
      clearSessionSendReadiness(key);

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((s) => s.key !== key);

      if (currentSessionKey === key) {
        const next = remaining[0];
        set((s) => ({
          sessions: remaining,
          runtimeBySessionKey: clearSessionEntryFromMap(s.runtimeBySessionKey, key),
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
          sidebarRecentOrder: removeSidebarRecentOrderKey(s.sidebarRecentOrder, key),
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingMessages: [],
          streamingToolResults: [],
          streamingTools: [],
          activeRunId: null,
          sendAcceptance: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          optimisticUserMessage: null,
          pendingToolImages: [],
          currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
          currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
        }));
        if (next) {
          get().loadHistory();
        }
      } else {
        set((s) => ({
          sessions: remaining,
          runtimeBySessionKey: clearSessionEntryFromMap(s.runtimeBySessionKey, key),
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
          sidebarRecentOrder: removeSidebarRecentOrderKey(s.sidebarRecentOrder, key),
        }));
      }
      if (!options?.skipSessionRefresh) {
        await get().loadSessions({ force: true });
      }
      return true;
    },

    // ── New session ──

    newSession: (options?: { projectId?: string; materialize?: boolean }) => {
      // Generate a new unique session key and switch to it.
      // NOTE: We intentionally do NOT call sessions.reset on the old session.
      // sessions.reset archives (renames) the session JSONL file, making old
      // conversation history inaccessible when the user switches back to it.
      const { currentSessionKey, messages, sessions, sessionLastActivity, sessionLabels } = get();
      // 仅将没有任何历史记录且无活动时间的会话视为空会话
      const leavingEmpty = isTemporaryAgentSessionKey(currentSessionKey)
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      const projectId = (options?.projectId ?? get().pendingProjectId ?? undefined)?.trim();
      const shouldMaterialize = options?.materialize === true || !projectId;
      const currentAgentId = get().currentAgentId || getAgentIdFromSessionKey(currentSessionKey);
      const baseAgentId = getBaseAgentIdFromProjectAgentId(currentAgentId) ?? currentAgentId ?? 'main';

      // A project-level "new chat" is only a renderer draft until the first send.
      // This avoids empty catalog rows while still carrying project/agent/model context.
      if (projectId && projectId !== 'default' && !shouldMaterialize) {
        const draftAgentId = resolveProjectAgentId(projectId, baseAgentId);
        set((s) => {
          const nextRuntimeBySessionKey = {
            ...s.runtimeBySessionKey,
            [currentSessionKey]: captureTopLevelRuntime(s),
            [DEFAULT_SESSION_KEY]: createIdleSessionRuntimeState(),
          };
          if (leavingEmpty) delete nextRuntimeBySessionKey[currentSessionKey];
          return {
            currentSessionKey: DEFAULT_SESSION_KEY,
            currentAgentId: draftAgentId,
            pendingProjectId: projectId,
            sessions: leavingEmpty
              ? s.sessions.filter((session) => session.key !== currentSessionKey)
              : s.sessions,
            runtimeBySessionKey: nextRuntimeBySessionKey,
            sessionLabels: leavingEmpty
              ? clearSessionEntryFromMap(s.sessionLabels, currentSessionKey)
              : s.sessionLabels,
            sessionLastActivity: leavingEmpty
              ? clearSessionEntryFromMap(s.sessionLastActivity, currentSessionKey)
              : s.sessionLastActivity,
            sidebarRecentOrder: leavingEmpty
              ? removeSidebarRecentOrderKey(s.sidebarRecentOrder, currentSessionKey)
              : s.sidebarRecentOrder,
            messages: [],
            sending: false,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: [],
            streamingToolResults: [],
            streamingTools: [],
            activeRunId: null,
            sendAcceptance: null,
            error: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            optimisticUserMessage: null,
            pendingToolImages: [],
            pendingWorkflow: null,
          };
        });
        touchSessionReadAt(DEFAULT_SESSION_KEY);
        clearSessionSendReadiness(DEFAULT_SESSION_KEY);
        const projectAgentReadiness = import('@/lib/session-catalog-api').then(async ({
          ensureProjectAgentForWorkspace,
        }) => {
          await ensureProjectAgentForWorkspace({
            workspaceId: projectId,
            baseAgentId,
          });
          await useAgentsStore.getState().fetchAgents().catch(() => undefined);
        });
        registerSessionSendReadiness(DEFAULT_SESSION_KEY, projectAgentReadiness);
        if (leavingEmpty) clearSessionSendReadiness(currentSessionKey);
        return;
      }

      const newAgentId = projectId
        && projectId !== 'default'
        ? resolveProjectAgentId(projectId, baseAgentId)
        : getAgentIdFromSessionKey(`${
          getCanonicalPrefixFromSessionKey(currentSessionKey)
            ?? getCanonicalPrefixFromSessions(sessions)
            ?? DEFAULT_CANONICAL_PREFIX
        }:session-${Date.now()}`);
      const newKey = createTemporaryAgentSessionKey(newAgentId);
      // Carry over model from home/default session or Claude agent toolbar selection
      let currentSessionModel = get().pendingNewSessionModel
        ?? (currentSessionKey !== DEFAULT_SESSION_KEY
          ? sessions.find((s) => s.key === currentSessionKey)?.model
          : undefined);
      if (!currentSessionModel?.trim()) {
        const carryAgent = useAgentsStore.getState().agents.find(
          (agent) => agent.id === (getAgentIdFromSessionKey(currentSessionKey) ?? get().currentAgentId),
        );
        if (carryAgent?.engineType === 'claude' && isConcreteModelId(carryAgent.modelDisplay)) {
          currentSessionModel = normalizeModelIdForChat(carryAgent.modelDisplay);
        }
      }
      const newSessionEntry: ChatSession = {
        key: newKey,
        label: NEW_SESSION_TEMP_LABEL,
        engineType: getAgentEngineType(newAgentId),
        ...(currentSessionModel ? { model: currentSessionModel } : {}),
      };
      const createdAtMs = Date.now();
      set((s) => {
        const nextRuntimeBySessionKey = {
          ...s.runtimeBySessionKey,
          [currentSessionKey]: captureTopLevelRuntime(s),
        };
        if (leavingEmpty) {
          delete nextRuntimeBySessionKey[currentSessionKey];
        }
        nextRuntimeBySessionKey[newKey] = createIdleSessionRuntimeState();
        const nextSessions = [
          ...(leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions),
          newSessionEntry,
        ];
        const nextSessionLastActivity = {
          ...(leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
            : s.sessionLastActivity),
          [newKey]: createdAtMs,
        };
        const recentSessions = nextSessions.filter((session) => isSidebarRecentChatSessionKey(session.key));
        return {
          currentSessionKey: newKey,
          currentAgentId: newAgentId,
          pendingProjectId: null,
          sessions: nextSessions,
          runtimeBySessionKey: nextRuntimeBySessionKey,
          sessionLabels: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
            : s.sessionLabels,
          sessionLastActivity: nextSessionLastActivity,
          sidebarRecentOrder: buildInitialSidebarRecentOrder(recentSessions, nextSessionLastActivity),
          messages: [],
          sending: false,
          streamingText: '',
          streamingMessage: null,
          streamingMessages: [],
          streamingToolResults: [],
          streamingTools: [],
          activeRunId: null,
          sendAcceptance: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          optimisticUserMessage: null,
          pendingToolImages: [],
          pendingWorkflow: null,
        };
      });
      // 新建即视为已读，写入已读水位；后续该会话前台完成的迟到事件不会误标未读。
      touchSessionReadAt(newKey);
      const syncModel = () => currentSessionModel?.trim()
        ? syncSessionModelToGateway(newKey, currentSessionModel, newAgentId)
        : applyWorkspaceDefaultToNewSession(newKey, newAgentId);
      const setupPromise = projectId && projectId !== 'default'
        ? import('@/stores/session-catalog').then(async ({ useSessionCatalogStore }) => {
          await useSessionCatalogStore.getState().bindSession(newKey, projectId);
          await syncModel();
        })
        : syncModel();
      if (projectId && projectId !== 'default') {
        transferSessionSendReadiness(DEFAULT_SESSION_KEY, newKey);
      }
      registerSessionSendReadiness(newKey, setupPromise);
      if (leavingEmpty) clearSessionSendReadiness(currentSessionKey);
    },

  };
}
