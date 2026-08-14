import { describe, expect, it } from 'vitest';
import { valuesMatch } from '../../electron/services/browser-automation/input';
import { buildObserveScript } from '../../shared/browser-automation/observe-script';

describe('browser automation input helpers', () => {
  it('matches exact and partial typed values', () => {
    expect(valuesMatch('Sclaw浏览器自动化', 'Sclaw浏览器自动化')).toBe(true);
    expect(valuesMatch('前缀 Sclaw浏览器自动化 后缀', 'Sclaw浏览器自动化')).toBe(true);
    expect(valuesMatch('  hello  ', 'hello')).toBe(true);
    expect(valuesMatch('', '')).toBe(true);
  });

  it('rejects mismatched typed values', () => {
    expect(valuesMatch('', 'Sclaw浏览器自动化')).toBe(false);
    expect(valuesMatch('other', 'Sclaw浏览器自动化')).toBe(false);
  });
});

describe('browser automation observe script input helpers', () => {
  it('exposes CDP input helper functions', () => {
    const script = buildObserveScript(10);
    expect(script).toContain('resolveTargetForInput');
    expect(script).toContain('readTargetInputValue');
    expect(script).toContain('nativeFillTarget');
    expect(script).toContain('fillWithNativeSetter');
  });
});
