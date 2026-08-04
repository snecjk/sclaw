import { describe, expect, it } from 'vitest';

import { buildTarGzExtractInvocation } from '../../electron/utils/tar-extract';

describe('buildTarGzExtractInvocation', () => {
  it('does not pass a Windows drive-letter archive path to GNU tar', () => {
    const invocation = buildTarGzExtractInvocation(
      String.raw`C:\Users\tester\AppData\Local\Temp\skill.tgz`,
      String.raw`C:\Users\tester\AppData\Local\Temp\extract`,
      'win32',
    );

    expect(invocation.cwd).toBe(String.raw`C:\Users\tester\AppData\Local\Temp`);
    expect(invocation.args).toEqual([
      '-xzf',
      'skill.tgz',
      '-C',
      'extract',
    ]);
    expect(invocation.args[1]).not.toContain(':');
    expect(invocation.args[3]).not.toContain(':');
  });

  it('normalizes nested Windows destination separators for GNU tar', () => {
    const invocation = buildTarGzExtractInvocation(
      String.raw`C:\Temp\bundle\skill.tgz`,
      String.raw`C:\Temp\bundle\output\extract`,
      'win32',
    );

    expect(invocation.args.at(-1)).toBe('output/extract');
  });
});
