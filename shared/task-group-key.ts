/** Sidebar task-list group keys (stable sort + persistence). */

export function cronTaskGroupKey(jobId: string): string {
  return `cron:${jobId}`;
}

export function claudeTaskGroupKey(taskId: string): string {
  return `claude-task:${taskId}`;
}

export function stoBuiltinTaskGroupKey(taskId: string): string {
  return `sto:${taskId}`;
}

const STO_BUILTIN_TASK_IDS = ['hq-reconciliation', 'weekly-ppt'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Map a dated execution session key to its sidebar task-group key.
 * Returns null for keys that are not task-list execution sessions.
 */
export function resolveTaskGroupKeyFromSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('agent:')) {
    const parts = trimmed.split(':');
    if (parts.length >= 5 && parts[2] === 'cron' && YMD.test(parts[4] ?? '')) {
      return cronTaskGroupKey(parts[3] ?? '');
    }
    if (parts.length >= 3 && parts[1] === 'main' && parts[2]?.startsWith('sto-')) {
      const rest = parts[2]!.slice('sto-'.length);
      for (const taskId of STO_BUILTIN_TASK_IDS) {
        const prefix = `${taskId}-`;
        if (rest.startsWith(prefix)) {
          const entryId = rest.slice(prefix.length);
          if (YMD.test(entryId)) return stoBuiltinTaskGroupKey(taskId);
        }
      }
    }
  }

  const claudeDated = trimmed.match(/^claude-task:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  if (claudeDated) return claudeTaskGroupKey(claudeDated[1] ?? '');

  return null;
}
