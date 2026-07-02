/**
 * Update State Store
 * Manages application update state
 */
import { create } from 'zustand';
import { useSettingsStore } from './settings';
import { invokeIpc } from '@/lib/api-client';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  /** Release ticket title from memory-center resolve */
  title?: string | null;
}

export interface ProgressInfo {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'error';

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: ProgressInfo | null;
  error: string | null;
  /** Server gray: no update offered for this account */
  policyBlocked: boolean;
  isInitialized: boolean;
  /** Seconds remaining before auto-install, or null if inactive. */
  autoInstallCountdown: number | null;
  /** Seconds remaining before auto-restart after a successful manualInstall, or null. */
  restartCountdown: number | null;

  // Actions
  init: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  restartApp: () => Promise<void>;
  cancelRestartCountdown: () => Promise<void>;
  cancelAutoInstall: () => Promise<void>;
  setChannel: (channel: 'stable' | 'beta' | 'dev') => Promise<void>;
  setAutoDownload: (enable: boolean) => Promise<void>;
  clearError: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  currentVersion: '0.0.0',
  updateInfo: null,
  progress: null,
  error: null,
  policyBlocked: false,
  isInitialized: false,
  autoInstallCountdown: null,
  restartCountdown: null,

  init: async () => {
    if (get().isInitialized) return;

    // 给 IPC 调用加超时保护，避免 main 进程 handler 未注册 / 卡死时 UI 永远停在 Loading。
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      return Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
        ),
      ]);
    };

    // Get current version
    try {
      const version = await withTimeout(
        invokeIpc<string>('update:version'),
        8000,
        'update:version',
      );
      set({ currentVersion: version as string });
    } catch (error) {
      console.error('Failed to get version:', error);
    }

    // Get current status
    try {
      const status = await withTimeout(
        invokeIpc<{
          status: UpdateStatus;
          info?: UpdateInfo;
          progress?: ProgressInfo;
          error?: string;
          policyBlocked?: boolean;
        }>('update:status'),
        8000,
        'update:status',
      );
      set({
        status: status.status,
        updateInfo: status.info || null,
        progress: status.progress || null,
        error: status.error || null,
        policyBlocked: Boolean(status.policyBlocked),
      });
    } catch (error) {
      console.error('Failed to get update status:', error);
    }

    // Listen for update events
    // Single source of truth: listen only to update:status-changed
    // (sent by AppUpdater.updateStatus() in the main process)
    window.electron.ipcRenderer.on('update:status-changed', (data) => {
      const status = data as {
        status: UpdateStatus;
        info?: UpdateInfo;
        progress?: ProgressInfo;
        error?: string;
        policyBlocked?: boolean;
      };
      set({
        status: status.status,
        updateInfo: status.info || null,
        progress: status.progress || null,
        error: status.error || null,
        policyBlocked: Boolean(status.policyBlocked),
      });
    });

    window.electron.ipcRenderer.on('update:auto-install-countdown', (data) => {
      const { seconds, cancelled } = data as { seconds: number; cancelled?: boolean };
      set({ autoInstallCountdown: cancelled ? null : seconds });
    });

    window.electron.ipcRenderer.on('update:restart-countdown', (data) => {
      const { seconds, cancelled } = data as { seconds: number; cancelled?: boolean };
      set({ restartCountdown: cancelled ? null : seconds });
    });

    set({ isInitialized: true });

    // Apply persisted settings from the settings store
    const { autoDownloadUpdate } = useSettingsStore.getState();

    // Sync auto-download preference to the main process
    if (autoDownloadUpdate) {
      invokeIpc('update:setAutoDownload', true).catch(() => {});
    }
  },

  checkForUpdates: async () => {
    const { status } = get();
    // 防重入：已在检查中时不再触发
    if (status === 'checking') return;

    set({ status: 'checking', error: null, policyBlocked: false });
    
    try {
      const result = await Promise.race([
        invokeIpc('update:check'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('检查更新超时，请检查网络后重试')), 60000))
      ]) as {
        success: boolean;
        error?: string;
        status?: {
          status: UpdateStatus;
          info?: UpdateInfo;
          progress?: ProgressInfo;
          error?: string;
          policyBlocked?: boolean;
        };
      };
      
      if (result.status) {
        set({
          status: result.status.status,
          updateInfo: result.status.info || null,
          progress: result.status.progress || null,
          error: result.status.error || null,
          policyBlocked: Boolean(result.status.policyBlocked),
        });
      } else if (!result.success) {
        set({
          status: 'error',
          error: result.error || 'Failed to check for updates',
          policyBlocked: false,
        });
      }
    } catch (error) {
      set({ status: 'error', error: String(error), policyBlocked: false });
    } finally {
      // In dev mode autoUpdater skips without emitting events, so the
      // status may still be 'checking' or even 'idle'. Catch both.
      const currentStatus = get().status;
      if (currentStatus === 'checking' || currentStatus === 'idle') {
        set({
          status: 'not-available',
          policyBlocked: false,
        });
      }
    }
  },

  downloadUpdate: async () => {
    set({ status: 'downloading', error: null });
    
    try {
      const result = await invokeIpc<{
        success: boolean;
        error?: string;
      }>('update:download');
      
      if (!result.success) {
        set({ status: 'error', error: result.error || 'Failed to download update' });
      }
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },

  installUpdate: async () => {
    set({ status: 'installing', error: null });
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>('update:install');
      if (!result.success) {
        set({ status: 'error', error: result.error || 'Failed to install update' });
      }
      // 成功时，主进程会通过 'update:status-changed' 推送 status: 'installed'
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },

  restartApp: async () => {
    try {
      await invokeIpc('update:restart');
    } catch (error) {
      console.error('Failed to restart app:', error);
    }
  },

  cancelRestartCountdown: async () => {
    try {
      await invokeIpc('update:cancelRestartCountdown');
    } catch (error) {
      console.error('Failed to cancel restart countdown:', error);
    }
  },

  cancelAutoInstall: async () => {
    try {
      await invokeIpc('update:cancelAutoInstall');
    } catch (error) {
      console.error('Failed to cancel auto-install:', error);
    }
  },

  setChannel: async (channel) => {
    try {
      await invokeIpc('update:setChannel', channel);
    } catch (error) {
      console.error('Failed to set update channel:', error);
    }
  },

  setAutoDownload: async (enable) => {
    try {
      await invokeIpc('update:setAutoDownload', enable);
    } catch (error) {
      console.error('Failed to set auto-download:', error);
    }
  },

  clearError: () => set({ error: null, status: 'idle' }),
}));
