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
  parseClaudeScheduledTaskRunSessionKey,
  parseClaudeScheduledTaskSessionKey,
} from './cron-session-utils';
import { sanitizeSessionDisplayField, mergeSessionLastActivity } from './helpers';
import {
  resolveClaudeGroupNameFromSession,
  resolveCronGroupNameFromSession,
} from '@/lib/scheduled-task-group-name';
import {
  appendPendingLocalVirtualTaskSessions,
  filterTaskSidebarCatalogRows,
  findCronDatedTwinKey,
  mergeEngineAndCatalogScheduledTaskSessions,
  omitSupersededCronDatedAgentTwins,
} from '@/stores/chat/session-list-merge';
import { DEFAULT_WORKSPACE_ID, listCatalogSessions } from '@/lib/session-catalog-api';
import { getSessionDisplayMessages } from './display-selectors';
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
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { isWorkflowOpenClawSessionKey } from '../../../shared/workflow-openclaw-session';

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
          // Engine list may fail (Gateway down); catalog task placeholders still feed the sidebar (P2-D).
          let engineRawSessions: Record<string, unknown>[] = [];
          try {
            const data = await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {});
            if (data && Array.isArray(data.sessions)) {
              engineRawSessions = data.sessions.filter((session) => {
                const key = session && typeof session === 'object'
                  ? String((session as Record<string, unknown>).key ?? '')
                  : '';
                return !isWorkflowOpenClawSessionKey(key);
              });
            }
          } catch (err) {
            console.warn('[loadSessions] engine sessions.list failed; continuing with catalog', err);
          }

          const engineSessions: ChatSession[] = engineRawSessions.map((s: Record<string, unknown>) => {
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

          // P2-D: 侧栏任务会话以 catalog 占位补齐（取代已 404 的 /api/cron|claude…/sessions）。
          let catalogRows: Awaited<ReturnType<typeof listCatalogSessions>> = [];
          try {
            catalogRows = await listCatalogSessions(DEFAULT_WORKSPACE_ID);
            useSessionCatalogStore.setState({
              taskCatalogSessions: filterTaskSidebarCatalogRows(catalogRows),
            });
          } catch (err) {
            console.warn('[loadSessions] catalog list failed', err);
          }
          const sessions = mergeEngineAndCatalogScheduledTaskSessions(
            engineSessions,
            catalogRows,
          ) as ChatSession[];

          if (sessions.length > 0) {

            // ── Identify which jobs already have real dated sessions ──
            const cronDated = new Set<string>();
            const claudeTaskDated = new Set<string>();
            // Most-recent dated aggregate key per task/job. Key order is lexicographic
            // == chronological for `...:{YYYY-MM-DD}` suffixes, so the greatest key is
            // today's. Used to redirect an active base/run key to its dated aggregate
            // below, so the dated-supersedes-base rule also governs the active session.
            const claudeTaskDatedKeyByTask = new Map<string, string>();
            const cronDatedKeyByJob = new Map<string, string>();
            for (const session of sessions) {
              const cronParts = parseCronSessionKey(session.key);
              if (cronParts && cronParts.date) {
                cronDated.add(`agent:${cronParts.agentId}:cron:${cronParts.jobId}`);
                const prev = cronDatedKeyByJob.get(cronParts.jobId);
                if (!prev || session.key > prev) {
                  cronDatedKeyByJob.set(cronParts.jobId, session.key);
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

            // ── 定时任务会话名称富化：统一 /api/scheduled-tasks ──
            // startTask 异步时本地占位可能缺 displayName，侧栏会降级成技术 ID。
            try {
              const tasks = await hostApiFetch<
                Array<{ id: string; name: string; engineType: 'openclaw' | 'claude' }>
              >('/api/scheduled-tasks');
              const openclawNames = new Map<string, string>();
              const claudeNames = new Map<string, string>();
              for (const task of tasks) {
                if (!task.id || !task.name?.trim()) continue;
                const name = task.name.trim();
                if (task.engineType === 'claude') claudeNames.set(task.id, name);
                else openclawNames.set(task.id, name);
              }
              for (const session of labeledSessions) {
                const cronParsed = parseCronSessionKey(session.key);
                if (cronParsed) {
                  const name = openclawNames.get(cronParsed.jobId);
                  if (name) session.displayName = name;
                  continue;
                }
                const taskId =
                  parseClaudeScheduledTaskSessionKey(session.key)?.taskId
                  ?? parseClaudeScheduledTaskRunSessionKey(session.key)?.taskId;
                if (!taskId) continue;
                const name = claudeNames.get(taskId);
                if (name) session.displayName = name;
              }
            } catch {
              // Best-effort; fall through to label-based names.
            }

            // Label-based fallback when task API unavailable (401 / HostApi down)
            for (const session of labeledSessions) {
              if (session.displayName?.trim()) continue;
              const cronParsed = parseCronSessionKey(session.key);
              const claudeSummaryParsed = parseClaudeScheduledTaskSessionKey(session.key);
              const claudeRunParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
              const fromLabel = cronParsed
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
                if (!activatingScheduledSessionAt[sessionKey]) continue;
                activatingScheduledSessionAt = { ...activatingScheduledSessionAt };
                delete activatingScheduledSessionAt[sessionKey];
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
      clearSessionSendReadiness(key);
      void import('./runtime-v2-store').then(({ useChatRuntimeV2Store }) => {
        useChatRuntimeV2Store.getState().clearSession(key);
      });

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((s) => s.key !== key);

      if (currentSessionKey === key) {
        const next = remaining[0];
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
          sidebarRecentOrder: removeSidebarRecentOrderKey(s.sidebarRecentOrder, key),
          currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
          currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
        }));
        if (next) {
          get().loadHistory();
        }
      } else {
        set((s) => ({
          sessions: remaining,
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
      const { currentSessionKey, sessions, sessionLastActivity, sessionLabels } = get();
      const messages = getSessionDisplayMessages(currentSessionKey);
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
        set((s) => ({
            currentSessionKey: DEFAULT_SESSION_KEY,
            currentAgentId: draftAgentId,
            pendingProjectId: projectId,
            sessions: leavingEmpty
              ? s.sessions.filter((session) => session.key !== currentSessionKey)
              : s.sessions,
            sessionLabels: leavingEmpty
              ? clearSessionEntryFromMap(s.sessionLabels, currentSessionKey)
              : s.sessionLabels,
            sessionLastActivity: leavingEmpty
              ? clearSessionEntryFromMap(s.sessionLastActivity, currentSessionKey)
              : s.sessionLastActivity,
            sidebarRecentOrder: leavingEmpty
              ? removeSidebarRecentOrderKey(s.sidebarRecentOrder, currentSessionKey)
              : s.sidebarRecentOrder,
          }));
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
      if (projectId && projectId !== 'default') {
        // Optimistic workspace bind before session switch so the first paint
        // already places the row under the project and sidebar can expand it.
        useSessionCatalogStore.setState((catalog) => ({
          sessionWorkspaceByKey: {
            ...catalog.sessionWorkspaceByKey,
            [newKey]: projectId,
          },
        }));
      }
      set((s) => {
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
          sessionLabels: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
            : s.sessionLabels,
          sessionLastActivity: nextSessionLastActivity,
          sidebarRecentOrder: buildInitialSidebarRecentOrder(recentSessions, nextSessionLastActivity),
        };
      });
      // 新建即视为已读，写入已读水位；后续该会话前台完成的迟到事件不会误标未读。
      touchSessionReadAt(newKey);
      const syncModel = () => currentSessionModel?.trim()
        ? syncSessionModelToGateway(newKey, currentSessionModel, newAgentId)
        : applyWorkspaceDefaultToNewSession(newKey, newAgentId);
      const setupPromise = projectId && projectId !== 'default'
        ? Promise.resolve().then(async () => {
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
