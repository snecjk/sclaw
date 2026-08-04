import { describe, expect, it } from 'vitest';

import { getQpathBinDir, getQpathBinaryName, getQpathBinaryPath } from '../../electron/utils/qpath-cli';

describe('qpath-cli paths', () => {
  it('resolves official ~/.sto/qpath-cli/bin layout', () => {
    expect(getQpathBinDir()).toMatch(/\.sto[/\\]qpath-cli[/\\]bin$/);
    expect(getQpathBinaryPath()).toBe(
      `${getQpathBinDir()}${process.platform === 'win32' ? '\\' : '/'}${getQpathBinaryName()}`,
    );
    expect(getQpathBinaryName()).toBe(process.platform === 'win32' ? 'qpath.exe' : 'qpath');
  });
});
