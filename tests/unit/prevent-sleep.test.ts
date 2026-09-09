import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    isStarted: vi.fn(() => true),
    stop: vi.fn(),
  },
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: vi.fn(async () => false),
}));

vi.mock('../../electron/utils/paths', () => ({
  getOpenClawResolvedDir: () => '/tmp/openclaw',
}));

import { buildWindowsPowerHelperSpawnArgs } from '../../electron/main/prevent-sleep';

describe('prevent-sleep Windows helper', () => {
  it('hides the PowerShell fallback console window', () => {
    const args = buildWindowsPowerHelperSpawnArgs(1234);
    expect(args).toEqual(expect.arrayContaining(['-WindowStyle', 'Hidden', '-NonInteractive', '-NoLogo']));
    const styleIdx = args.indexOf('-WindowStyle');
    const commandIdx = args.indexOf('-Command');
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    expect(styleIdx).toBeLessThan(commandIdx);
  });

  it('keeps the helper script bound to the parent pid', () => {
    const args = buildWindowsPowerHelperSpawnArgs(4321);
    const script = args.at(-1) ?? '';
    expect(script).toContain('$parentPid = 4321');
    expect(script).toContain('SetThreadExecutionState');
  });
});
