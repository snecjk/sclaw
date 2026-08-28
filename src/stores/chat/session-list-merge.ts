import { preferCronDatedSessionKey } from '../../../shared/cron-job-agent';
import { looksLikeTechnicalTaskGroupLabel } from '@/lib/scheduled-task-group-name';
import {
  isClaudeScheduledTaskDatedSessionKey,
  isCronDatedSessionKey,
  isVirtualTaskSessionKey,
  parseCronSessionKey,
  parseClaudeScheduledTaskSessionKey,
  parseClaudeScheduledTaskRunSessionKey,
} from '@/stores/chat/cron-session-utils';

export type SessionListEntry = {
  key: string;
  label?: string;
  displayName?: string;
  engineType?: 'claude' | 'openclaw' | 'pi';
  model?: string;
  updatedAt?: number;
};

/**
 * Keep locally-known virtual task/cron sessions until the backend list materializes them.
 * Without this, switching away from a freshly triggered run drops the session from the
 * sidebar because loadSessions only appended the *current* key before.
 *
 * A base key (e.g. `agent:main:cron:{jobId}` or `claude-task:{taskId}`) or a run key
 * (`…:run:{runId}` / `claude-task-run:…`) represents a more granular view.  Once the
 * daily-aggregate session (`…:{date}`) has materialized on the backend, keeping both in
 * the sidebar would show two same-named entries until a full reload collapses them.
 *
 * This function mirrors the "dated supersedes base/run" dedup that loadSessions applies
 * to the remote list (chat.ts:1287–1324): build sets of jobs/tasks that already have
 * dated aggregates remotely, then suppress any pending local key whose job/task is in
 * those sets.
 */
export function appendPendingLocalVirtualTaskSessions<T extends SessionListEntry>(
  remoteSessions: T[],
  localSessions: T[],
  deletedKeys: ReadonlySet<string>,
): T[] {
  // ── Build sets of jobs/tasks that already have dated aggregate sessions remotely ──
  const cronDatedJobs = new Set<string>();
  const cronDatedJobDates = new Set<string>();
  const claudeTaskDatedIds = new Set<string>();

  for (const session of remoteSessions) {
    const cronParts = parseCronSessionKey(session.key);
    if (cronParts?.date) {
      cronDatedJobs.add(cronParts.jobId);
      cronDatedJobDates.add(`${cronParts.jobId}:${cronParts.date}`);
    }

    const claudeParts = parseClaudeScheduledTaskSessionKey(session.key);
    if (claudeParts?.date) claudeTaskDatedIds.add(claudeParts.taskId);
  }

  const remoteKeySet = new Set(remoteSessions.map((session) => session.key));

  const pending = localSessions.filter((session) => {
    if (remoteKeySet.has(session.key) || deletedKeys.has(session.key)) return false;
    if (!isVirtualTaskSessionKey(session.key)) return false;

    // ── Cron: base & run keys are superseded by any dated aggregate ──
    const cronParts = parseCronSessionKey(session.key);
    // Dated twin under a different agentId (UI ops vs host main) — do not append.
    if (
      cronParts?.date
      && cronDatedJobDates.has(`${cronParts.jobId}:${cronParts.date}`)
    ) {
      return false;
    }
    if (cronParts && !cronParts.date && cronDatedJobs.has(cronParts.jobId)) return false;

    // ── Claude-task: base & run keys are superseded by any dated aggregate ──
    const claudeParts = parseClaudeScheduledTaskSessionKey(session.key);
    if (claudeParts && !claudeParts.date && claudeTaskDatedIds.has(claudeParts.taskId)) return false;

    const claudeRunParts = parseClaudeScheduledTaskRunSessionKey(session.key);
    if (claudeRunParts && claudeTaskDatedIds.has(claudeRunParts.taskId)) return false;

    return true;
  });

  if (pending.length === 0) return remoteSessions;
  return [...remoteSessions, ...pending];
}

/**
 * When the same cron job+date exists under both `main` and a non-main agent (legacy twin),
 * keep one key. Prefer `preferredKey` (current / activating) when present so trigger UX
 * does not show two same-day rows under the task group.
 */
