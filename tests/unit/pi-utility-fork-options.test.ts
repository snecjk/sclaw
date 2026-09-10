import { describe, expect, it } from 'vitest';
import { buildPiUtilityForkOptions } from '../../electron/pi-runtime/fork-options';

describe('buildPiUtilityForkOptions', () => {
  it('omits execArgv when preload args are missing', () => {
    const options = buildPiUtilityForkOptions({
      cwd: '/tmp',
      env: { STO_PI_WORKER: '1' },
    });
    expect(options).not.toHaveProperty('execArgv');
  });

  it('omits execArgv when preload args are empty', () => {
    const options = buildPiUtilityForkOptions({
      cwd: '/tmp',
      env: { STO_PI_WORKER: '1' },
      execArgv: [],
    });
    expect(options).not.toHaveProperty('execArgv');
  });

  it('includes execArgv when preload args are present', () => {
    const options = buildPiUtilityForkOptions({
      cwd: '/tmp',
      env: { STO_PI_WORKER: '1' },
      execArgv: ['--require', '/tmp/windows-hide-preload.cjs'],
    });
    expect(options.execArgv).toEqual(['--require', '/tmp/windows-hide-preload.cjs']);
  });
});
