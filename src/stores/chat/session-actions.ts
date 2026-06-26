import { applyWorkspaceDefaultToNewSession } from '@/lib/sync-workspace-default-to-chat';
import { isConcreteModelId, normalizeModelIdForChat } from '@/lib/chat-model-options';
import { isHiddenStoTaskSubitemChatSessionKey } from '@/lib/sto-task-session';
import { hostApiFetch } from '@/lib/host-api';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import { useAgentsStore } from '@/stores/agents';
import {
  getCanonicalPrefixFromSessions,
  getMessageText,
  mergeSessionLastActivity,
  sanitizeSessionDisplayField,
  toMs,
} from './helpers';
import { DEFAULT_CANONICAL_PREFIX, DEFAULT_SESSION_KEY, type ChatSession, type RawMessage } from './types';
import {
  parseClaudeScheduledTaskRunSessionKey,
  parseClaudeScheduledTaskSessionKey,
  parseCronSessionKey,
  parseScheduledTaskAgentSessionKey,
  parseScheduledTaskSessionKey,
} from './cron-session-utils';
import { deriveSessionLabelFromHistory, isCorruptedSessionLabel, truncateSessionLabel } from '@/lib/workflow-session-hint';
import { buildSessionLabelDerivationOptions, applyStoredSessionLabels, hasUsableSessionTitle, scrubCorruptedSessionLabels, shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

const NEW_SESSION_TEMP_LABEL = '新对话';
const SESSION_METADATA_HISTORY_LIMIT = 2;
const SESSION_METADATA_HYDRATE_LIMIT = 40;
const SESSION_METADATA_HYDRATE_CONCURRENCY = 4;

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function getSessionEngineType(session: ChatSession | undefined): ChatSession['engineType'] | undefined {
  return session?.engineType;
}

function isTemporaryAgentSessionKey(key: string): boolean {
  return /^agent:[^:]+:session-\d+/.test(key);
}

function parseSessionUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  }));
}

