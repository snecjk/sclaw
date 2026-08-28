import {
  isAgentBrandSessionLabel,
  looksLikeTechnicalSessionDisplay,
} from '@/stores/chat/helpers';

const AGENT_TASK_KEY_PATTERN = /^agent:[^:]+:(cron|scheduled-task):/;

/** True when a string should not be shown as a human task group title. */
export function looksLikeTechnicalTaskGroupLabel(value: string, sessionKey?: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (sessionKey && v === sessionKey) return true;
  if (looksLikeTechnicalSessionDisplay(v)) return true;
  if (isAgentBrandSessionLabel(v)) return true;
  if (AGENT_TASK_KEY_PATTERN.test(v)) return true;
  if (/^(claude-task|claude-task-run|pi-task|scheduled-task):/.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
  if (/^\d{4}年\d{2}月\d{2}日/.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  return false;
}

export function pickHumanTaskGroupName(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && !looksLikeTechnicalTaskGroupLabel(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

function stripCronLabelPrefix(label: string): string {
  return label.replace(/^Cron:\s*/i, '').trim();
}

function stripClaudeLabelPrefix(label: string): string {
  return label.replace(/^Claude 定时任务\s*/i, '').trim();
}

export function resolveStoScheduledGroupNameFromSession(session: {
  key: string;
  label?: string;
  displayName?: string;
}): string | undefined {
  return pickHumanTaskGroupName([
    session.displayName,
    session.label?.split(' - ')[0],
  ]);
}

export function resolveCronGroupNameFromSession(session: {
  key: string;
  label?: string;
  displayName?: string;
}): string | undefined {
  const labelClean = session.label ? stripCronLabelPrefix(session.label) : undefined;
  return pickHumanTaskGroupName([session.displayName, labelClean]);
}

export function resolveClaudeGroupNameFromSession(session: {
  key: string;
  label?: string;
  displayName?: string;
}): string | undefined {
  const labelClean = session.label ? stripClaudeLabelPrefix(session.label) : undefined;
  return pickHumanTaskGroupName([session.displayName, labelClean]);
}

export type ScheduledTaskNameMaps = {
  cron: Map<string, string>;
  sto: Map<number, string>;
  claude: Map<string, string>;
};

export function buildScheduledTaskGroupDisplayName(
  kind: 'st' | 'cron' | 'claude',
  taskId: number | string,
  sessions: Array<{ key: string; label?: string; displayName?: string }>,
  nameMaps: ScheduledTaskNameMaps,
): string {
  const mapName =
    kind === 'st'
      ? nameMaps.sto.get(taskId as number)
      : kind === 'cron'
        ? nameMaps.cron.get(String(taskId))
        : nameMaps.claude.get(String(taskId));

  const sessionNames = sessions.map((session) =>
    kind === 'st'
      ? resolveStoScheduledGroupNameFromSession(session)
      : kind === 'cron'
        ? resolveCronGroupNameFromSession(session)
        : resolveClaudeGroupNameFromSession(session),
  );

  const resolved = pickHumanTaskGroupName([mapName, ...sessionNames]);
  if (resolved) {
    return stripCronLabelPrefix(resolved).trim() || resolved;
  }

  if (kind === 'claude') return `Claude 定时任务 ${taskId}`;
  return `定时任务 ${taskId}`;
}

/** Parse YYYY-MM-DD suffix from dated task session keys. */
export function parseDatedSessionKeyMs(sessionKey: string): number | undefined {
  const last = sessionKey.split(':').pop()?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) return undefined;
  const [ys, ms, ds] = last.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  return new Date(y, m - 1, d).getTime();
}

export type SessionRuntimeActivityHint = {
  sending?: boolean;
  activeRunId?: string | null;
  updatedAt?: number;
};

export type SessionActivitySortOptions = {
  runtimeActivityBySessionKey?: Record<string, SessionRuntimeActivityHint | undefined>;
  currentSessionKey?: string | null;
  currentSessionSending?: boolean;
  activatingScheduledSessionAt?: Record<string, number>;
  /** Wall clock for in-flight task ordering; pass from UI to keep sort stable per render. */
  nowMs?: number;
};

function resolveActiveSessionActivityBoost(
  sessionKey: string,
  base: number,
  hasPreciseActivity: boolean,
  options?: SessionActivitySortOptions,
): number {
  const runtime = options?.runtimeActivityBySessionKey?.[sessionKey];
  const runtimeActive = Boolean(runtime?.sending || runtime?.activeRunId);
  const isCurrentSession = options?.currentSessionKey === sessionKey;
  const activatingAt = options?.activatingScheduledSessionAt?.[sessionKey] ?? 0;
  const nowMs = options?.nowMs ?? Date.now();

  if (activatingAt > 0) {
    return Math.max(base, activatingAt);
  }

  if (runtimeActive) {
    const runtimeAt = runtime?.updatedAt && runtime.updatedAt > 0 ? runtime.updatedAt : nowMs;
    return Math.max(base, runtimeAt);
  }

  if (isCurrentSession && options?.currentSessionSending) {
    return Math.max(base, nowMs);
  }

  // switchSession landed before loadSessions / gateway events record activity
  if (isCurrentSession && !hasPreciseActivity) {
    const datedFallback = parseDatedSessionKeyMs(sessionKey) ?? 0;
    if (datedFallback > 0 && base === datedFallback) {
      return Math.max(base, nowMs);
    }
  }

  return base;
}

export function getSessionActivityMs(
  session: { key: string; updatedAt?: number },
  sessionLastActivity: Record<string, number>,
  options?: SessionActivitySortOptions,
): number {
  const fromStore = sessionLastActivity[session.key] ?? 0;
  const fromMeta = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
    ? session.updatedAt
    : 0;
  const precise = [fromStore, fromMeta].filter((t) => t > 0);
  let base: number;
  if (precise.length > 0) {
    // Recent-within-group: prefer the freshest stamp (matches sidebar "最近").
    // First-trigger / earliest semantics stay in getSessionFirstTriggerMs (min).
    base = Math.max(...precise);
  } else {
    base = parseDatedSessionKeyMs(session.key) ?? 0;
  }
  return resolveActiveSessionActivityBoost(session.key, base, precise.length > 0, options);
}

/** First trigger time for one session — no runtime/activating boost (for group-level sort). */
export function getSessionFirstTriggerMs(
  session: { key: string; updatedAt?: number },
  sessionLastActivity: Record<string, number>,
): number {
  const fromStore = sessionLastActivity[session.key] ?? 0;
  const fromMeta = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
    ? session.updatedAt
    : 0;
  const precise = [fromStore, fromMeta].filter((t) => t > 0);
  if (precise.length > 0) {
    return Math.min(...precise);
  }
  return parseDatedSessionKeyMs(session.key) ?? 0;
}

/** Earliest activity derived from current subitems only (no persisted map). */
export function deriveGroupFirstTriggeredFromSessions(
  sessions: Array<{ key: string; updatedAt?: number }>,
  sessionLastActivity: Record<string, number>,
): number {
  let earliest = 0;
  for (const session of sessions) {
    const activity = getSessionFirstTriggerMs(session, sessionLastActivity);
    if (activity <= 0) continue;
    if (earliest === 0 || activity < earliest) earliest = activity;
  }
  return earliest;
}

/** Earliest known activity for a task group ≈ first trigger time (millisecond precision). */
export function getGroupFirstTriggeredAtMs(
  groupKey: string,
  sessions: Array<{ key: string; updatedAt?: number }>,
  sessionLastActivity: Record<string, number>,
  storedFirstTriggeredAt?: Record<string, number>,
): number {
  const stored = storedFirstTriggeredAt?.[groupKey.trim()] ?? 0;
  if (stored > 0) return stored;
  return deriveGroupFirstTriggeredFromSessions(sessions, sessionLastActivity);
}

export type ScheduledTaskSidebarGroupLike = {
  key: string;
  name?: string;
  sessions: Array<{ key: string; updatedAt?: number }>;
};

/** Sort task groups by first-trigger time descending (ms), then stable task/session keys, then name. */
export function sortScheduledTaskGroupsByFirstTriggerDesc<T extends ScheduledTaskSidebarGroupLike>(
  groups: T[],
  sessionLastActivity: Record<string, number>,
  storedFirstTriggeredAt?: Record<string, number>,
): T[] {
  return [...groups].sort((left, right) => {
    const leftFirst = getGroupFirstTriggeredAtMs(left.key, left.sessions, sessionLastActivity, storedFirstTriggeredAt);
    const rightFirst = getGroupFirstTriggeredAtMs(right.key, right.sessions, sessionLastActivity, storedFirstTriggeredAt);
    if (leftFirst === 0 && rightFirst === 0) {
      return compareScheduledTaskGroupTieBreak(left, right);
    }
    if (leftFirst === 0) return 1;
    if (rightFirst === 0) return -1;
    if (rightFirst !== leftFirst) return rightFirst - leftFirst;
    return compareScheduledTaskGroupTieBreak(left, right);
  });
}

function earliestSessionKeyLex(
  sessions: Array<{ key: string }>,
): string {
  if (sessions.length === 0) return '';
  return [...sessions].map((s) => s.key).sort((a, b) => a.localeCompare(b))[0] ?? '';
}

/** Tie-break when first-trigger timestamps are equal (including same millisecond). */
function compareScheduledTaskGroupTieBreak<T extends ScheduledTaskSidebarGroupLike>(left: T, right: T): number {
  const taskIdCmp = left.key.localeCompare(right.key);
  if (taskIdCmp !== 0) return taskIdCmp;
  const sessionKeyCmp = earliestSessionKeyLex(left.sessions).localeCompare(earliestSessionKeyLex(right.sessions));
  if (sessionKeyCmp !== 0) return sessionKeyCmp;
  return (left.name ?? '').localeCompare(right.name ?? '', 'zh-CN');
}
