import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appearanceState = vi.hoisted(() => {
  const createWebContents = (initiallyDestroyed = false) => {
    let destroyed = initiallyDestroyed;
    const listeners = new Map<string, Set<() => void>>();
    const contents = {
      isDestroyed: vi.fn(() => destroyed),
      send: vi.fn(),
      on: vi.fn((eventName: string, listener: () => void) => {
        const eventListeners = listeners.get(eventName) ?? new Set<() => void>();
        eventListeners.add(listener);
        listeners.set(eventName, eventListeners);
        return contents;
      }),
      once: vi.fn((eventName: string, listener: () => void) => {
        const onceListener = () => {
          listeners.get(eventName)?.delete(onceListener);
          listener();
        };
        const eventListeners = listeners.get(eventName) ?? new Set<() => void>();
        eventListeners.add(onceListener);
        listeners.set(eventName, eventListeners);
        return contents;
      }),
      removeListener: vi.fn((eventName: string, listener: () => void) => {
        listeners.get(eventName)?.delete(listener);
        return contents;
      }),
      emit: (eventName: string) => {
        for (const listener of [...(listeners.get(eventName) ?? [])]) listener();
      },
      setDestroyed: (value: boolean) => {
        destroyed = value;
      },
    };
    return contents;
  };
  let themeSource: 'light' | 'dark' | 'system' = 'light';
  const themeSourceWrites = vi.fn((value: 'light' | 'dark' | 'system') => {
    themeSource = value;
  });
  const nativeTheme = {
    shouldUseDarkColors: false,
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  Object.defineProperty(nativeTheme, 'themeSource', {
    get: () => themeSource,
    set: themeSourceWrites,
  });
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    webContents: createWebContents(),
  };
  const spriteWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    webContents: createWebContents(),
  };
  const floatIconWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    webContents: createWebContents(),
  };
  const destroyedWindow = {
    isDestroyed: vi.fn(() => true),
    setBackgroundColor: vi.fn(),
    webContents: createWebContents(),
  };
  const destroyedContentsWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    webContents: createWebContents(true),
  };
  return {
    nativeTheme,
    windows: [mainWindow, spriteWindow, floatIconWindow, destroyedWindow, destroyedContentsWindow],
    mainWindow,
    spriteWindow,
    floatIconWindow,
    destroyedWindow,
    destroyedContentsWindow,
    createWebContents,
    getSetting: vi.fn(),
    getAllSettings: vi.fn(),
    resetSettings: vi.fn(),
    setSetting: vi.fn(),
    parseJsonBody: vi.fn(),
    sendJson: vi.fn(),
    syncNativeAppearanceFromStore: vi.fn(),
    syncPeriodicCheckFromSettings: vi.fn(),
    applyProxySettings: vi.fn(),
    syncProxyConfigToOpenClaw: vi.fn(),
    syncLaunchAtStartupSettingFromStore: vi.fn(),
    syncPreventSystemSleepSettingFromStore: vi.fn(),
    syncApplicationMenuFromStore: vi.fn(),
    themeSourceWrites,
    setThemeSource: (value: 'light' | 'dark' | 'system') => {
      themeSource = value;
    },
    getSpriteWindow: vi.fn(() => spriteWindow),
    getFloatIconWindow: vi.fn(() => floatIconWindow),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => appearanceState.windows,
  },
  nativeTheme: appearanceState.nativeTheme,
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: appearanceState.getSetting,
  getAllSettings: appearanceState.getAllSettings,
  resetSettings: appearanceState.resetSettings,
  setSetting: appearanceState.setSetting,
}));

vi.mock('../../electron/main/sprite-window', () => ({
  getSpriteWindow: appearanceState.getSpriteWindow,
}));

vi.mock('../../electron/main/float-icon-window', () => ({
  getFloatIconWindow: appearanceState.getFloatIconWindow,
}));

vi.mock('../../electron/main/proxy', () => ({
  applyProxySettings: appearanceState.applyProxySettings,
}));

