import { describe, expect, it } from 'vitest';
import { isBrowserAutomationEnabled } from '../../shared/browser-automation/feature-flag';
import { buildObserveScript } from '../../shared/browser-automation/observe-script';
import {
  buildEmbedSessionId,
  parseEmbedRuntimeId,
} from '../../electron/services/browser-automation/session-manager';

describe('browser automation feature flag', () => {
  it('respects explicit env override', () => {
    const prev = process.env.STOCLAW_BROWSER_AUTOMATION;
    process.env.STOCLAW_BROWSER_AUTOMATION = 'true';
    expect(isBrowserAutomationEnabled()).toBe(true);
    process.env.STOCLAW_BROWSER_AUTOMATION = 'false';
    expect(isBrowserAutomationEnabled()).toBe(false);
    if (prev === undefined) delete process.env.STOCLAW_BROWSER_AUTOMATION;
    else process.env.STOCLAW_BROWSER_AUTOMATION = prev;
  });
});

describe('browser automation observe script', () => {
  it('injects element limit into script', () => {
    const script = buildObserveScript(42);
    expect(script).toContain('var ELEMENT_LIMIT = 42');
    expect(script).toContain('__stoBrowserAutomation');
  });
});

describe('browser automation session ids', () => {
  it('maps embed runtime ids', () => {
    expect(buildEmbedSessionId('abc')).toBe('embed-abc');
    expect(parseEmbedRuntimeId('embed-abc')).toBe('abc');
    expect(parseEmbedRuntimeId('managed-1')).toBeNull();
  });
});
