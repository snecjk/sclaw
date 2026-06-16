import { describe, expect, it } from 'vitest';
import {
  breakdownWorkflowDurationMs,
  getWorkflowDurationMs,
  resolveWorkflowStartedAt,
} from '@/lib/format-workflow-duration';

describe('resolveWorkflowStartedAt', () => {
  const completedAt = '2026-06-10T10:10:00.000Z';
  const localMs = Date.parse('2026-06-10T10:00:00.000Z');
  const localIso = new Date(localMs).toISOString();

  it('prefers local start when API startedAt is near completedAt', () => {
    const apiStartedAt = '2026-06-10T10:09:59.000Z';
    const resolved = resolveWorkflowStartedAt(
      apiStartedAt,
      apiStartedAt,
      localMs,
      completedAt,
    );
    expect(resolved).toBe(localIso);
    expect(getWorkflowDurationMs(resolved, completedAt)).toBe(10 * 60 * 1000);
  });

  it('prefers previous client start when completion arrives before local record exists', () => {
    const clientStartedAt = '2026-06-10T10:00:00.000Z';
    const apiStartedAt = '2026-06-10T10:09:59.500Z';
    const resolved = resolveWorkflowStartedAt(
      clientStartedAt,
      apiStartedAt,
      undefined,
      completedAt,
    );
    expect(resolved).toBe(clientStartedAt);
  });
});

describe('getWorkflowDurationMs', () => {
  it('handles API completedAt without Z when startedAt is UTC', () => {
    const startedAt = '2026-06-15T09:04:33.537Z';
    const completedAt = '2026-06-15T09:11:16';
    const durationMs = getWorkflowDurationMs(startedAt, completedAt);
    expect(durationMs).toBeGreaterThanOrEqual(6 * 60 * 1000);
    expect(durationMs).toBeLessThan(8 * 60 * 1000);
  });
});

describe('breakdownWorkflowDurationMs', () => {
  it('rounds sub-second durations up to at least 1 second', () => {
    expect(breakdownWorkflowDurationMs(200)).toEqual({ kind: 'seconds', seconds: 1 });
  });
});
