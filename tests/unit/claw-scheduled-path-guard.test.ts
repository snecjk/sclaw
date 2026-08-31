import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SclawExtensionLogger } from '../../shared/agent-extensions';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';

type ToolCallHandler = (event: {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}) => Promise<unknown> | unknown;

const temporaryRoots: string[] = [];

const logger: SclawExtensionLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sclaw-scheduled-guard-'));
  temporaryRoots.push(root);
  return root;
}

async function buildGuard(root: string): Promise<{
  names: string[];
  handler: ToolCallHandler;
}> {
  const result = await buildPiAgentExtensions({
    sessionKey: 'pi-task:test:2026-08-29',
    mode: 'scheduled',
    cwd: root,
    allowedRoots: [root],
    logger,
  });
  expect(result.diagnostics).toEqual([]);
  const handlers: ToolCallHandler[] = [];
  for (const extension of result.extensions) {
    const factory = typeof extension === 'function' ? extension : extension.factory;
    await factory({
      registerTool() {},
      getActiveTools() { return []; },
      setActiveTools() {},
      on(event: string, handler: ToolCallHandler) {
        if (event === 'tool_call') handlers.push(handler);
      },
    } as never);
  }
  return {
    names: result.extensions.map((extension) => (
      typeof extension === 'function' ? 'anonymous' : extension.name
    )),
    handler: handlers[0],
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('claw scheduled path guard extension', () => {
  it('does not load the path guard for interactive PI sessions', async () => {
    const root = await createRoot();
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi:interactive',
      mode: 'interactive',
      cwd: root,
      allowedRoots: [root],
      logger,
    });
    expect(result.extensions.map((extension) => (
      typeof extension === 'function' ? 'anonymous' : extension.name
    ))).toEqual([
      'sclaw-extension-lifecycle',
      'sto-browser-tool',
      'sto-scheduled-task-tool',
      'sto-dingtalk-send-guard',
      'sto-user-skill-tool',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('loads through the production registry for scheduled sessions', async () => {
    const root = await createRoot();
    const guard = await buildGuard(root);
    expect(guard.names).toEqual([
      'sclaw-extension-lifecycle',
      'sclaw-scheduled-path-guard',
      'sto-browser-tool',
      'sto-scheduled-task-tool',
      'sto-dingtalk-send-guard',
      'sto-user-skill-tool',
    ]);
  });

  it('allows paths inside configured roots and blocks paths outside them', async () => {
    const root = await createRoot();
    const { handler } = await buildGuard(root);
    await expect(handler({
      toolName: 'write',
      toolCallId: 'inside',
      input: { path: join(root, 'reports', 'result.md') },
    })).resolves.toBeUndefined();

    const outside = join(dirname(root), 'outside-scheduled-guard', 'secret.txt');
    await expect(handler({
      toolName: 'read',
      toolCallId: 'outside',
      input: { path: outside },
    })).resolves.toEqual({
      block: true,
      reason: `Scheduled Pi task path is outside the configured roots: ${outside}`,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[claw-scheduled-path-guard] tool blocked',
      expect.objectContaining({ reason: 'scheduled-path-policy', requestedPath: outside }),
    );
  });

  it.each(['bash', 'powershell'])('preserves the scheduled %s deny policy', async (toolName) => {
    const root = await createRoot();
    const { handler } = await buildGuard(root);
    await expect(handler({
      toolName,
      toolCallId: `safe-${toolName}`,
      input: { command: 'echo ok' },
    })).resolves.toBeUndefined();
    await expect(handler({
      toolName,
      toolCallId: `blocked-${toolName}`,
      input: { command: 'sudo shutdown now' },
    })).resolves.toEqual({
      block: true,
      reason: 'Scheduled Pi task command is outside the configured workspace/artifact roots',
    });
  });
});
