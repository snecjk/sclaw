import { describe, expect, it } from 'vitest';
import {
  hasMeaningfulToolInput,
  mergeStreamingToolRecords,
  mergeToolInput,
  parseOpenAiArguments,
  parseToolBlockInput,
  resolveToolIdentity,
  resolveToolInputState,
  thinkingTimelineToolIdentityKey,
} from '@/lib/tool-input-merge';

describe('tool-input-merge', () => {
  it('hasMeaningfulToolInput rejects null, empty string, and empty object', () => {
    expect(hasMeaningfulToolInput(null)).toBe(false);
    expect(hasMeaningfulToolInput('')).toBe(false);
    expect(hasMeaningfulToolInput({})).toBe(false);
    expect(hasMeaningfulToolInput({ command: 'ls' })).toBe(true);
  });

  it('mergeToolInput keeps existing when incoming is empty', () => {
    expect(mergeToolInput({ command: 'ls' }, undefined)).toEqual({ command: 'ls' });
    expect(mergeToolInput({ command: 'ls' }, {})).toEqual({ command: 'ls' });
    expect(mergeToolInput({ command: 'ls' }, null)).toEqual({ command: 'ls' });
  });

  it('mergeToolInput prefers meaningful incoming', () => {
    expect(mergeToolInput({ command: 'ls' }, { command: 'pwd' })).toEqual({ command: 'pwd' });
  });

  it('resolveToolInputState marks running empty as unknown', () => {
    expect(resolveToolInputState(null, 'running')).toBe('unknown');
    expect(resolveToolInputState({}, 'completed')).toBe('unknown');
    expect(resolveToolInputState({}, 'completed', { confirmedEmpty: true })).toBe('none');
  });

  it('parseToolBlockInput reads input and arguments', () => {
    expect(parseToolBlockInput({ input: { q: 'x' } })).toEqual({ q: 'x' });
    expect(parseOpenAiArguments('{"cmd":"pwd"}')).toEqual({ cmd: 'pwd' });
  });

  it('resolveToolIdentity excludes input from key', () => {
    expect(resolveToolIdentity({ id: 'toolu_abc', name: 'exec' })).toBe('toolu_abc');
    expect(thinkingTimelineToolIdentityKey({ id: 'toolu_abc', name: 'exec' })).toBe('toolu_abc');
    expect(
      thinkingTimelineToolIdentityKey({ id: 'toolu_abc', name: 'exec' }),
    ).toBe(
      thinkingTimelineToolIdentityKey({ id: 'toolu_abc', name: 'exec' }),
    );
  });

  it('mergeStreamingToolRecords merges input by toolCallId', () => {
    const merged = mergeStreamingToolRecords(
      [{ toolCallId: 'toolu_1', name: 'Bash', input: undefined, status: 'running' }],
      [{ toolCallId: 'toolu_1', name: 'Bash', input: { command: 'curl' }, status: 'completed' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.input).toEqual({ command: 'curl' });
    expect(merged[0]?.status).toBe('completed');
  });
});
