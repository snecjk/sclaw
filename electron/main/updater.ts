/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater
 *
 * When packaged and the user has a valid stoToken, the feed URL is resolved via
 * memory-center POST /api/v1/client-updates/resolve (gray / cohort). Otherwise
 * falls back to built-in OSS paths (electron-builder.yml + OSS_BASE_URL).
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { BrowserWindow, app, ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { setQuitting } from './app-state';
import { getSsoEnvironment, getStoToken } from '../utils/auth-store';
import {
  resolveUpdatePolicy,
  sendClientUpdateEventsFireAndForget,
  writePendingInstallReport,
} from '../services/client-update-platform';

/** 公网 OSS 根（与 memory-center client.update.oss.public.base 一致；无尾斜杠；channel 如 latest 拼在路径上） */
const OSS_BASE_URL = 'https://ali-sto-wisdom-star.aliyuncs.com';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
  /** Server gray: update_offered false — do not use public feed (UI copy differs from "latest") */
  policyBlocked?: boolean;
}

export interface UpdaterEvents {
  'status-changed': (status: UpdateStatus) => void;
  'checking-for-update': () => void;
  'update-available': (info: UpdateInfo) => void;
  'update-not-available': (info: UpdateInfo) => void;
  'download-progress': (progress: ProgressInfo) => void;
  'update-downloaded': (event: UpdateDownloadedEvent) => void;
  'error': (error: Error) => void;
}

/**
 * Detect the update channel from a semver version string.
 * e.g. "0.1.8-alpha.0" → "alpha", "1.0.0-beta.1" → "beta", "1.0.0" → "latest"
 */
function detectChannel(version: string): string {
  const match = version.match(/-([a-zA-Z]+)/);
  return match ? match[1] : 'latest';
}

function builtInFeedForVersion(version: string): { url: string; channel: string } {
  const channel = detectChannel(version);
  return { url: `${OSS_BASE_URL}/${channel}`, channel };
}