export function omitSupersededCronDatedAgentTwins<T extends SessionListEntry>(
  sessions: T[],
  preferredKey?: string | null,
): T[] {
  const groups = new Map<string, string[]>();
  for (const session of sessions) {
    const cronParts = parseCronSessionKey(session.key);
    if (!cronParts?.date) continue;
    const groupKey = `${cronParts.jobId}:${cronParts.date}`;
    const list = groups.get(groupKey) ?? [];
    list.push(session.key);
    groups.set(groupKey, list);
  }

  const preferred = new Map<string, string>();
  for (const [groupKey, keys] of groups) {
    if (keys.length < 2) continue;
    const keep = preferCronDatedSessionKey(keys, preferredKey);
    if (keep) preferred.set(groupKey, keep);
  }
  if (preferred.size === 0) return sessions;

  return sessions.filter((session) => {
    const cronParts = parseCronSessionKey(session.key);
    if (!cronParts?.date) return true;
    const keep = preferred.get(`${cronParts.jobId}:${cronParts.date}`);
    return !keep || keep === session.key;
  });
}

/** Resolve a cron dated twin already in the list for the same jobId+date (any agent). */
export function findCronDatedTwinKey(
  sessions: Array<{ key: string }>,
  sessionKey: string,
): string | undefined {
  const target = parseCronSessionKey(sessionKey);
  if (!target?.date) return undefined;
  return sessions.find((session) => {
    if (session.key === sessionKey) return false;
    const parts = parseCronSessionKey(session.key);
    return parts?.jobId === target.jobId && parts.date === target.date;
  })?.key;
}

/** catalog_sessions.session_type values that feed the sidebar「任务」section. */
export const TASK_SIDEBAR_CATALOG_TYPES = new Set(['cron', 'claude_task']);

/** @deprecated Use TASK_SIDEBAR_CATALOG_TYPES */
export const SCHEDULED_TASK_CATALOG_TYPES = TASK_SIDEBAR_CATALOG_TYPES;

export type CatalogScheduledTaskRow = {
  sessionKey: string;
  sessionType: string;
  taskId: string | null;
  title?: string | null;
  lastActivityAt?: string | null;
};

/** 按天聚合 key：忽略历史 run/base，只认 dated。 */
export function isDatedTaskSidebarSessionKey(sessionKey: string): boolean {
  return isCronDatedSessionKey(sessionKey) || isClaudeScheduledTaskDatedSessionKey(sessionKey);
}

function taskSidebarDedupeKey(sessionKey: string): string | null {
  const cron = parseCronSessionKey(sessionKey);
  if (cron?.date) return `cron:${cron.jobId}:${cron.date}`;
  const claude = parseClaudeScheduledTaskSessionKey(sessionKey);
  if (claude?.date) return `claude-task:${claude.taskId}:${claude.date}`;
  return null;
}

/**
 * Sidebar「任务」数据源（store 层只做结构化过滤，不按 title 过滤）：
 * - session_type ∈ {cron, claude_task}
 * - key 必须是 dated（过滤历史 run/base）
 * - 同 task+日 多条时保留 lastActivityAt 最新（兼容 agent twin）
 *
 * 无标题行必须保留：title 为 NULL 可能来自迁移/绑定等存量路径（真实会话），
 * store 层滤掉会让其在侧栏彻底无入口，且 loadSessions 的 base/run 抑制与
 * 当前会话重定向依赖这些 dated 行在场。标题可见性由渲染层按
 * 「catalog 标题 → 引擎 label/displayName → 任务定义名」回落判定（见
 * resolveTaskSidebarRowTitles）。
 */
export function isTaskSidebarCatalogRow(row: CatalogScheduledTaskRow): boolean {
  return TASK_SIDEBAR_CATALOG_TYPES.has(row.sessionType)
    && isDatedTaskSidebarSessionKey(row.sessionKey);
}

/** @deprecated Use isTaskSidebarCatalogRow */
export function isLocalScheduledTaskCatalogRow(row: CatalogScheduledTaskRow): boolean {
  return isTaskSidebarCatalogRow(row);
}

export function filterTaskSidebarCatalogRows<T extends CatalogScheduledTaskRow>(rows: T[]): T[] {
  const bestByDay = new Map<string, T>();
  for (const row of rows) {
    if (!isTaskSidebarCatalogRow(row)) continue;
    const dedupeKey = taskSidebarDedupeKey(row.sessionKey);
    if (!dedupeKey) continue;
    const prev = bestByDay.get(dedupeKey);
    if (!prev) {
      bestByDay.set(dedupeKey, row);
      continue;
    }
    const prevMs = prev.lastActivityAt ? Date.parse(prev.lastActivityAt) : 0;
    const nextMs = row.lastActivityAt ? Date.parse(row.lastActivityAt) : 0;
    const prevOk = Number.isFinite(prevMs) ? prevMs : 0;
    const nextOk = Number.isFinite(nextMs) ? nextMs : 0;
    if (nextOk >= prevOk) bestByDay.set(dedupeKey, row);
  }
  return [...bestByDay.values()];
}

