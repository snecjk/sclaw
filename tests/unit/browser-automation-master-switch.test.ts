import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserAutomationLevel,
  isBrowserAutomationEnabled,
  parseBrowserAutomationLevel,
  setBrowserAutomationSettingsLevel,
} from '../../shared/browser-automation/feature-flag';

const openclawAuth = vi.hoisted(() => ({
  ensureStoBrowserAutomationPluginInOpenClaw: vi.fn(async () => true),
  ensureStoBrowserBridgePluginInOpenClaw: vi.fn(async () => true),
  setStoBrowserAutomationPluginEnabled: vi.fn(async () => true),
  setStoBrowserBridgePluginEnabled: vi.fn(async () => true),
}));

const bridgeService = vi.hoisted(() => ({
  revokeAllTokens: vi.fn(),
  setAutoConnectEnabled: vi.fn(),
}));

vi.mock('../../electron/utils/openclaw-auth', () => openclawAuth);
vi.mock('../../electron/services/browser-bridge-service', () => ({
  browserBridgeService: bridgeService,
}));

describe('browser automation master switch', () => {
  afterEach(() => {
    delete process.env.STOCLAW_BROWSER_AUTOMATION;
    delete process.env.VITE_STOCLAW_BROWSER_AUTOMATION;
    setBrowserAutomationSettingsLevel(null);
    vi.clearAllMocks();
  });

  it('parses off/dom/ax tokens', () => {
    expect(parseBrowserAutomationLevel('off')).toBe('off');
    expect(parseBrowserAutomationLevel('DOM')).toBe('dom');
    expect(parseBrowserAutomationLevel('false')).toBe('off');
    expect(parseBrowserAutomationLevel('ax')).toBe('ax');
    expect(parseBrowserAutomationLevel(1)).toBeNull();
  });

  it('lets env override injected settings', () => {
    setBrowserAutomationSettingsLevel('ax');
    process.env.STOCLAW_BROWSER_AUTOMATION = 'off';
    expect(getBrowserAutomationLevel()).toBe('off');
    expect(isBrowserAutomationEnabled()).toBe(false);
  });

  it('uses injected settings when env is empty', () => {
    setBrowserAutomationSettingsLevel('off');
    expect(getBrowserAutomationLevel()).toBe('off');
    expect(isBrowserAutomationEnabled()).toBe(false);
    setBrowserAutomationSettingsLevel('dom');
    expect(isBrowserAutomationEnabled()).toBe(true);
  });

  it('off 时同时关掉 ba/bridge 插件、autoConnect，并吊销 token', async () => {
    const { applyBrowserAutomationLevel } = await import('../../electron/services/browser-automation/master-switch');
    await applyBrowserAutomationLevel('off');
    expect(openclawAuth.setStoBrowserAutomationPluginEnabled).toHaveBeenCalledWith(false);
    expect(openclawAuth.setStoBrowserBridgePluginEnabled).toHaveBeenCalledWith(false);
    expect(bridgeService.setAutoConnectEnabled).toHaveBeenCalledWith(false);
    expect(bridgeService.revokeAllTokens).toHaveBeenCalled();
    expect(openclawAuth.ensureStoBrowserAutomationPluginInOpenClaw).not.toHaveBeenCalled();
  });

  it('on 时启用 ba/bridge 插件并打开 autoConnect', async () => {
    const { applyBrowserAutomationLevel } = await import('../../electron/services/browser-automation/master-switch');
    await applyBrowserAutomationLevel('dom');
    expect(openclawAuth.ensureStoBrowserAutomationPluginInOpenClaw).toHaveBeenCalled();
    expect(openclawAuth.ensureStoBrowserBridgePluginInOpenClaw).toHaveBeenCalled();
    expect(bridgeService.setAutoConnectEnabled).toHaveBeenCalledWith(true);
  });
});
