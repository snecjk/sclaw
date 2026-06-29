import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { testRoot } = vi.hoisted(() => ({
  testRoot: `/tmp/stoclaw-reset-dated-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testRoot,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('../../electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>('../../electron/utils/paths');
  return {
    ...actual,
    getOpenClawConfigDir: () => testRoot,
  };
});

describe('resetDatedExecutionArtifacts', () => {
  beforeEach(async () => {
    vi.resetModules();
    await mkdir(join(testRoot, 'cron', 'runs'), { recursive: true });
  });

  it('purges same-day cron run log lines before the next execution', async () => {
    const jobId = 'job-1';
    const logPath = join(testRoot, 'cron', 'runs', `${jobId}.jsonl`);
    const sameDayTs = new Date(2026, 5, 25, 9, 0, 0).getTime();
    const otherDayTs = new Date(2026, 5, 24, 9, 0, 0).getTime();
    await writeFile(
      logPath,
      [
        JSON.stringify({ jobId, action: 'finished', ts: sameDayTs, summary: 'old run' }),
        JSON.stringify({ jobId, action: 'finished', ts: otherDayTs, summary: 'keep me' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const { resetDatedExecutionArtifacts } = await import('../../electron/utils/reset-dated-execution-record');
    await resetDatedExecutionArtifacts(`agent:main:cron:${jobId}:2026-06-25`);

    const raw = await readFile(logPath, 'utf8');
    expect(raw).toContain('keep me');
    expect(raw).not.toContain('old run');
  });
});
