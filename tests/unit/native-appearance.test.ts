import { beforeEach, describe, expect, it, vi } from 'vitest';

const appearanceState = vi.hoisted(() => {
  const nativeTheme = {
    themeSource: 'light' as 'light' | 'dark' | 'system',
    shouldUseDarkColors: false,
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
  };
  const spriteWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
  };
  const floatIconWindow = {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
  };
  return {
    nativeTheme,
    windows: [mainWindow, spriteWindow, floatIconWindow],
    mainWindow,
    spriteWindow,
    floatIconWindow,
    getSetting: vi.fn(),
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
}));

vi.mock('../../electron/main/sprite-window', () => ({
  getSpriteWindow: appearanceState.getSpriteWindow,
}));

vi.mock('../../electron/main/float-icon-window', () => ({
  getFloatIconWindow: appearanceState.getFloatIconWindow,
}));

import {
  applyNativeAppearancePreference,
  observeNativeAppearanceUpdates,
  resolveWindowBackgroundColor,
  syncNativeAppearanceFromStore,
} from '../../electron/main/appearance';

describe('native appearance', () => {
  beforeEach(() => {
    appearanceState.nativeTheme.themeSource = 'light';
    appearanceState.nativeTheme.shouldUseDarkColors = false;
    appearanceState.nativeTheme.on.mockReset();
    appearanceState.nativeTheme.removeListener.mockReset();
    appearanceState.getSetting.mockReset();
    appearanceState.getSpriteWindow.mockClear();
    appearanceState.getFloatIconWindow.mockClear();
    for (const window of appearanceState.windows) {
      window.isDestroyed.mockClear();
      window.setBackgroundColor.mockReset();
    }
  });

  it('maps native darkness to the approved shell colors', () => {
    expect(resolveWindowBackgroundColor(false)).toBe('#ededed');
    expect(resolveWindowBackgroundColor(true)).toBe('#0d0d0d');
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

  it('synchronizes the persisted preference before window creation', async () => {
    appearanceState.getSetting.mockResolvedValue('system');

    await syncNativeAppearanceFromStore();

    expect(appearanceState.getSetting).toHaveBeenCalledWith('theme');
    expect(appearanceState.nativeTheme.themeSource).toBe('system');
  });

  it('observes native changes once and updates opaque window backgrounds', () => {
    const firstCleanup = observeNativeAppearanceUpdates();
    const secondCleanup = observeNativeAppearanceUpdates();

    expect(appearanceState.nativeTheme.on).toHaveBeenCalledTimes(1);
    expect(appearanceState.nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));
    expect(secondCleanup).toBe(firstCleanup);

    appearanceState.nativeTheme.shouldUseDarkColors = true;
    const listener = appearanceState.nativeTheme.on.mock.calls[0][1] as () => void;
    listener();

    expect(appearanceState.mainWindow.setBackgroundColor).toHaveBeenCalledWith('#0d0d0d');
    expect(appearanceState.spriteWindow.setBackgroundColor).not.toHaveBeenCalled();
    expect(appearanceState.floatIconWindow.setBackgroundColor).not.toHaveBeenCalled();

    firstCleanup();
    expect(appearanceState.nativeTheme.removeListener).toHaveBeenCalledWith('updated', listener);
  });
});