vi.mock('../../electron/main/launch-at-startup', () => ({
  syncLaunchAtStartupSettingFromStore: appearanceState.syncLaunchAtStartupSettingFromStore,
}));

vi.mock('../../electron/main/menu', () => ({
  syncApplicationMenuFromStore: appearanceState.syncApplicationMenuFromStore,
}));

vi.mock('../../electron/main/prevent-sleep', () => ({
  syncPreventSystemSleepSettingFromStore: appearanceState.syncPreventSystemSleepSettingFromStore,
}));

vi.mock('../../electron/utils/openclaw-proxy', () => ({
  syncProxyConfigToOpenClaw: appearanceState.syncProxyConfigToOpenClaw,
}));

vi.mock('../../electron/main/updater', () => ({
  appUpdater: {
    syncPeriodicCheckFromSettings: appearanceState.syncPeriodicCheckFromSettings,
  },
}));

vi.mock('../../electron/api/route-utils', () => ({
  parseJsonBody: appearanceState.parseJsonBody,
  sendJson: appearanceState.sendJson,
}));

import {
  applyNativeAppearancePreference,
  observeNativeAppearanceUpdates,
  resolveWindowBackgroundColor,
  syncNativeAppearanceFromStore,
} from '../../electron/main/appearance';
import * as appearanceModule from '../../electron/main/appearance';
import { handleSettingsRoutes } from '../../electron/api/routes/settings';

const routeContext = {
  gatewayManager: {
    getStatus: () => ({ state: 'stopped' }),
    restart: vi.fn(),
  },
};

function handleSettingsRoute(method: string, path: string): Promise<boolean> {
  return handleSettingsRoutes(
    { method } as IncomingMessage,
    {} as ServerResponse,
    new URL(path, 'http://localhost'),
    routeContext as never,
  );
}

const splashHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const mainWindowSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8');
const spriteWindowSource = readFileSync(
  resolve(process.cwd(), 'electron/main/sprite-window.ts'),
  'utf8',
);
const floatIconWindowSource = readFileSync(
  resolve(process.cwd(), 'electron/main/float-icon-window.ts'),
  'utf8',
);

function expectReplayAttachedBeforeLoad(source: string): void {
  const constructorIndex = source.indexOf('const win = new BrowserWindow');
  const attachIndex = source.indexOf('attachAppearanceReplay(win)', constructorIndex);
  const loadIndexes = [
    source.indexOf('win.loadURL', constructorIndex),
    source.indexOf('win.loadFile', constructorIndex),
  ].filter((index) => index >= 0);

  expect(constructorIndex).toBeGreaterThanOrEqual(0);
  expect(attachIndex).toBeGreaterThan(constructorIndex);
  expect(loadIndexes.length).toBeGreaterThan(0);
  expect(attachIndex).toBeLessThan(Math.min(...loadIndexes));
}

