import { describe, expect, it } from 'vitest';
import {
  getEngineExtension,
  listClaudePluginExtensions,
  listEngineExtensions,
  listOpenClawPluginExtensions,
} from '../../electron/services/engine-extension-registry';

describe('engine extension registry', () => {
  it('registers the DingTalk send guard for both engines', () => {
    const extension = getEngineExtension('sto-dingtalk-send-guard');

    expect(extension).toBeDefined();
    expect(extension?.supports.openclaw?.pluginId).toBe('sto-dingtalk-send-guard');
    expect(extension?.supports.claudeSdk?.runtimeAdapterId).toBe('sto-dingtalk-send-guard');
    expect(extension?.supports.claudePlugin?.pluginId).toBe('sto-dingtalk-send-guard');
  });

  it('lists registered extensions through filtered views', () => {
    expect(listEngineExtensions().length).toBeGreaterThan(0);
    expect(listOpenClawPluginExtensions().some((entry) => entry.id === 'sto-dingtalk-send-guard')).toBe(true);
    expect(listClaudePluginExtensions().some((entry) => entry.id === 'sto-dingtalk-send-guard')).toBe(true);
  });
});
