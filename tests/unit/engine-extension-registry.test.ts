import { describe, expect, it } from 'vitest';
import {
  getEngineExtension,
  listClaudePluginExtensions,
  listEngineExtensions,
  listOpenClawPluginExtensions,
} from '../../electron/services/engine-extension-registry';

describe('engine extension registry', () => {
  it('keeps only the legacy OpenClaw registration', () => {
    const extension = getEngineExtension('sto-dingtalk-send-guard');

    expect(extension).toBeDefined();
    expect(extension?.supports.openclaw?.pluginId).toBe('sto-dingtalk-send-guard');
  });

  it('lists registered extensions through filtered views', () => {
    expect(listEngineExtensions().length).toBeGreaterThan(0);
    expect(listOpenClawPluginExtensions().some((entry) => entry.id === 'sto-dingtalk-send-guard')).toBe(true);
    expect(listClaudePluginExtensions()).toEqual([]);
  });
});