describe('native appearance', () => {
  beforeEach(() => {
    appearanceState.windows = [
      appearanceState.mainWindow,
      appearanceState.spriteWindow,
      appearanceState.floatIconWindow,
      appearanceState.destroyedWindow,
      appearanceState.destroyedContentsWindow,
    ];
    appearanceState.setThemeSource('light');
    appearanceState.themeSourceWrites.mockReset();
    appearanceState.nativeTheme.shouldUseDarkColors = false;
    appearanceState.nativeTheme.on.mockReset();
    appearanceState.nativeTheme.removeListener.mockReset();
    appearanceState.getSetting.mockReset();
    appearanceState.getAllSettings.mockReset();
    appearanceState.resetSettings.mockReset();
    appearanceState.setSetting.mockReset();
    appearanceState.parseJsonBody.mockReset();
    appearanceState.sendJson.mockReset();
    appearanceState.syncPeriodicCheckFromSettings.mockReset();
    appearanceState.applyProxySettings.mockReset();
    appearanceState.syncProxyConfigToOpenClaw.mockReset();
    appearanceState.syncLaunchAtStartupSettingFromStore.mockReset();
    appearanceState.syncPreventSystemSleepSettingFromStore.mockReset();
    appearanceState.syncApplicationMenuFromStore.mockReset();
    appearanceState.getSpriteWindow.mockClear();
    appearanceState.getFloatIconWindow.mockClear();
    for (const window of appearanceState.windows) {
      window.isDestroyed.mockClear();
      window.setBackgroundColor.mockReset();
      window.webContents = appearanceState.createWebContents(
        window === appearanceState.destroyedContentsWindow,
      );
    }
  });

  it('maps native darkness to the approved shell colors', () => {
    expect(resolveWindowBackgroundColor(false)).toBe('#ededed');
    expect(resolveWindowBackgroundColor(true)).toBe('#0d0d0d');
  });

  it('uses the native shell colors for the pre-render splash', () => {
    expect(splashHtml).toContain('background: #ededed;');
    expect(splashHtml).toContain('@media (prefers-color-scheme: dark)');
    expect(splashHtml).toContain('background: #0d0d0d;');
    expect(splashHtml).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*?\.splash-spinner\s*\{[\s\S]*?border-color:\s*rgba\(255, 255, 255, 0\.1\);[\s\S]*?border-top-color:\s*#ff6f00;/,
    );
  });

  it.each(['light', 'dark', 'system'] as const)('accepts the persisted %s preference', (theme) => {
    applyNativeAppearancePreference(theme);

    expect(appearanceState.nativeTheme.themeSource).toBe(theme);
  });

  it('updates only opaque windows when applying an appearance preference', () => {
    appearanceState.nativeTheme.shouldUseDarkColors = true;

    applyNativeAppearancePreference('dark');

    expect(appearanceState.mainWindow.setBackgroundColor).toHaveBeenCalledWith('#0d0d0d');
    expect(appearanceState.spriteWindow.setBackgroundColor).not.toHaveBeenCalled();
    expect(appearanceState.floatIconWindow.setBackgroundColor).not.toHaveBeenCalled();
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ] as const)('broadcasts an explicit %s preference to every live window', (preference, appearance) => {
    applyNativeAppearancePreference(preference);

    const payload = { preference, appearance };
    expect(appearanceState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      payload,
    );
    expect(appearanceState.spriteWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      payload,
    );
    expect(appearanceState.floatIconWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      payload,
    );
    expect(appearanceState.destroyedWindow.webContents.send).not.toHaveBeenCalled();
    expect(appearanceState.destroyedContentsWindow.webContents.isDestroyed).toHaveBeenCalled();
    expect(appearanceState.destroyedContentsWindow.webContents.send).not.toHaveBeenCalled();
    expect(appearanceState.destroyedContentsWindow.webContents.on).not.toHaveBeenCalled();
  });

  it('replays the current state once after every renderer load', () => {
    const contents = appearanceState.mainWindow.webContents;

    applyNativeAppearancePreference('dark');
    expect(contents.send).toHaveBeenCalledTimes(1);
    expect(contents.on).toHaveBeenCalledTimes(1);
    expect(contents.on).toHaveBeenCalledWith('did-finish-load', expect.any(Function));

    contents.emit('did-finish-load');
    expect(contents.send).toHaveBeenCalledTimes(2);
    expect(contents.send).toHaveBeenLastCalledWith(
      'sto:appearance-state',
      { preference: 'dark', appearance: 'dark' },
    );

    const cleanup = observeNativeAppearanceUpdates();
    const observer = appearanceState.nativeTheme.on.mock.calls[0][1] as () => void;
    observer();
    expect(contents.send).toHaveBeenCalledTimes(2);
    expect(contents.on).toHaveBeenCalledTimes(1);

    contents.emit('did-finish-load');
    expect(contents.send).toHaveBeenCalledTimes(3);

    contents.setDestroyed(true);
    contents.emit('did-finish-load');
    expect(contents.send).toHaveBeenCalledTimes(3);

    cleanup();
  });

  it('replays startup state when a window is attached after the initial publication', () => {
    appearanceState.windows = [];
    appearanceState.nativeTheme.shouldUseDarkColors = true;
    applyNativeAppearancePreference('system');

    const attachAppearanceReplay = (
      appearanceModule as typeof appearanceModule & {
        attachAppearanceReplay?: (window: typeof appearanceState.mainWindow) => void;
      }
    ).attachAppearanceReplay;
    expect(attachAppearanceReplay).toBeTypeOf('function');

    const window = {
      isDestroyed: vi.fn(() => false),
      setBackgroundColor: vi.fn(),
      webContents: appearanceState.createWebContents(),
    };
    attachAppearanceReplay?.(window);
    expect(window.webContents.send).not.toHaveBeenCalled();

    window.webContents.emit('did-finish-load');
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      { preference: 'system', appearance: 'dark' },
    );
  });

  it('attaches replay before loading every app BrowserWindow', () => {
    expectReplayAttachedBeforeLoad(mainWindowSource);
    expectReplayAttachedBeforeLoad(spriteWindowSource);
    expectReplayAttachedBeforeLoad(floatIconWindowSource);
  });

  it('publishes each state once per contents while allowing late windows to catch up', () => {
    applyNativeAppearancePreference('dark');
    const cleanup = observeNativeAppearanceUpdates();
    const listener = appearanceState.nativeTheme.on.mock.calls[0][1] as () => void;

    listener();
    expect(appearanceState.mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(appearanceState.spriteWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(appearanceState.floatIconWindow.webContents.send).toHaveBeenCalledTimes(1);

    const lateWindow = {
      isDestroyed: vi.fn(() => false),
      setBackgroundColor: vi.fn(),
      webContents: appearanceState.createWebContents(),
    };
    appearanceState.windows.push(lateWindow);
    listener();

    expect(appearanceState.mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(lateWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(lateWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      { preference: 'dark', appearance: 'dark' },
    );

    cleanup();
  });

  it('synchronizes the persisted preference before window creation', async () => {
    appearanceState.getSetting.mockResolvedValue('system');

    await syncNativeAppearanceFromStore();

    expect(appearanceState.getSetting).toHaveBeenCalledWith('theme');
    expect(appearanceState.nativeTheme.themeSource).toBe('system');
  });

  it('falls back to the project default when persisted appearance is invalid', async () => {
    appearanceState.getSetting.mockResolvedValue('sepia');

    await syncNativeAppearanceFromStore();

    expect(appearanceState.nativeTheme.themeSource).toBe('light');
    expect(appearanceState.themeSourceWrites).toHaveBeenCalledWith('light');
    expect(appearanceState.themeSourceWrites).not.toHaveBeenCalledWith('sepia');
  });

  it('observes native changes once and updates opaque window backgrounds', () => {
    const firstCleanup = observeNativeAppearanceUpdates();
    const secondCleanup = observeNativeAppearanceUpdates();

    expect(appearanceState.nativeTheme.on).toHaveBeenCalledTimes(1);
    expect(appearanceState.nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
    expect(secondCleanup).toBe(firstCleanup);

    appearanceState.setThemeSource('system');
    appearanceState.nativeTheme.shouldUseDarkColors = true;
    const listener = appearanceState.nativeTheme.on.mock.calls[0][1] as () => void;
    listener();

    expect(appearanceState.mainWindow.setBackgroundColor).toHaveBeenCalledWith('#0d0d0d');
    expect(appearanceState.spriteWindow.setBackgroundColor).not.toHaveBeenCalled();
    expect(appearanceState.floatIconWindow.setBackgroundColor).not.toHaveBeenCalled();
    expect(appearanceState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      { preference: 'system', appearance: 'dark' },
    );
    expect(appearanceState.spriteWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      { preference: 'system', appearance: 'dark' },
    );
    expect(appearanceState.floatIconWindow.webContents.send).toHaveBeenCalledWith(
      'sto:appearance-state',
      { preference: 'system', appearance: 'dark' },
    );
    expect(appearanceState.destroyedWindow.webContents.send).not.toHaveBeenCalled();
    expect(appearanceState.destroyedContentsWindow.webContents.send).not.toHaveBeenCalled();

    firstCleanup();
    expect(appearanceState.nativeTheme.removeListener).toHaveBeenCalledWith('updated', listener);
  });
});

describe('settings appearance routes', () => {
  beforeEach(() => {
    appearanceState.setThemeSource('light');
    appearanceState.themeSourceWrites.mockReset();
    appearanceState.getSetting.mockReset();
    appearanceState.getAllSettings.mockReset();
    appearanceState.resetSettings.mockReset();
    appearanceState.setSetting.mockReset();
    appearanceState.parseJsonBody.mockReset();
    appearanceState.sendJson.mockReset();
    appearanceState.syncPeriodicCheckFromSettings.mockReset();
    appearanceState.applyProxySettings.mockReset();
    appearanceState.syncProxyConfigToOpenClaw.mockReset();
    appearanceState.syncLaunchAtStartupSettingFromStore.mockReset();
    appearanceState.syncPreventSystemSleepSettingFromStore.mockReset();
    appearanceState.syncApplicationMenuFromStore.mockReset();
  });

  it('normalizes an invalid stored appearance before returning all settings', async () => {
    appearanceState.getAllSettings.mockResolvedValue({ theme: 'sepia', language: 'en' });

    await handleSettingsRoute('GET', '/api/settings');

    expect(appearanceState.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { theme: 'light', language: 'en' },
    );
  });

  it('rejects an invalid single-setting appearance write before persistence or native updates', async () => {
    appearanceState.parseJsonBody.mockResolvedValue({ value: 'sepia' });

    await handleSettingsRoute('PUT', '/api/settings/theme');

    expect(appearanceState.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      400,
      { success: false, error: 'Invalid theme preference' },
    );
    expect(appearanceState.setSetting).not.toHaveBeenCalled();
    expect(appearanceState.themeSourceWrites).not.toHaveBeenCalled();
  });

  it('rejects an invalid patch appearance write before persistence or native updates', async () => {
    appearanceState.parseJsonBody.mockResolvedValue({ theme: 'sepia' });

    await handleSettingsRoute('PUT', '/api/settings');

    expect(appearanceState.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      400,
      { success: false, error: 'Invalid theme preference' },
    );
    expect(appearanceState.setSetting).not.toHaveBeenCalled();
    expect(appearanceState.themeSourceWrites).not.toHaveBeenCalled();
  });

  it('persists a valid single-setting appearance write before syncing native appearance', async () => {
    appearanceState.parseJsonBody.mockResolvedValue({ value: 'dark' });

    await handleSettingsRoute('PUT', '/api/settings/theme');

    expect(appearanceState.setSetting).toHaveBeenCalledWith('theme', 'dark');
    expect(appearanceState.nativeTheme.themeSource).toBe('dark');
    expect(appearanceState.setSetting.mock.invocationCallOrder[0]).toBeLessThan(
      appearanceState.themeSourceWrites.mock.invocationCallOrder[0],
    );
    expect(appearanceState.sendJson).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });

  it('synchronizes native appearance after resetting settings', async () => {
    appearanceState.getSetting.mockResolvedValue('dark');
    appearanceState.getAllSettings.mockResolvedValue({ autoCheckUpdate: false });

    await handleSettingsRoute('POST', '/api/settings/reset');

    expect(appearanceState.resetSettings).toHaveBeenCalledTimes(1);
    expect(appearanceState.getSetting).toHaveBeenCalledWith('theme');
    expect(appearanceState.nativeTheme.themeSource).toBe('dark');
    expect(appearanceState.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { success: true, settings: { autoCheckUpdate: false } },
    );
  });
});
