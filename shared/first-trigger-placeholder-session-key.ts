/** Local calendar YYYY-MM-DD from epoch ms (sidebar placeholder session keys). */
export function formatLocalYmdFromMs(atMs: number): string {
  const d = new Date(atMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Session key implied by a persisted task-group first-trigger timestamp.
 * Matches electron `buildFirstTriggered*SessionPlaceholders` date derivation.
 */
export function buildFirstTriggerPlaceholderSessionKey(
  groupKey: string,
  atMs: number,
  agentId = 'main',
): string | null {
  if (!(atMs > 0)) return null;
  const trimmed = groupKey.trim();
  if (!trimmed) return null;
  const date = formatLocalYmdFromMs(atMs);

  if (trimmed.startsWith('cron:')) {
    const jobId = trimmed.slice('cron:'.length).trim();
    return jobId ? `agent:${agentId}:cron:${jobId}:${date}` : null;
  }
  if (trimmed.startsWith('claude-task:')) {
    const taskId = trimmed.slice('claude-task:'.length).trim();
    return taskId ? `claude-task:${taskId}:${date}` : null;
  }
  if (trimmed.startsWith('st:')) {
    const taskId = trimmed.slice('st:'.length).trim();
    return taskId ? `agent:${agentId}:scheduled-task:${taskId}:${date}` : null;
  }

  return null;
}