export function createSessionActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadSessions' | 'switchSession' | 'newSession' | 'deleteSession' | 'cleanupEmptySession'> {
  return {
    loadSessions: async () => {
      try {
        let rawSessions: Record<string, unknown>[] = [];
        const result = await hostApiFetch<{ success?: boolean; sessions?: Record<string, unknown>[] }>('/api/chat/sessions');
        rawSessions = Array.isArray(result.sessions) ? result.sessions : [];

        // Also load scheduled task sessions from local filesystem
        try {
          const stResult = await hostApiFetch<{ sessions?: Array<{ key: string; label: string; updatedAt?: number }> }>(
            '/api/scheduled-tasks/sessions',
          );
          if (stResult.sessions) {
            rawSessions = [...rawSessions, ...stResult.sessions];
          }
        } catch (err) {
          console.warn('Failed to load scheduled task sessions:', err);
        }

        try {
          const claudeTaskResult = await hostApiFetch<{
            sessions?: Array<{ key: string; label: string; updatedAt?: number; engineType?: 'claude' }>;
          }>('/api/claude-scheduled-tasks/sessions');
          if (claudeTaskResult.sessions) {
            rawSessions = [...rawSessions, ...claudeTaskResult.sessions];
          }
        } catch (err) {
          console.warn('Failed to load Claude scheduled task sessions:', err);
        }

        // Also load cron dated sessions from local filesystem (Gateway may prune old ones)
        try {
          const cronResult = await hostApiFetch<{ sessions?: Array<{ key: string; label: string; updatedAt?: number }> }>(
            '/api/cron/sessions',
          );
          if (cronResult.sessions) {
            rawSessions = [...rawSessions, ...cronResult.sessions];
          }
        } catch (err) {
          console.warn('Failed to load cron sessions:', err);
        }

        // If a local cron job has virtual dated sessions, drop its base session
        // from Gateway to avoid duplicate entries in the sidebar.
        // Also drop run sessions when the job already has dated sessions — the run
        // session's runtime state will be mapped to the aggregate session key.
        const cronJobIdsWithDates = new Set<string>();
        for (const s of rawSessions) {
          const key = String(s.key || '');
          const parsed = parseCronSessionKey(key);
          if (parsed?.date) {
            cronJobIdsWithDates.add(parsed.jobId);
          }
        }
        if (cronJobIdsWithDates.size > 0) {
          rawSessions = rawSessions.filter((s) => {
            const key = String(s.key || '');
            const parsed = parseCronSessionKey(key);
            if (parsed && !parsed.date && !parsed.runSessionId && cronJobIdsWithDates.has(parsed.jobId)) {
              return false;
            }
            // Filter out run sessions when the job has dated aggregate sessions
            if (parsed?.runSessionId && cronJobIdsWithDates.has(parsed.jobId)) {
              return false;
            }
            return true;
          });
        }

        const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => {
          const key = String(s.key || '');
          const engineType: ChatSession['engineType'] = s.engineType === 'claude' ? 'claude' : 'openclaw';
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
        }).filter((s) => Boolean(s.key)) as ChatSession[];

        const canonicalBySuffix = new Map<string, string>();
        for (const session of sessions) {
          if (!session.key.startsWith('agent:')) continue;
          const parts = session.key.split(':');
          if (parts.length < 3) continue;
          const suffix = parts.slice(2).join(':');
          if (suffix && !canonicalBySuffix.has(suffix)) {
            canonicalBySuffix.set(suffix, session.key);
          }
        }

        // Deduplicate: if both short and canonical existed, keep canonical only
        const seen = new Set<string>();
        const dedupedSessions = sessions.filter((s) => {
          if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
          if (seen.has(s.key)) return false;
          seen.add(s.key);
          return true;
        });

        const { currentSessionKey, sessions: localSessions, sessionLastActivity, sessionLabels } = get();
        let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
        if (!nextSessionKey.startsWith('agent:')) {
          const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
          if (canonicalMatch) {
            nextSessionKey = canonicalMatch;
          }
        }
        if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
          // Keep locally-created pending sessions even after the first optimistic send.
          const hasLocalPendingSession =
            isTemporaryAgentSessionKey(nextSessionKey)
            || isHiddenStoTaskSubitemChatSessionKey(nextSessionKey)
            || localSessions.some((session) => session.key === nextSessionKey);
          if (!hasLocalPendingSession) {
            nextSessionKey = dedupedSessions[0].key;
          }
        }

        const hasLocalPendingSession = localSessions.some((session) => session.key === nextSessionKey);
        const hasLocalSessionActivity = Boolean(sessionLastActivity[nextSessionKey] || sessionLabels[nextSessionKey]);
        const shouldAppendCurrentSession = Boolean(
          nextSessionKey
          && !dedupedSessions.find((s) => s.key === nextSessionKey)
          && (hasLocalPendingSession || hasLocalSessionActivity),
        );
        const localCurrentSession = localSessions.find((session) => session.key === nextSessionKey);
        const sessionsWithCurrent = shouldAppendCurrentSession
          ? [...dedupedSessions, {
            key: nextSessionKey,
            label: localCurrentSession?.label ?? NEW_SESSION_TEMP_LABEL,
            engineType: localCurrentSession?.engineType,
            model: localCurrentSession?.model,
          }]
          : dedupedSessions;

        const scrubbedSessionLabels = scrubCorruptedSessionLabels(get().sessionLabels);
        const labeledSessions = applyStoredSessionLabels(sessionsWithCurrent, scrubbedSessionLabels);

        const discoveredActivity = Object.fromEntries(
          labeledSessions
            .filter((session) => typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt))
            .map((session) => [session.key, session.updatedAt!]),
        );

        // ------------------------------------------------------------------
        // 定时任务会话 label：按执行日期命名；同时保留任务原始名称到 displayName
        // ------------------------------------------------------------------
        // 1) 先获取任务名称并写入 displayName（供侧边栏分组名称使用）
        try {
          const jobsResult = await hostApiFetch<Array<{ id: string; name: string }>>('/api/cron/jobs');
          const jobNameMap = new Map(jobsResult.map((j) => [j.id, j.name]));

          // Identify cron sessions whose name was not resolved from the
          // Gateway-backed /api/cron/jobs list — these will be resolved
          // from the local cron/jobs.json fallback below.
          const unresolvedCronJobIds = new Set<string>();
          for (const session of sessionsWithCurrent) {
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

          // Fallback: if any cron session name was not resolved from the
          // Gateway, read names from the local cron/jobs.json file. This
          // handles the race window where /api/cron/jobs is temporarily
          // empty (e.g. during a cron.trigger provider-sync re-init).
          if (unresolvedCronJobIds.size > 0) {
            try {
              const fallbackJobs = await hostApiFetch<Array<{ id: string; name: string }>>('/api/cron/local-job-names');
              const fallbackMap = new Map(fallbackJobs.map((j) => [j.id, j.name]));
              for (const session of sessionsWithCurrent) {
                const parsed = parseCronSessionKey(session.key);
                if (parsed && unresolvedCronJobIds.has(parsed.jobId) && !session.displayName) {
                  const fallbackName = fallbackMap.get(parsed.jobId);
                  if (fallbackName) session.displayName = fallbackName;
                }
              }
            } catch {
              // Fallback is best-effort; ignore errors.
            }
          }
        } catch {
          // Ignore cron name enrichment failure
        }

        try {
          const tasksResult = await hostApiFetch<Array<{ id: number; name: string }>>('/api/scheduled-tasks');
          const taskNameMap = new Map(tasksResult.map((t) => [t.id, t.name]));
          for (const session of sessionsWithCurrent) {
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

        try {
          const tasksResult = await hostApiFetch<Array<{ id: string; name: string }>>('/api/claude-scheduled-tasks');
          const taskNameMap = new Map(tasksResult.map((task) => [task.id, task.name]));
          for (const session of sessionsWithCurrent) {
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

        // 2) 再按日期生成 label
        const taskSessionDayCounts = new Map<string, number>();
        for (const session of sessionsWithCurrent) {
          const cronParsed = parseCronSessionKey(session.key);
          const stParsed = parseScheduledTaskAgentSessionKey(session.key);
          const claudeRunParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
          const claudeDatedParsed = parseClaudeScheduledTaskSessionKey(session.key);
          let taskId: string | undefined;
          const ts = session.updatedAt;
          if (cronParsed) {
            taskId = `cron:${cronParsed.jobId}`;
          } else if (stParsed) {
            taskId = `st:${stParsed.taskId}`;
          } else if (claudeDatedParsed?.date) {
            taskId = `claude-task:${claudeDatedParsed.taskId}`;
          } else if (claudeRunParsed) {
            taskId = `claude-task:${claudeRunParsed.taskId}`;
          }
          if (taskId && ts) {
            const d = new Date(ts);
            const dateKey = `${taskId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            taskSessionDayCounts.set(dateKey, (taskSessionDayCounts.get(dateKey) ?? 0) + 1);
          }
        }

        for (const session of sessionsWithCurrent) {
          const cronParsed = parseCronSessionKey(session.key);
          const stParsed = parseScheduledTaskAgentSessionKey(session.key);
          const claudeRunParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
          const claudeDatedParsed = parseClaudeScheduledTaskSessionKey(session.key);
          let taskId: string | undefined;
          const ts = session.updatedAt;
          if (cronParsed) {
            taskId = `cron:${cronParsed.jobId}`;
          } else if (stParsed) {
            taskId = `st:${stParsed.taskId}`;
          } else if (claudeDatedParsed?.date) {
            taskId = `claude-task:${claudeDatedParsed.taskId}`;
          } else if (claudeRunParsed) {
            taskId = `claude-task:${claudeRunParsed.taskId}`;
          }
          if (taskId && ts) {
            const d = new Date(ts);
            const dateKey = `${taskId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const hasMultiple = (taskSessionDayCounts.get(dateKey) ?? 0) > 1;
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            if (hasMultiple) {
              const h = String(d.getHours()).padStart(2, '0');
              const min = String(d.getMinutes()).padStart(2, '0');
              const s = String(d.getSeconds()).padStart(2, '0');
              session.label = `${y}年${m}月${day}日${h}时${min}分${s}秒 的材料`;
            } else {
              session.label = `${y}年${m}月${day}日 的材料`;
            }
          }
        }

        set((state) => ({
          sessions: labeledSessions,
          currentSessionKey: nextSessionKey,
          currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
          sessionLastActivity: mergeSessionLastActivity(state.sessionLastActivity, discoveredActivity),
          sessionLabels: scrubCorruptedSessionLabels(state.sessionLabels),
        }));

        if (currentSessionKey !== nextSessionKey) {
          await get().loadHistory();
        }

        // Background: hydrate only the first screen of missing metadata.
        // Avoid N * full-history fan-out when many sessions exist.
        const sessionsToHydrate = labeledSessions
          .filter((session) => {
            if (session.key.endsWith(':main')) return false;
            const hasActivity = Boolean(session.updatedAt || get().sessionLastActivity[session.key]);
            return !hasUsableSessionTitle(session, scrubbedSessionLabels) || !hasActivity;
          })
          .sort((left, right) => {
            const leftAt = left.updatedAt ?? get().sessionLastActivity[left.key] ?? 0;
            const rightAt = right.updatedAt ?? get().sessionLastActivity[right.key] ?? 0;
            return rightAt - leftAt;
          })
          .slice(0, SESSION_METADATA_HYDRATE_LIMIT);
        if (sessionsToHydrate.length > 0) {
          void runLimited(sessionsToHydrate, SESSION_METADATA_HYDRATE_CONCURRENCY, async (session) => {
              try {
                const history = await hostApiFetch<{ success?: boolean; result?: { messages?: RawMessage[] } }>(
                  `/api/chat/history?sessionKey=${encodeURIComponent(session.key)}&limit=${SESSION_METADATA_HISTORY_LIMIT}`
                  + (getSessionEngineType(session) ? `&engineType=${encodeURIComponent(getSessionEngineType(session)!)}`
                    : ''),
                );
                const msgs = Array.isArray(history.result?.messages) ? history.result.messages : [];
                const lastMsg = msgs[msgs.length - 1];
                set((s) => {
                  const next: Partial<typeof s> = {};
                  if (shouldAutoDeriveSessionLabel(session.key, s.sessionLabels, isCorruptedSessionLabel)) {
                    const labelText = deriveSessionLabelFromHistory(
                      msgs,
                      getMessageText,
                      buildSessionLabelDerivationOptions(session.key, s.sessions, s.sessionLabels),
                    );
                    if (labelText) {
                      next.sessionLabels = {
                        ...s.sessionLabels,
                        [session.key]: truncateSessionLabel(labelText),
                      };
                    }
                  }
                  if (lastMsg?.timestamp) {
                    const lastAt = toMs(lastMsg.timestamp);
                    if (lastAt > 0) {
                      const currentAt = s.sessionLastActivity[session.key] ?? 0;
                      const nextAt = Math.max(currentAt, lastAt);
                      if (nextAt !== currentAt) {
                        next.sessionLastActivity = { ...s.sessionLastActivity, [session.key]: nextAt };
                      }
                    }
                  }
                  return next;
                });
              } catch { /* ignore per-session errors */ }
            });
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
      }
    },

    // ── Switch session ──

    switchSession: (key: string) => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // 仅将没有任何历史记录且无活动时间的会话视为空会话。
      // 单纯依赖 messages.length 是不可靠的，因为 switchSession 会在真正调用 loadHistory 前抢先清空当前 messages，
      // 造成竞争条件，使得带有真实历史的会话被判定为空并从侧边栏移除。
      const leavingEmpty = isTemporaryAgentSessionKey(currentSessionKey)
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      set((s) => ({
        currentSessionKey: key,
        currentAgentId: getAgentIdFromSessionKey(key),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        ...(leavingEmpty ? {
          sessions: s.sessions.filter((s) => s.key !== currentSessionKey),
          sessionLabels: Object.fromEntries(
            Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
          ),
          sessionLastActivity: Object.fromEntries(
            Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
          ),
        } : {}),
      }));
      void (async () => {
        await get().loadHistory();
      })();
    },

    // ── Delete session ──
    //
    // NOTE: The OpenClaw Gateway does NOT expose a sessions.delete (or equivalent)
    // RPC — confirmed by inspecting client.ts, protocol.ts and the full codebase.
    // Deletion is therefore a local-only UI operation: the session is removed from
    // the sidebar list and its labels/activity maps are cleared.  The underlying
    // JSONL history file on disk is intentionally left intact, consistent with the
    // newSession() design that avoids sessions.reset to preserve history.

    deleteSession: async (key: string) => {
      // Soft-delete the session's JSONL transcript on disk.
      // The main process renames <suffix>.jsonl → <suffix>.deleted.jsonl so that
      // sessions.list skips it automatically.
      try {
        const session = get().sessions.find((item) => item.key === key);
        const agent = useAgentsStore.getState().agents.find((item) => item.id === get().currentAgentId);
        const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/sessions/delete', {
          method: 'POST',
          body: JSON.stringify({
            sessionKey: key,
            engineType: resolveChatSessionEngineType(session, agent?.engineType, key),
          }),
        });
        const typedResult = result as {
          success: boolean;
          error?: string;
        };
        if (!typedResult.success) {
          console.warn(`[deleteSession] API reported failure for ${key}:`, typedResult.error);
        }
      } catch (err) {
        console.warn(`[deleteSession] API call failed for ${key}:`, err);
      }

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((s) => s.key !== key);

      if (currentSessionKey === key) {
        // Switched away from deleted session — pick the first remaining or create new
        const next = remaining[0];
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
          currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
        }));
        if (next) {
          await get().loadHistory();
        }
      } else {
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        }));
      }
    },

    // ── New session ──
    // NOTE: Runtime store is src/stores/chat.ts (monolithic). Keep logic in sync when refactoring.

    newSession: async () => {
      const { currentSessionKey, messages, sessions, sessionLastActivity, sessionLabels } = get();
      const leavingEmpty = isTemporaryAgentSessionKey(currentSessionKey)
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      const prefix = getCanonicalPrefixFromSessions(sessions) ?? DEFAULT_CANONICAL_PREFIX;
      const newKey = `${prefix}:session-${Date.now()}`;
      const newAgentId = getAgentIdFromSessionKey(newKey);
      const pendingModel = get().pendingNewSessionModel?.trim();
      let chosenModel = pendingModel;
      if (!chosenModel) {
        if (currentSessionKey !== DEFAULT_SESSION_KEY) {
          chosenModel = sessions.find((s) => s.key === currentSessionKey)?.model?.trim();
        } else {
          const carryAgent = useAgentsStore.getState().agents.find(
            (agent) => agent.id === get().currentAgentId,
          );
          if (carryAgent?.engineType === 'claude' && isConcreteModelId(carryAgent.modelDisplay)) {
            chosenModel = normalizeModelIdForChat(carryAgent.modelDisplay);
          }
        }
      }
      const agentEngineType = useAgentsStore.getState().agents
        .find((agent) => agent.id.trim().toLowerCase() === newAgentId.trim().toLowerCase())?.engineType;
      const newSessionEntry: ChatSession = {
        key: newKey,
        label: NEW_SESSION_TEMP_LABEL,
        engineType: agentEngineType,
        ...(chosenModel ? { model: chosenModel } : {}),
      };
      set((s) => ({
        currentSessionKey: newKey,
        currentAgentId: newAgentId,
        sessions: [
          ...(leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions),
          newSessionEntry,
        ],
        sessionLabels: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
          : s.sessionLabels,
        sessionLastActivity: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
          : s.sessionLastActivity,
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
      }));
      await applyWorkspaceDefaultToNewSession(newKey, newAgentId);
    },

    // ── Cleanup empty session on navigate away ──

    cleanupEmptySession: () => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only remove non-main sessions that were never used (no messages sent).
      // This mirrors the "leavingEmpty" logic in switchSession so that creating
      // a new session and immediately navigating away doesn't leave a ghost entry
      // in the sidebar.
      // 同样需要综合检查 sessionLastActivity 和 sessionLabels，
      // 防止因为 switchSession 抢先清空 messages 而误判有历史的会话为空。
      const isEmptyNonMain = isTemporaryAgentSessionKey(currentSessionKey)
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      if (!isEmptyNonMain) return;
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.key !== currentSessionKey),
        sessionLabels: Object.fromEntries(
          Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
        ),
      }));
    },

    // ── Load chat history ──

  };
}
