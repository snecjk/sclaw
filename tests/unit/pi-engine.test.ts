import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAgentEngineDescriptor,
  parseAgentEngineType,
} from '../../shared/agent-engine';
import { inferSessionCatalogMeta } from '../../shared/session-type';
import {
  extractScheduledCommandAbsolutePaths,
  isPiToolPathAllowed,
  piBashViolatesScheduledPolicy,
} from '../../electron/pi-runtime/path-policy';
import {
  getPiAssistantDisplaySnapshot,
  getPiAssistantError,
  getPiModelCompat,
  getPiTranscriptRevision,
  shouldCompletePiRun,
  startPiAssistantSnapshot,
  updatePiAssistantSnapshot,
} from '../../electron/pi-runtime/event-policy';
import { KeyedTaskQueue } from '../../electron/pi-runtime/keyed-task-queue';
import { abortPiActiveRun } from '../../electron/pi-runtime/abort-policy';
import { filterPiSkills, isPiSkillPathAllowed } from '../../electron/pi-runtime/skill-policy';
import {
  PI_BUILTIN_TOOL_NAMES,
  buildPiEnabledToolNames,
} from '../../electron/pi-runtime/tool-policy';

describe('Pi engine descriptor', () => {
  it('registers chat and scheduled tasks but rejects workflow capability', () => {
    expect(parseAgentEngineType('pi')).toBe('pi');
    expect(parseAgentEngineType('unknown')).toBeUndefined();
    expect(getAgentEngineDescriptor('pi').capabilities).toMatchObject({
      chat: true,
      scheduledTask: true,
      workflow: false,
    });
  });

  it('classifies dated Pi task sessions as scheduled-task sessions', () => {
    expect(inferSessionCatalogMeta('pi-task:task-1:2026-08-14')).toEqual({
      sessionType: 'scheduled_task',
      taskId: 'task-1',
      appId: null,
    });
  });
});

describe('Pi session tool allowlist', () => {
  it.each([
    ['new session', undefined],
    ['reopened follow-up session', 'D:/sessions/existing.jsonl'],
  ])('keeps extension tools enabled for a %s', (_scenario, _sessionFile) => {
    const extensionTools = [
      'create_sto_scheduled_task',
      'list_sto_scheduled_tasks',
    ];

    expect(buildPiEnabledToolNames(extensionTools)).toEqual([
      ...PI_BUILTIN_TOOL_NAMES,
      ...extensionTools,
    ]);
  });

  it('deduplicates tool names case-insensitively without replacing built-ins', () => {
    expect(buildPiEnabledToolNames([' read ', 'CUSTOM_TOOL', 'custom_tool', ''])).toEqual([
      ...PI_BUILTIN_TOOL_NAMES,
      'CUSTOM_TOOL',
    ]);
  });
});

