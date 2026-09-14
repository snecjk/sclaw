import { describe, expect, it } from 'vitest';
import type { ToolStatus } from '@/stores/chat';
import {
  APP_DEV_CODE_FOLLOW_IDLE_MS,
  extractLatestAppDevCodeFollowTarget,
  followAppDevLiveTools,
  isAppDevCodeFollowPaused,
} from '@/lib/app-dev-code-follow';

function tool(partial: Partial<ToolStatus> & { name: string }): ToolStatus {
  return { status: 'completed', updatedAt: 1_000, ...partial };
}

describe('extractLatestAppDevCodeFollowTarget', () => {
  it('returns the latest file edit/write path, ignoring reads and commands', () => {
    const target = extractLatestAppDevCodeFollowTarget([
      tool({ name: 'Read', input: { file_path: '/app/src/old.ts' } }),
      tool({
        name: 'Edit',
        toolCallId: 'e1',
        input: { file_path: '/app/src/a.tsx', old_string: 'a', new_string: 'b' },
      }),
      tool({ name: 'Bash', input: { command: 'pnpm build' } }),
      tool({
        name: 'Write',
        toolCallId: 'w1',
        status: 'running',
        input: { file_path: '/app/src/b.tsx', content: 'x' },
      }),
    ]);
    expect(target).toEqual({ path: 'src/b.tsx', key: 'w1:running' });
  });

  it('uses completed status in the follow key so a reload can happen after write finishes', () => {
    const running = extractLatestAppDevCodeFollowTarget([
      tool({
        name: 'Edit',
        id: 'e1',
        status: 'running',
        input: { file_path: 'frontend/src/App.tsx', old_string: 'a', new_string: 'b' },
      }),
    ]);
    const done = extractLatestAppDevCodeFollowTarget([
      tool({
        name: 'Edit',
        id: 'e1',
        status: 'completed',
        input: { file_path: 'frontend/src/App.tsx', old_string: 'a', new_string: 'b' },
      }),
    ]);
    expect(running?.path).toBe('frontend/src/App.tsx');
    expect(done?.path).toBe('frontend/src/App.tsx');
    expect(running?.key).not.toBe(done?.key);
  });
});

describe('followAppDevLiveTools', () => {
  const edit = tool({
    name: 'Edit',
    toolCallId: 'e1',
    input: { file_path: '/app/src/Home.tsx', old_string: 'a', new_string: 'b' },
  });

  it('reveals a new file when follow is active', () => {
    expect(followAppDevLiveTools([edit], { pausedUntil: 0, lastKey: null, now: 1_000 })).toEqual({
      revealPath: 'src/Home.tsx',
      nextKey: 'e1:completed',
    });
  });

  it('does not re-reveal the same tool status', () => {
    expect(followAppDevLiveTools([edit], {
      pausedUntil: 0,
      lastKey: 'e1:completed',
      now: 1_000,
    })).toEqual({
      revealPath: null,
      nextKey: 'e1:completed',
    });
  });

  it('skips reveal while the user pause window is active', () => {
    expect(followAppDevLiveTools([edit], {
      pausedUntil: 5_000,
      lastKey: null,
      now: 1_000,
    })).toEqual({
      revealPath: null,
      nextKey: null,
    });
  });

  it('resumes reveal after the idle window', () => {
    expect(followAppDevLiveTools([edit], {
      pausedUntil: 1_000 + APP_DEV_CODE_FOLLOW_IDLE_MS,
      lastKey: null,
      now: 1_000 + APP_DEV_CODE_FOLLOW_IDLE_MS,
    })).toEqual({
      revealPath: 'src/Home.tsx',
      nextKey: 'e1:completed',
    });
  });
});

describe('isAppDevCodeFollowPaused', () => {
  it('treats 0 as following', () => {
    expect(isAppDevCodeFollowPaused(0, 1_000)).toBe(false);
  });

  it('pauses until the timestamp', () => {
    expect(isAppDevCodeFollowPaused(2_000, 1_000)).toBe(true);
    expect(isAppDevCodeFollowPaused(2_000, 2_000)).toBe(false);
  });
});
