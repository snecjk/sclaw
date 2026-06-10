export function parseWorkflowTimestamp(value?: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function getWorkflowDurationMs(
  startedAt?: string,
  completedAt?: string,
  now = Date.now(),
): number | null {
  const startMs = parseWorkflowTimestamp(startedAt);
  if (startMs === null) return null;
  const endMs = completedAt ? parseWorkflowTimestamp(completedAt) : now;
  if (endMs === null) return null;
  return Math.max(0, endMs - startMs);
}

export type WorkflowDurationParts =
  | { kind: 'seconds'; seconds: number }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'halfHour' }
  | { kind: 'hours'; hours: number }
  | { kind: 'hoursHalf'; hours: number }
  | { kind: 'hoursMinutes'; hours: number; remainMinutes: number };

/** Break duration into human-friendly units (4 分钟 / 半小时 / 1 小时). */
export function breakdownWorkflowDurationMs(ms: number): WorkflowDurationParts {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));

  if (totalSeconds < 60) {
    return { kind: 'seconds', seconds: totalSeconds };
  }

  const totalMinutes = Math.round(totalSeconds / 60);

  if (totalMinutes === 30) {
    return { kind: 'halfHour' };
  }

  if (totalMinutes < 60) {
    return { kind: 'minutes', minutes: Math.max(1, totalMinutes) };
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainMinutes = totalMinutes % 60;

  if (remainMinutes === 0) {
    return { kind: 'hours', hours: Math.max(1, hours) };
  }

  if (remainMinutes === 30) {
    return { kind: 'hoursHalf', hours: Math.max(1, hours) };
  }

  return {
    kind: 'hoursMinutes',
    hours: Math.max(1, hours),
    remainMinutes,
  };
}