describe('Pi OpenAI compatibility and errors', () => {
  it('uses the official compatibility flag for OpenAI-compatible endpoints', () => {
    expect(getPiModelCompat('openai-completions')).toEqual({
      supportsDeveloperRole: false,
    });
    expect(getPiModelCompat('anthropic-messages')).toBeUndefined();
  });

  it('turns an empty assistant error response into a visible run failure', () => {
    expect(getPiAssistantError({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: '400: developer role is unsupported',
    })).toBe('400: developer role is unsupported');
    expect(getPiAssistantError({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
    })).toBeUndefined();
  });

  it('produces a stable transcript revision that changes with assistant content', () => {
    const first = [{ role: 'user', content: 'hello' }];
    expect(getPiTranscriptRevision(first)).toBe(getPiTranscriptRevision(first));
    expect(getPiTranscriptRevision(first)).not.toBe(getPiTranscriptRevision([
      ...first,
      { role: 'assistant', content: 'hi' },
    ]));
  });

  it('only completes the prompt whose run observed agent_settled', () => {
    expect(shouldCompletePiRun('run-2', 'run-1', 'run-2')).toBe(false);
    expect(shouldCompletePiRun('run-2', 'run-2', 'run-2')).toBe(true);
    expect(shouldCompletePiRun(undefined, 'run-2', 'run-2')).toBe(false);
  });

  it('projects Pi token deltas as cumulative canonical snapshots', () => {
    let snapshot = startPiAssistantSnapshot({
      role: 'assistant',
      content: [],
      timestamp: 1,
    }, 'pi-stream-run-1');
    snapshot = updatePiAssistantSnapshot(snapshot, {
      type: 'thinking_start', contentIndex: 0,
    }, 'pi-stream-run-1');
    snapshot = updatePiAssistantSnapshot(snapshot, {
      type: 'thinking_delta', contentIndex: 0, delta: 'Think about ',
    }, 'pi-stream-run-1');
    snapshot = updatePiAssistantSnapshot(snapshot, {
      type: 'thinking_delta', contentIndex: 0, delta: 'it.',
    }, 'pi-stream-run-1');

    expect(snapshot).toMatchObject({
      id: 'pi-stream-run-1',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Think about it.' }],
    });
  });

  it('prefers the official Pi SDK partial assistant snapshot when present', () => {
    const snapshot = updatePiAssistantSnapshot(undefined, {
      type: 'text_delta',
      contentIndex: 1,
      delta: 'world',
      partial: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'done' },
          { type: 'text', text: 'Hello world' },
        ],
      },
    }, 'pi-stream-run-2');

    expect(snapshot?.content).toEqual([
      { type: 'thinking', thinking: 'done' },
      { type: 'text', text: 'Hello world' },
    ]);
  });

  it('bounds live Pi tool input without truncating the execution accumulator', () => {
    const fullPartialJson = `{"path":"report.html","content":"${'x'.repeat(2_000)}"}`;
    const snapshot = updatePiAssistantSnapshot(undefined, {
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: fullPartialJson,
      partial: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'tool-1',
          name: 'write',
          arguments: { path: 'report.html', content: 'x'.repeat(2_000) },
          partialJson: fullPartialJson,
        }],
      },
    }, 'pi-stream-run-3');

    const display = getPiAssistantDisplaySnapshot(snapshot, {
      type: 'toolcall_delta',
      contentIndex: 0,
    }, 256);
    const displayBlock = display?.content[0];

    expect(displayBlock?.arguments).toContain('[partial tool input:');
    expect(String(displayBlock?.arguments)).toHaveLength(256);
    expect(String(displayBlock?.partialJson)).toHaveLength(256);
    expect(snapshot?.content[0]?.partialJson).toBe(fullPartialJson);
    expect(snapshot?.content[0]?.arguments).toEqual({
      path: 'report.html',
      content: 'x'.repeat(2_000),
    });
  });
});

describe('Pi worker session command queue', () => {
  it('acknowledges abort immediately while keeping the session queue blocked until Pi is idle', async () => {
    let releaseAbort!: () => void;
    const abortSettlement = new Promise<void>((resolve) => { releaseAbort = resolve; });
    const calls: string[] = [];
    const entry = {
      activeRunId: 'run-active' as string | undefined,
      settledRunId: 'run-active' as string | undefined,
      streamingAssistant: { role: 'assistant' } as unknown,
      session: {
        abort: () => {
          calls.push('signal');
          return abortSettlement;
        },
      },
    };

    const operation = abortPiActiveRun(entry, {
      emitAborted: (runId) => calls.push(`event:${runId}`),
      respond: (aborted) => calls.push(`response:${aborted}`),
    });

    await Promise.resolve();
    expect(calls).toEqual(['signal', 'event:run-active', 'response:true']);
    expect(entry.activeRunId).toBeUndefined();
    let settled = false;
    void operation.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseAbort();
    await expect(operation).resolves.toBe(true);
  });

  it('reports a stale Pi stop request as not aborted', async () => {
    const responses: boolean[] = [];
    await expect(abortPiActiveRun(undefined, {
      emitAborted: () => { throw new Error('must not emit'); },
      respond: (aborted) => responses.push(aborted),
    })).resolves.toBe(false);
    expect(responses).toEqual([false]);
  });

  it('serializes initialization and history commands for the same session', async () => {
    const queue = new KeyedTaskQueue();
    const order: string[] = [];
    let releasePrompt!: () => void;
    let markPromptStarted!: () => void;
    const promptGate = new Promise<void>((resolve) => { releasePrompt = resolve; });
    const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve; });

    const prompt = queue.run('pi:main:one', async () => {
      order.push('prompt:start');
      markPromptStarted();
      await promptGate;
      order.push('prompt:ready');
    });
    const history = queue.run('pi:main:one', async () => {
      order.push('history');
    });

    await promptStarted;
    expect(order).toEqual(['prompt:start']);
    releasePrompt();
    await Promise.all([prompt, history]);
    expect(order).toEqual(['prompt:start', 'prompt:ready', 'history']);
  });

  it('allows different sessions to initialize concurrently', async () => {
    const queue = new KeyedTaskQueue();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run('pi:main:one', async () => {
      started.push('one');
      await gate;
    });
    const second = queue.run('pi:main:two', async () => {
      started.push('two');
    });

    await second;
    expect(started).toEqual(['one', 'two']);
    release();
    await first;
  });
});

