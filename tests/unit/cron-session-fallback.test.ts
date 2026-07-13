import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigDir = vi.hoisted(() => ({ value: '' }));

vi.mock('../../electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>('../../electron/utils/paths');
  return {
    ...actual,
    getOpenClawConfigDir: () => mockConfigDir.value,
    getClawXConfigDir: () => mockConfigDir.value,
  };
});

describe('buildCronSessionFallbackMessages', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'sto-claw-cron-fallback-'));
    mockConfigDir.value = tempRoot;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('uses run transcript only and skips duplicate run-log summary', async () => {
    const runSessionId = 'run-session-1';
    const sessionKey = `agent:main:cron:job-1:run:${runSessionId}`;
    const runAtMs = new Date('2026-06-29T10:00:00+08:00').getTime();
    const sessionDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, `${runSessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'message',
          timestamp: runAtMs,
          message: { role: 'user', content: '[cron:job-1] who am i' },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: runAtMs + 1000,
          message: { role: 'assistant', content: 'Identity Status: Not Yet Established' },
        }),
      ].join('\n'),
      'utf8',
    );

    const { buildCronSessionFallbackMessages } = await import('../../electron/api/routes/cron');
    const messages = await buildCronSessionFallbackMessages({
      sessionKey: 'agent:main:cron:job-1:2026-06-29',
      job: {
        name: 'who am I',
        payload: { message: 'who am i' },
      },
      runs: [
        {
          jobId: 'job-1',
          sessionKey,
          sessionId: runSessionId,
          ts: runAtMs + 1000,
          runAtMs,
          status: 'ok',
          summary: 'Identity Status: Not Yet Established',
          durationMs: 21000,
          provider: 'sto',
          model: 'qwen3.5-plus',
        },
      ],
    });

    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant']);
    expect(messages[0]?.content).toContain('Scheduled task: who am I');
    expect(messages[1]?.content).toContain('[cron:job-1]');
    expect(messages[2]?.content).toBe('Identity Status: Not Yet Established');
  });

  it('falls back to run-log summary when transcript is unavailable', async () => {
    const { buildCronSessionFallbackMessages } = await import('../../electron/api/routes/cron');
    const messages = await buildCronSessionFallbackMessages({
      sessionKey: 'agent:main:cron:job-1',
      job: {
        name: 'Drink water',
        payload: { message: 'drink water' },
      },
      runs: [
        {
          jobId: 'job-1',
          ts: 1773281732751,
          runAtMs: 1773281732000,
          status: 'ok',
          summary: 'Drink water 💧',
        },
      ],
    });

    expect(messages.map((message) => message.role)).toEqual(['system', 'assistant']);
    expect(messages[1]?.content).toContain('Drink water 💧');
  });

  it('preserves assistant tool_use blocks for DingTalk sent preview', async () => {
    const runSessionId = 'run-session-dingtalk';
    const sessionKey = `agent:main:cron:job-2:run:${runSessionId}`;
    const runAtMs = new Date('2026-07-03T10:00:00+08:00').getTime();
    const dwsCommand = 'dws chat message send --user u1 --title "上海明天天气预报" --text "最高温 30C" --format json';
    const sessionDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, `${runSessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'message',
          timestamp: runAtMs,
          message: { role: 'user', content: '发送上海天气' },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: runAtMs + 1000,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'bash',
                input: { command: dwsCommand },
              },
              { type: 'text', text: '已将天气预报发送给文鹏。' },
            ],
          },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: runAtMs + 2000,
          message: {
            role: 'toolresult',
            toolCallId: 'tool-1',
            toolName: 'bash',
            content: [{ type: 'text', text: '{"ok":true}' }],
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { buildCronSessionFallbackMessages } = await import('../../electron/api/routes/cron');
    const messages = await buildCronSessionFallbackMessages({
      sessionKey: 'agent:main:cron:job-2:2026-07-03',
      job: {
        name: '天气推送',
        payload: { message: '发送上海天气' },
      },
      runs: [
        {
          jobId: 'job-2',
          sessionKey,
          sessionId: runSessionId,
          ts: runAtMs + 2000,
          runAtMs,
          status: 'ok',
          summary: '已将天气预报发送给文鹏。',
        },
      ],
    });

    const assistant = messages.find((message) => message.role === 'assistant');
    expect(Array.isArray(assistant?.content)).toBe(true);
    expect(JSON.stringify(assistant?.content)).toContain('dws chat message send');
    expect(messages.some((message) => message.role === 'toolresult')).toBe(true);
  });
});
