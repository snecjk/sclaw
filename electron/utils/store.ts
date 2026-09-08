/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import { app } from 'electron';
import { resolveSupportedLanguage } from '../../shared/language';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `stoclaw-${randomBytes(16).toString('hex')}`;
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  /** Whether answer preparation may retrieve personalized memory from the remote service. */
  personalizedMemoryEnabled: boolean;
  /** When true, keep the system awake while SClaw is running. */
  preventSystemSleep: boolean;
  telemetryEnabled: boolean;
  machineId: string;
  hasReportedInstall: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  gatewayToken: string;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];
  /** Set by main after one-shot migration to default-on update prefs */
  _updatePrefsMigrationV1?: boolean;

  // UI State
  sidebarCollapsed: boolean;
  /** User preferred sidebar width in px (200–400). */
  sidebarPreferredWidth: number;
  devModeUnlocked: boolean;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];
  /** Route a bounded Skill set per turn. When false, engines load every enabled installed Skill. */
  skillDiscoveryEnabled: boolean;

  // DingTalk dws
  dingTalkDwsEnabled: boolean;

  /**
   * 平台 Channel（钉钉等）空闲自动新会话：
   * 超过 channelSessionIdleHours 小时无对话则新建 sessionKey。
   * mobile 通道不走此逻辑（由 App 显式 sessionKey 控制）。
   */
  channelSessionIdleEnabled: boolean;
  /** 默认 24；合法范围由写入侧钳制 */
  channelSessionIdleHours: number;
}

/**
 * Default settings
 */
function getSystemLocale(): string {
  const preferredLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  return preferredLanguages[0]
    || (typeof app.getLocale === 'function' ? app.getLocale() : '')
    || Intl.DateTimeFormat().resolvedOptions().locale
    || 'en';
}

function createDefaultSettings(): AppSettings {
  return {
    // General
    theme: 'light',
    language: resolveSupportedLanguage(getSystemLocale()),
    startMinimized: false,
    launchAtStartup: false,
    personalizedMemoryEnabled: true,
    preventSystemSleep: false,
    // Telemetry is disabled by default for faster cold starts
    // Users can enable it in Settings > Advanced if they want to help improve the product
    telemetryEnabled: false,
    machineId: '',
    hasReportedInstall: false,

    // Gateway
    gatewayAutoStart: true,
    gatewayPort: 18789,
    gatewayToken: generateToken(),
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',

    // Update
    updateChannel: 'stable',
    autoCheckUpdate: true,
    autoDownloadUpdate: true,
    skippedVersions: [],

    // UI State
    sidebarCollapsed: false,
    sidebarPreferredWidth: 260,
    devModeUnlocked: false,

    // Presets
    selectedBundles: ['productivity', 'developer'],
    enabledSkills: [],
    disabledSkills: [],
    skillDiscoveryEnabled: true,

    // DingTalk dws
    dingTalkDwsEnabled: true,

    // Channel session idle → new session
    channelSessionIdleEnabled: true,
    channelSessionIdleHours: 24,
  };
}

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults: createDefaultSettings(),
    });
    const store = settingsStoreInstance;
    // Old installs persisted false; defaults alone do not overwrite. One-shot: turn on + mark done.
    if (!store.has('_updatePrefsMigrationV1')) {
      store.set('autoCheckUpdate', true);
      store.set('autoDownloadUpdate', true);
      store.set('_updatePrefsMigrationV1', true);
    }
    if (!store.has('sidebarPreferredWidth')) {
      store.set('sidebarPreferredWidth', 260);
    } else {
      const raw = store.get('sidebarPreferredWidth');
      if (typeof raw === 'number') {
        store.set('sidebarPreferredWidth', Math.min(400, Math.max(200, Math.round(raw))));
      } else {
        store.set('sidebarPreferredWidth', 260);
      }
    }
  }
  return settingsStoreInstance;
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  return store.get(key);
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const store = await getSettingsStore();
  if (key === 'sidebarPreferredWidth' && typeof value === 'number') {
    const clamped = Math.min(400, Math.max(200, Math.round(value)));
    store.set(key, clamped as AppSettings[K]);
    return;
  }
  store.set(key, value);
}

/**
 * Get all settings (omit internal migration flags from API surface)
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  const all = { ...store.store } as AppSettings & { _updatePrefsMigrationV1?: boolean };
  delete all._updatePrefsMigrationV1;
  return all;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  const store = await getSettingsStore();
  store.clear();
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(store.store, null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    const store = await getSettingsStore();
    store.set(settings);
  } catch {
    throw new Error('Invalid settings JSON');
  }
}