describe('Pi scheduled-task path policy', () => {
  it('allows configured roots and rejects external and parent paths', async () => {
    const base = await mkdtemp(join(tmpdir(), 'stoclaw-pi-policy-'));
    const workspace = join(base, 'workspace');
    const outside = join(base, 'outside');
    await Promise.all([mkdir(workspace), mkdir(outside)]);
    try {
      expect(await isPiToolPathAllowed(join(workspace, 'new.txt'), [workspace])).toBe(true);
      expect(await isPiToolPathAllowed(join(outside, 'secret.txt'), [workspace])).toBe(false);
      expect(await piBashViolatesScheduledPolicy('cat ../outside/secret.txt', [workspace])).toBe(true);
      expect(await piBashViolatesScheduledPolicy(`echo ok > "${join(workspace, 'out.txt')}"`, [workspace])).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('extracts Windows and macOS absolute paths without directory allowlists', () => {
    expect(extractScheduledCommandAbsolutePaths(
      'type C:/Users/admin/secret.txt && type "D:\\Data Files\\report.txt" --output="E:/Output Dir/result.txt"',
      'win32',
    )).toEqual([
      'C:/Users/admin/secret.txt',
      'D:\\Data Files\\report.txt',
      'E:/Output Dir/result.txt',
    ]);
    expect(extractScheduledCommandAbsolutePaths(
      'cat /Volumes/Data/secret.txt /private/etc/hosts /tmp/report.txt',
      'darwin',
    )).toEqual(['/Volumes/Data/secret.txt', '/private/etc/hosts', '/tmp/report.txt']);
  });

  it('fails closed for shell-expanded paths', async () => {
    await expect(piBashViolatesScheduledPolicy('cat $HOME/secret.txt', ['/workspace']))
      .resolves.toBe(true);
    await expect(piBashViolatesScheduledPolicy('cat "$(pwd)/secret.txt"', ['/workspace']))
      .resolves.toBe(true);
  });

  it('rejects an existing symlink that escapes an allowed root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'stoclaw-pi-symlink-'));
    const workspace = join(base, 'workspace');
    const outside = join(base, 'outside');
    await Promise.all([mkdir(workspace), mkdir(outside)]);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    const link = join(workspace, 'outside-link');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      expect(await isPiToolPathAllowed(join(link, 'secret.txt'), [workspace])).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('Pi SClaw skill policy', () => {
  it('loads only skills contained by the SClaw-managed roots', async () => {
    const base = await mkdtemp(join(tmpdir(), 'stoclaw-pi-skills-'));
    const globalRoot = join(base, 'global-skills');
    const agentRoot = join(base, 'agent-skills');
    const projectRoot = join(base, 'project', '.agents', 'skills');
    await Promise.all([mkdir(globalRoot, { recursive: true }), mkdir(agentRoot, { recursive: true }), mkdir(projectRoot, { recursive: true })]);
    const managed = join(globalRoot, 'managed', 'SKILL.md');
    const agentManaged = join(agentRoot, 'agent-managed', 'SKILL.md');
    const projectLocal = join(projectRoot, 'untrusted', 'SKILL.md');
    await Promise.all([
      mkdir(join(globalRoot, 'managed'), { recursive: true }),
      mkdir(join(agentRoot, 'agent-managed'), { recursive: true }),
      mkdir(join(projectRoot, 'untrusted'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(managed, '# managed'),
      writeFile(agentManaged, '# agent managed'),
      writeFile(projectLocal, '# project local'),
    ]);

    try {
      const roots = [globalRoot, agentRoot];
      expect(isPiSkillPathAllowed(managed, roots)).toBe(true);
      expect(isPiSkillPathAllowed(projectLocal, roots)).toBe(false);
      expect(filterPiSkills([
        { name: 'managed', filePath: managed },
        { name: 'agent-managed', filePath: agentManaged },
        { name: 'project-local', filePath: projectLocal },
      ], roots).map((skill) => skill.name)).toEqual(['managed', 'agent-managed']);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