function inferEngineTypeFromTaskSessionType(
  sessionType: string,
): SessionListEntry['engineType'] | undefined {
  if (sessionType === 'claude_task') return 'claude';
  if (sessionType === 'cron') return 'openclaw';
  return undefined;
}

function parseCatalogActivityMs(lastActivityAt: string | null | undefined): number | undefined {
  if (!lastActivityAt) return undefined;
  const ms = Date.parse(lastActivityAt);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Catalog task title wins over engine agent-brand / technical labels (e.g. "SClaw"). */
export function preferCatalogTaskTitle(
  catalogTitle: string | null | undefined,
  engineValue?: string,
): string | undefined {
  const catalog = catalogTitle?.trim() || undefined;
  if (catalog && !looksLikeTechnicalTaskGroupLabel(catalog)) return catalog;
  const engine = engineValue?.trim() || undefined;
  if (engine && !looksLikeTechnicalTaskGroupLabel(engine)) return engine;
  return undefined;
}

/**
 * 渲染层行标题回落：catalog 标题 → 引擎 label / displayName → 任务定义名兜底。
 * 三个来源都没有人读标题时返回 undefined，调用方据此过滤真正的空壳行
 * （迁移/绑定路径产生的无标题真实会话可靠任务定义名留在侧栏）。
 * 任务定义名是用户显式命名，不走技术/品牌名过滤——用户把任务命名为
 * 「SClaw」也应原样展示，而不是被品牌正则误伤成空壳。
 */
export function resolveTaskSidebarRowTitles(input: {
  catalogTitle?: string | null;
  engineLabel?: string;
  engineDisplayName?: string;
  taskName?: string;
}): { label?: string; displayName?: string } | undefined {
  const taskName = input.taskName?.trim() || undefined;
  const label = preferCatalogTaskTitle(input.catalogTitle, input.engineLabel)
    ?? taskName;
  const displayName = preferCatalogTaskTitle(input.catalogTitle, input.engineDisplayName)
    ?? taskName;
  if (!label && !displayName) return undefined;
  return { label, displayName };
}

/** 取 catalog 行对应任务的定义名（cron → jobId，claude_task → taskId）。 */
export function resolveCatalogRowTaskName(
  row: CatalogScheduledTaskRow,
  nameMaps: { cron: Map<string, string>; claude: Map<string, string> },
): string | undefined {
  if (row.sessionType === 'cron') {
    const jobId = row.taskId ?? parseCronSessionKey(row.sessionKey)?.jobId ?? null;
    return jobId ? nameMaps.cron.get(String(jobId)) : undefined;
  }
  if (row.sessionType === 'claude_task') {
    const taskId = row.taskId ?? parseClaudeScheduledTaskSessionKey(row.sessionKey)?.taskId ?? null;
    return taskId ? nameMaps.claude.get(String(taskId)) : undefined;
  }
  return undefined;
}

/** Map catalog task rows → sidebar/session-list entries（已按天过滤+去重）. */
export function catalogTaskRowsToSessionEntries(
  catalogRows: CatalogScheduledTaskRow[],
): SessionListEntry[] {
  return filterTaskSidebarCatalogRows(catalogRows).map((row) => {
    const title = preferCatalogTaskTitle(row.title);
    return {
      key: row.sessionKey,
      label: title,
      displayName: title,
      updatedAt: parseCatalogActivityMs(row.lastActivityAt),
      engineType: inferEngineTypeFromTaskSessionType(row.sessionType),
    };
  });
}

/**
 * Merge engine `sessions.list` with catalog task rows (P2-D).
 * Catalog side only contributes dated `cron` / `claude_task` rows.
 * Engine rows win on conflict for runtime fields; catalog title wins over agent-brand labels.
 */
export function mergeEngineAndCatalogScheduledTaskSessions<T extends SessionListEntry>(
  engineSessions: T[],
  catalogRows: CatalogScheduledTaskRow[],
): Array<T | SessionListEntry> {
  const byKey = new Map<string, T | SessionListEntry>();

  for (const entry of catalogTaskRowsToSessionEntries(catalogRows)) {
    byKey.set(entry.key, entry);
  }

  for (const session of engineSessions) {
    const existing = byKey.get(session.key);
    if (!existing) {
      byKey.set(session.key, session);
      continue;
    }
    byKey.set(session.key, {
      ...existing,
      ...session,
      displayName: preferCatalogTaskTitle(existing.displayName, session.displayName),
      label: preferCatalogTaskTitle(existing.label, session.label),
      updatedAt: session.updatedAt ?? existing.updatedAt,
      engineType: session.engineType ?? existing.engineType,
      model: session.model ?? existing.model,
    });
  }

  return [...byKey.values()];
}
