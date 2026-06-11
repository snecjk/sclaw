import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../../shared/chat-config';
import {
  getCanonicalPrefixFromSessions,
  getMessageText,
  sanitizeSessionDisplayField,
  toMs,
} from './helpers';
import { DEFAULT_CANONICAL_PREFIX, DEFAULT_SESSION_KEY, type ChatSession, type RawMessage } from './types';
import { parseCronSessionKey, parseScheduledTaskAgentSessionKey, parseScheduledTaskSessionKey } from './cron-session-utils';
import { deriveSessionLabelFromUserText, isCorruptedSessionLabel } from '@/lib/workflow-session-hint';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
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

export function createSessionActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadSessions' | 'switchSession' | 'newSession' | 'deleteSession' | 'cleanupEmptySession'> {
  return {
    loadSessions: async () => {
      try {
        const result = await invokeIpc(
          'gateway:rpc',
          'sessions.list',
          {}
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        let rawSessions: Record<string, unknown>[] = [];
        if (result.success && result.result) {
          const data = result.result;
          rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
        }

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

        const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => {
          const key = String(s.key || '');
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
          };
        }).filter((s: ChatSession) => s.key);

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

        const { currentSessionKey } = get();
        let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
        if (!nextSessionKey.startsWith('agent:')) {
          const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
          if (canonicalMatch) {
            nextSessionKey = canonicalMatch;
          }
        }
        if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
          // Current session not found in the backend list
          const isNewEmptySession = get().messages.length === 0;
          if (!isNewEmptySession) {
            nextSessionKey = dedupedSessions[0].key;
          }
        }

        const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
          ? [...dedupedSessions, { key: nextSessionKey }]
          : dedupedSessions;

        const discoveredActivity = Object.fromEntries(
          sessionsWithCurrent
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
          for (const session of sessionsWithCurrent) {
            const parsed = parseCronSessionKey(session.key);
            if (parsed) {
              const name = jobNameMap.get(parsed.jobId);
              if (name) session.displayName = name;
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

        // 2) 再按日期生成 label
        const taskSessionDayCounts = new Map<string, number>();
        for (const session of sessionsWithCurrent) {
          const cronParsed = parseCronSessionKey(session.key);
          const stParsed = parseScheduledTaskAgentSessionKey(session.key);
          let taskId: string | undefined;
          const ts = session.updatedAt;
          if (cronParsed) {
            taskId = `cron:${cronParsed.jobId}`;
          } else if (stParsed) {
            taskId = `st:${stParsed.taskId}`;
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
          let taskId: string | undefined;
          const ts = session.updatedAt;
          if (cronParsed) {
            taskId = `cron:${cronParsed.jobId}`;
          } else if (stParsed) {
            taskId = `st:${stParsed.taskId}`;
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
          sessions: sessionsWithCurrent,
          currentSessionKey: nextSessionKey,
          currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
          sessionLastActivity: {
            ...state.sessionLastActivity,
            ...discoveredActivity,
          },
        }));

        if (currentSessionKey !== nextSessionKey) {
          get().loadHistory();
        }

        // Background: fetch first user message for every session to populate labels upfront.
        // Uses a small limit so it's cheap; runs in parallel and doesn't block anything.
        const sessionsToLabel = sessionsWithCurrent;
        if (sessionsToLabel.length > 0) {
          void Promise.all(
            sessionsToLabel.map(async (session) => {
              try {
                const r = await invokeIpc(
                  'gateway:rpc',
                  'chat.history',
                  { sessionKey: session.key, limit: CHAT_HISTORY_LENGTH_MAX_LIMIT },
                ) as { success: boolean; result?: Record<string, unknown> };
                if (!r.success || !r.result) return;
                const msgs = Array.isArray(r.result.messages) ? r.result.messages as RawMessage[] : [];
                const firstUser = msgs.find((m) => m.role === 'user');
                const lastMsg = msgs[msgs.length - 1];
                set((s) => {
                  const next: Partial<typeof s> = {};
                  const existingLabel = s.sessionLabels[session.key];
                  if (firstUser && (!existingLabel || isCorruptedSessionLabel(existingLabel))) {
                    const labelText = deriveSessionLabelFromUserText(getMessageText(firstUser.content));
                    if (labelText) {
                      const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
                      next.sessionLabels = { ...s.sessionLabels, [session.key]: truncated };
                    }
                  }
                  if (lastMsg?.timestamp) {
                    next.sessionLastActivity = { ...s.sessionLastActivity, [session.key]: toMs(lastMsg.timestamp) };
                  }
                  return next;
                });
              } catch { /* ignore per-session errors */ }
            }),
          );
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
      const leavingEmpty = !currentSessionKey.endsWith(':main')
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
      get().loadHistory();
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
        const result = await invokeIpc('session:delete', key) as {
          success: boolean;
          error?: string;
        };
        if (!result.success) {
          console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
        }
      } catch (err) {
        console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
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
          get().loadHistory();
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

    newSession: () => {
      // Generate a new unique session key and switch to it.
      // NOTE: We intentionally do NOT call sessions.reset on the old session.
      // sessions.reset archives (renames) the session JSONL file, making old
      // conversation history inaccessible when the user switches back to it.
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // 仅将没有任何历史记录且无活动时间的会话视为空会话
      const leavingEmpty = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      const prefix = getCanonicalPrefixFromSessions(get().sessions) ?? DEFAULT_CANONICAL_PREFIX;
      const newKey = `${prefix}:session-${Date.now()}`;
      const newSessionEntry: ChatSession = { key: newKey };
      set((s) => ({
        currentSessionKey: newKey,
        currentAgentId: getAgentIdFromSessionKey(newKey),
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
      const isEmptyNonMain = !currentSessionKey.endsWith(':main')
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
