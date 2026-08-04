import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('claude executable resolver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('resolves the Claude native binary from local node_modules in dev', async () => {
    const cwd = join('D:', 'workspace', 'sto-claw');
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const packageName = `claude-agent-sdk-${process.platform}-${process.arch}`;
    const expected = join(cwd, 'node_modules', '@anthropic-ai', packageName, binaryName);

    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: (candidate: string) => candidate === expected,
        },
        existsSync: (candidate: string) => candidate === expected,
      };
    });

    const { getClaudeExecutablePath } = await import('../../electron/utils/claude-executable');

    expect(getClaudeExecutablePath()).toBe(expected);
  });
});