export class AppUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private autoInstallTimer: NodeJS.Timeout | null = null;
  private autoInstallCountdown = 0;
  /** Last server resolve feed_slug (telemetry) */
  private lastFeedSlug: string | null = null;

  /** Delay (in seconds) before auto-installing a downloaded update. */
  private static readonly AUTO_INSTALL_DELAY_SECONDS = 5;

  constructor() {
    super();

    this.on('error', (error: Error) => {
      logger.error('[Updater] AppUpdater emitted error:', error);
    });

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.logger = {
      info: (msg: string) => logger.info('[Updater]', msg),
      warn: (msg: string) => logger.warn('[Updater]', msg),
      error: (msg: string) => logger.error('[Updater]', msg),
      debug: (msg: string) => logger.debug('[Updater]', msg),
    };

    const { url, channel } = builtInFeedForVersion(app.getVersion());
    logger.info(`[Updater] Version: ${app.getVersion()}, channel: ${channel}, feedUrl: ${url}`);

    autoUpdater.channel = channel;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url,
      useMultipleRangeRequest: false,
    });

    this.setupListeners();
  }

  private applyBuiltInFeed(version: string): void {
    const { url, channel } = builtInFeedForVersion(version);
    autoUpdater.channel = channel;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url,
      useMultipleRangeRequest: false,
    });
    logger.info(`[Updater] Built-in feed: ${url} (channel=${channel})`);
  }

  /**
   * Resolve server policy when logged in; fall back to built-in OSS on errors / no token.
   * @returns 'hold' = do not call electron-updater (gray miss)
   */
  private async applyServerPolicyBeforeCheck(): Promise<'proceed' | 'hold'> {
    const version = app.getVersion();
    const platform = process.platform;

    const token = await getStoToken();
    if (!token) {
      this.applyBuiltInFeed(version);
      this.lastFeedSlug = null;
      return 'proceed';
    }

    const env = await getSsoEnvironment();
    const data = await resolveUpdatePolicy(token, env, {
      current_version: version,
      platform,
    });

    sendClientUpdateEventsFireAndForget(env, [
      {
        event_type: 'policy_resolve',
        client_version: version,
        feed_slug: data?.feed_slug ?? null,
        platform,
      },
    ]);

    if (!data) {
      logger.warn('[Updater] resolve failed — using built-in feed');
      this.applyBuiltInFeed(version);
      this.lastFeedSlug = null;
      return 'proceed';
    }

    this.lastFeedSlug = data.feed_slug ?? null;

    if (!data.update_offered) {
      logger.info('[Updater] Server policy: update not offered for this user (gray hold)');
      return 'hold';
    }

    const base = (data.feed_base_url || '').trim().replace(/\/$/, '');
    const ch = (data.electron_channel || '').trim() || detectChannel(version);

    if (base) {
      autoUpdater.channel = ch;
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: base,
        useMultipleRangeRequest: false,
      });
      logger.info(`[Updater] Server feed: ${base} (channel=${ch})`);
      return 'proceed';
    }

    logger.warn('[Updater] resolve had no feed_base_url — using built-in feed');
    this.applyBuiltInFeed(version);
    return 'proceed';
  }

  private emitUpdateCheckTelemetry(): void {
    void getSsoEnvironment().then((env) => {
      sendClientUpdateEventsFireAndForget(env, [
        {
          event_type: 'update_check',
          client_version: app.getVersion(),
          feed_slug: this.lastFeedSlug,
          platform: process.platform,
        },
      ]);
    });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ status: 'checking' });
      this.emit('checking-for-update');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (autoUpdater.autoDownload) {
        void getSsoEnvironment().then((env) => {
          sendClientUpdateEventsFireAndForget(env, [
            {
              event_type: 'download_start',
              client_version: app.getVersion(),
              target_version: info.version,
              feed_slug: this.lastFeedSlug,
              platform: process.platform,
            },
          ]);
        });
      }
      this.updateStatus({ status: 'available', info, policyBlocked: false });
      this.emit('update-available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateStatus({ status: 'not-available', info, policyBlocked: false });
      this.emit('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({ status: 'downloading', progress });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      void getSsoEnvironment().then((env) => {
        sendClientUpdateEventsFireAndForget(env, [
          {
            event_type: 'download_complete',
            client_version: app.getVersion(),
            target_version: event.version,
            feed_slug: this.lastFeedSlug,
            platform: process.platform,
          },
        ]);
      });
      this.updateStatus({ status: 'downloaded', info: event });
      this.emit('update-downloaded', event);

      if (autoUpdater.autoDownload) {
        this.startAutoInstallCountdown();
      }
    });

    autoUpdater.on('error', (error: Error) => {
      this.updateStatus({ status: 'error', error: error.message });
      this.emit('error', error);
    });
  }

  private updateStatus(newStatus: Partial<UpdateStatus>): void {
    this.status = {
      status: newStatus.status ?? this.status.status,
      info: newStatus.info !== undefined ? newStatus.info : this.status.info,
      progress: newStatus.progress !== undefined ? newStatus.progress : this.status.progress,
      error: newStatus.error !== undefined ? newStatus.error : this.status.error,
      policyBlocked:
        newStatus.policyBlocked !== undefined ? newStatus.policyBlocked : this.status.policyBlocked,
    };
    this.sendToRenderer('update:status-changed', this.status);
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      const packaged = app.isPackaged;

      this.updateStatus({ status: 'checking', policyBlocked: false });

      const gate = await this.applyServerPolicyBeforeCheck();
      if (gate === 'hold') {
        this.updateStatus({ status: 'not-available', policyBlocked: true });
        return null;
      }

      this.emitUpdateCheckTelemetry();

      const result = await autoUpdater.checkForUpdates();

      if (result == null) {
        if (!packaged) {
          this.updateStatus({
            status: 'error',
            error: 'Update check skipped (dev mode – app is not packaged)',
            policyBlocked: false,
          });
          return null;
        }
        this.updateStatus({
          status: 'error',
          error: 'Update check did not return a result',
          policyBlocked: false,
        });
        return null;
      }

      if (this.status.status === 'checking' || this.status.status === 'idle') {
        this.updateStatus({ status: 'not-available', policyBlocked: false });
      }

      return result.updateInfo || null;
    } catch (error) {
      logger.error('[Updater] Check for updates failed:', error);
      this.updateStatus({
        status: 'error',
        error: (error as Error).message || String(error),
        policyBlocked: false,
      });
      throw error;
    }
  }

  async downloadUpdate(): Promise<void> {
    const tv = (this.status.info as UpdateInfo | undefined)?.version;
    void getSsoEnvironment().then((env) => {
      sendClientUpdateEventsFireAndForget(env, [
        {
          event_type: 'download_start',
          client_version: app.getVersion(),
          target_version: tv ?? null,
          feed_slug: this.lastFeedSlug,
          platform: process.platform,
        },
      ]);
    });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  quitAndInstall(): void {
    logger.info('[Updater] quitAndInstall called');
    setQuitting();
    const info = this.status.info as UpdateInfo | undefined;
    const tv = info?.version;
    if (tv && app.isPackaged) {
      void writePendingInstallReport({
        targetVersion: tv,
        feedSlug: this.lastFeedSlug,
      }).finally(() => {
        autoUpdater.quitAndInstall();
      });
      return;
    }
    autoUpdater.quitAndInstall();
  }

  private startAutoInstallCountdown(): void {
    this.clearAutoInstallTimer();
    this.autoInstallCountdown = AppUpdater.AUTO_INSTALL_DELAY_SECONDS;
    this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

    this.autoInstallTimer = setInterval(() => {
      this.autoInstallCountdown--;
      this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

      if (this.autoInstallCountdown <= 0) {
        this.clearAutoInstallTimer();
        this.quitAndInstall();
      }
    }, 1000);
  }

  cancelAutoInstall(): void {
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });
  }

  private clearAutoInstallTimer(): void {
    if (this.autoInstallTimer) {
      clearInterval(this.autoInstallTimer);
      this.autoInstallTimer = null;
    }
  }

  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    autoUpdater.channel = channel;
  }

  setAutoDownload(enable: boolean): void {
    autoUpdater.autoDownload = enable;
  }

  getCurrentVersion(): string {
    return app.getVersion();
  }
}

export function registerUpdateHandlers(
  updater: AppUpdater,
  mainWindow: BrowserWindow,
): void {
  updater.setMainWindow(mainWindow);

  ipcMain.handle('update:status', () => {
    return updater.getStatus();
  });

  ipcMain.handle('update:version', () => {
    return updater.getCurrentVersion();
  });

  ipcMain.handle('update:check', async () => {
    try {
      await updater.checkForUpdates();
      return { success: true, status: updater.getStatus() };
    } catch (error) {
      return { success: false, error: String(error), status: updater.getStatus() };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      await updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('update:install', () => {
    updater.quitAndInstall();
    return { success: true };
  });

  ipcMain.handle('update:setChannel', (_, channel: 'stable' | 'beta' | 'dev') => {
    updater.setChannel(channel);
    return { success: true };
  });

  ipcMain.handle('update:setAutoDownload', (_, enable: boolean) => {
    updater.setAutoDownload(enable);
    return { success: true };
  });

  ipcMain.handle('update:cancelAutoInstall', () => {
    updater.cancelAutoInstall();
    return { success: true };
  });
}

export const appUpdater = new AppUpdater();
