/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { clampSidebarPreferredWidth, SIDEBAR_DEFAULT_WIDTH } from '@/lib/sidebar-resize-metrics';
import { resolveSupportedLanguage } from '../../shared/language';
import {
  parseBrowserAutomationLevel,
  setBrowserAutomationSettingsLevel,
  type BrowserAutomationLevel,
} from '../../shared/browser-automation/feature-flag';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  personalizedMemoryEnabled: boolean;
  skillDiscoveryEnabled: boolean;
  preventSystemSleep: boolean;
  telemetryEnabled: boolean;
  browserAutomationLevel: BrowserAutomationLevel;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  /** User preferred sidebar width (200–400); display may clamp via effectiveMax */
  sidebarPreferredWidth: number;
  devModeUnlocked: boolean;
  /** 三栏预览区宽度占比（30–70），持久化记忆用户拖拽结果 */
  previewSplitPercent: number;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setPersonalizedMemoryEnabled: (value: boolean) => void;
  setSkillDiscoveryEnabled: (value: boolean) => Promise<void>;
  setPreventSystemSleep: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setBrowserAutomationLevel: (value: BrowserAutomationLevel) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarPreferredWidth: (width: number) => void;
  setDevModeUnlocked: (value: boolean) => void;
  setPreviewSplitPercent: (percent: number) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'light' as Theme,
  language: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
  startMinimized: false,
  launchAtStartup: false,
  personalizedMemoryEnabled: true,
  skillDiscoveryEnabled: true,
  preventSystemSleep: false,
  // Telemetry disabled by default for faster cold starts
  // Users can enable it in Settings > Advanced
  telemetryEnabled: false,
  browserAutomationLevel: 'dom' as BrowserAutomationLevel,
  gatewayAutoStart: true,
  gatewayPort: 18789,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: true,
  sidebarCollapsed: false,
  sidebarPreferredWidth: SIDEBAR_DEFAULT_WIDTH,
  devModeUnlocked: false,
  previewSplitPercent: 50,
  setupComplete: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApiFetch<Partial<typeof defaultSettings>>('/api/settings');
          const resolvedLanguage = settings.language
            ? resolveSupportedLanguage(settings.language)
            : undefined;
          const preferred = settings.sidebarPreferredWidth != null
            ? clampSidebarPreferredWidth(settings.sidebarPreferredWidth)
            : undefined;
          set((state) => {
            const next = {
              ...state,
              ...settings,
              ...(resolvedLanguage ? { language: resolvedLanguage } : {}),
              ...(preferred != null ? { sidebarPreferredWidth: preferred } : {}),
            };
            const level = parseBrowserAutomationLevel(next.browserAutomationLevel) ?? 'dom';
            next.browserAutomationLevel = level;
            setBrowserAutomationSettingsLevel(level);
            return next;
          });
          if (resolvedLanguage) {
            i18n.changeLanguage(resolvedLanguage);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApiFetch('/api/settings/theme', {
          method: 'PUT',
          body: JSON.stringify({ value: theme }),
        }).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApiFetch('/api/settings/language', {
          method: 'PUT',
          body: JSON.stringify({ value: resolvedLanguage }),
        }).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApiFetch('/api/settings/launchAtStartup', {
          method: 'PUT',
          body: JSON.stringify({ value: launchAtStartup }),
        }).catch(() => { });
      },
      setPersonalizedMemoryEnabled: (personalizedMemoryEnabled) => {
        set({ personalizedMemoryEnabled });
        void hostApiFetch('/api/settings/personalizedMemoryEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: personalizedMemoryEnabled }),
        }).catch(() => { });
      },
      setSkillDiscoveryEnabled: async (skillDiscoveryEnabled) => {
        const previous = get().skillDiscoveryEnabled;
        set({ skillDiscoveryEnabled });
        try {
          await hostApiFetch('/api/settings/skillDiscoveryEnabled', {
            method: 'PUT',
            body: JSON.stringify({ value: skillDiscoveryEnabled }),
          });
        } catch (error) {
          set({ skillDiscoveryEnabled: previous });
          throw error;
        }
      },
      setPreventSystemSleep: (preventSystemSleep) => {
        set({ preventSystemSleep });
        void hostApiFetch('/api/settings/preventSystemSleep', {
          method: 'PUT',
          body: JSON.stringify({ value: preventSystemSleep }),
        }).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApiFetch('/api/settings/telemetryEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: telemetryEnabled }),
        }).catch(() => { });
      },
      setBrowserAutomationLevel: (browserAutomationLevel) => {
        const level = parseBrowserAutomationLevel(browserAutomationLevel) ?? 'dom';
        setBrowserAutomationSettingsLevel(level);
        set({ browserAutomationLevel: level });
        void hostApiFetch('/api/settings/browserAutomationLevel', {
          method: 'PUT',
          body: JSON.stringify({ value: level }),
        }).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApiFetch('/api/settings/gatewayAutoStart', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayAutoStart }),
        }).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApiFetch('/api/settings/gatewayPort', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayPort }),
        }).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => {
        set({ autoCheckUpdate });
        void hostApiFetch('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ autoCheckUpdate }),
        }).catch(() => {});
      },
      setAutoDownloadUpdate: (autoDownloadUpdate) => {
        set({ autoDownloadUpdate });
        void hostApiFetch('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ autoDownloadUpdate }),
        }).catch(() => {});
      },
      setSidebarCollapsed: (sidebarCollapsed) => {
        set({ sidebarCollapsed });
        void hostApiFetch('/api/settings/sidebarCollapsed', {
          method: 'PUT',
          body: JSON.stringify({ value: sidebarCollapsed }),
        }).catch(() => { });
      },
      setSidebarPreferredWidth: (width) => {
        const sidebarPreferredWidth = clampSidebarPreferredWidth(width);
        set({ sidebarPreferredWidth });
        void hostApiFetch('/api/settings/sidebarPreferredWidth', {
          method: 'PUT',
          body: JSON.stringify({ value: sidebarPreferredWidth }),
        }).catch(() => { });
      },
      setPreviewSplitPercent: (previewSplitPercent) => set({
        previewSplitPercent: Math.max(30, Math.min(70, previewSplitPercent)),
      }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApiFetch('/api/settings/devModeUnlocked', {
          method: 'PUT',
          body: JSON.stringify({ value: devModeUnlocked }),
        }).catch(() => { });
      },
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'stoclaw-settings',
      version: 2,
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (fromVersion < 1) {
          return {
            ...p,
            autoCheckUpdate: true,
            autoDownloadUpdate: true,
            sidebarPreferredWidth: SIDEBAR_DEFAULT_WIDTH,
          };
        }
        if (fromVersion < 2) {
          const raw = p.sidebarPreferredWidth;
          return {
            ...p,
            sidebarPreferredWidth: clampSidebarPreferredWidth(
              typeof raw === 'number' ? raw : SIDEBAR_DEFAULT_WIDTH,
            ),
          };
        }
        return persisted;
      },
    }
  )
);
