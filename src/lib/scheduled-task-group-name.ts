import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';

const AGENT_TASK_KEY_PATTERN = /^agent:[^:]+:(cron|scheduled-task):/;

/** True when a string should not be shown as a human task group title. */
export function looksLikeTechnicalTaskGroupLabel(value: string, sessionKey?: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (sessionKey && v === sessionKey) return true;
  if (looksLikeTechnicalSessionDisplay(v)) return true;
  if (AGENT_TASK_KEY_PATTERN.test(v)) return true;
  if (/^(claude-task|claude-task-run|scheduled-task):/.test(v)) return true;
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
    return stripCronLabelPrefix(resolved).replace(/^定时任务\s*/i, '').trim() || resolved;
  }

  if (kind === 'claude') return `Claude 定时任务 ${taskId}`;
  return `定时任务 ${taskId}`;
}
