/** Local calendar YYYY-MM-DD from epoch ms. */
export function activityLocalYmd(updatedAt?: number): string | undefined {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    return undefined;
  }
  const d = new Date(updatedAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDatedCronKey(sessionKey: string): { jobId: string; date: string } | null {
  const match = sessionKey.match(/^agent:[^:]+:cron:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { jobId: match[1], date: match[2] };
}

function parseCronRunKey(sessionKey: string): { jobId: string } | null {
  const match = sessionKey.match(/^agent:[^:]+:cron:([^:]+):run:/);
  if (!match) return null;
  return { jobId: match[1] };
}

function parseDatedClaudeTaskKey(sessionKey: string): { taskId: string; date: string } | null {
  const match = sessionKey.match(/^claude-task:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { taskId: match[1], date: match[2] };
}

function parseClaudeTaskRunKey(sessionKey: string): { taskId: string } | null {
  const match = sessionKey.match(/^claude-task-run:([^:]+):/);
  if (!match) return null;
  return { taskId: match[1] };
}

/**
 * True when a session should be hidden because the user deleted an execution record.
 * Covers exact key matches and related run-session keys for the same job/day.
 */
export function shouldSuppressDeletedExecutionRecord(
  session: { key: string; updatedAt?: number },
  deletedKeys: ReadonlySet<string> | readonly string[],
): boolean {
  const deleted = deletedKeys instanceof Set ? deletedKeys : new Set(deletedKeys);
  if (deleted.has(session.key)) return true;

  const activity = activityLocalYmd(session.updatedAt);

  const cronRun = parseCronRunKey(session.key);
  if (cronRun) {
    for (const delKey of deleted) {
      const dated = parseDatedCronKey(delKey);
      if (dated && dated.jobId === cronRun.jobId && (!activity || activity === dated.date)) {
        return true;
      }
    }
  }

  const claudeRun = parseClaudeTaskRunKey(session.key);
  if (claudeRun) {
    for (const delKey of deleted) {
      const dated = parseDatedClaudeTaskKey(delKey);
      if (dated && dated.taskId === claudeRun.taskId && (!activity || activity === dated.date)) {
        return true;
      }
    }
  }

  return false;
}

export function filterSuppressedExecutionRecords<T extends { key: string; updatedAt?: number }>(
  sessions: T[],
  deletedKeys: ReadonlySet<string> | readonly string[],
): T[] {
  const deleted = deletedKeys instanceof Set ? deletedKeys : new Set(deletedKeys);
  if (deleted.size === 0) return sessions;
  return sessions.filter((session) => !shouldSuppressDeletedExecutionRecord(session, deleted));
}
