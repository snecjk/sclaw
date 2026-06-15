import { describe, expect, it } from 'vitest';
import { normalizeWorkflowTimestamp, parseWorkflowTimestampMs } from '../../shared/workflow-timestamp';

describe('normalizeWorkflowTimestamp', () => {
  it('appends Z to timezone-less ISO datetime', () => {
    expect(normalizeWorkflowTimestamp('2026-06-15T09:11:16')).toBe('2026-06-15T09:11:16Z');
  });

  it('leaves Z-suffixed values unchanged', () => {
    expect(normalizeWorkflowTimestamp('2026-06-15T09:04:33.537Z')).toBe('2026-06-15T09:04:33.537Z');
  });
});

describe('parseWorkflowTimestampMs', () => {
  it('parses mixed API formats consistently as UTC', () => {
    const start = parseWorkflowTimestampMs('2026-06-15T09:04:33.537Z');
    const end = parseWorkflowTimestampMs('2026-06-15T09:11:16');
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(end! - start!).toBeGreaterThan(0);
  });
});
