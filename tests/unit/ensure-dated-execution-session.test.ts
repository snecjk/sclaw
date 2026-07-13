import { describe, expect, it } from 'vitest';
import {
  buildFirstTriggeredClaudeSessionPlaceholders,
  buildFirstTriggeredCronSessionPlaceholders,
} from '../../electron/utils/ensure-dated-execution-session';

describe('buildFirstTriggeredCronSessionPlaceholders', () => {
  it('adds missing cron dated sessions from first-trigger map', () => {
    const atMs = Date.parse('2026-06-28T10:00:00+08:00');
    const items = buildFirstTriggeredCronSessionPlaceholders(
      { 'cron:job-6': atMs },
      new Set(),
      new Map([['job-6', '测试6号']]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe('agent:main:cron:job-6:2026-06-28');
    expect(items[0]?.displayName).toBe('测试6号');
  });

  it('skips keys already present in the session list', () => {
    const atMs = Date.parse('2026-06-28T10:00:00+08:00');
    const existing = new Set(['agent:main:cron:job-6:2026-06-28']);
    const items = buildFirstTriggeredCronSessionPlaceholders(
      { 'cron:job-6': atMs },
      existing,
      new Map(),
    );
    expect(items).toHaveLength(0);
  });

  it('returns no placeholders when first-trigger map was cleared after last subitem delete', () => {
    const items = buildFirstTriggeredCronSessionPlaceholders({}, new Set(), new Map([['job-6', '测试6号']]));
    expect(items).toHaveLength(0);
  });
});

describe('buildFirstTriggeredClaudeSessionPlaceholders', () => {
  it('adds missing claude dated sessions from first-trigger map', () => {
    const atMs = Date.parse('2026-06-28T12:00:00+08:00');
    const items = buildFirstTriggeredClaudeSessionPlaceholders(
      { 'claude-task:task-1': atMs },
      new Set(),
      new Map([['task-1', '测试5号']]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe('claude-task:task-1:2026-06-28');
    expect(items[0]?.engineType).toBe('claude');
  });
});
