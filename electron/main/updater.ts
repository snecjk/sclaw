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
import { getSetting } from '../utils/store';
import {
  resolveUpdatePolicy,
  sendClientUpdateEventsFireAndForget,
  writePendingInstallReport,
  getMemoryCenterApiOrigin,
  type ResolveFailureReason,
} from '../services/client-update-platform';
import { getCurrentEnvConfig } from '../../shared/env-config';

/** OSS base URL determined by build environment (env-config) */
const OSS_BASE_URL = getCurrentEnvConfig().updateBaseUrl;

/** autoUpdater.checkForUpdates() 超时时间 (ms) */
const CHECK_UPDATER_TIMEOUT_MS = 30_000;

/** 与 memory-center 发版默认 check_interval_seconds 一致 */
const DEFAULT_CHECK_INTERVAL_SEC = 21600;
const MIN_CHECK_INTERVAL_SEC = 300;
const MAX_CHECK_INTERVAL_SEC = 7 * 24 * 3600;
/** 启动后首次自动检查延迟（秒），与原先渲染进程行为接近 */
const STARTUP_CHECK_DELAY_MS = 10_000;

function clampCheckIntervalSec(sec: number | undefined | null): number {
  const v =
    typeof sec === 'number' && Number.isFinite(sec) ? Math.floor(sec) : DEFAULT_CHECK_INTERVAL_SEC;
  return Math.min(Math.max(v, MIN_CHECK_INTERVAL_SEC), MAX_CHECK_INTERVAL_SEC);
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
  /** Server gray: update_offered false — do not use public feed (UI copy differs from "latest") */
  policyBlocked?: boolean;
  /** 解析失败的详细原因（resolve_failed 时填充） */
  resolveFailure?: ResolveFailureReason | null;
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

  /** Next scheduled interval after resolve (ms); default 6h */
  private nextCheckIntervalMs = DEFAULT_CHECK_INTERVAL_SEC * 1000;
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  /** First auto-check after launch uses short delay; cleared after any check completes */
  private useStartupDelayForNextSchedule = true;

  /** Whether download_start has already been reported for the current update cycle (avoids double-report). */
  private _downloadStartReported = false;

  /** Whether a checkForUpdates call is already in-flight (prevents re-entry). */
  private _checking = false;

  /** 递增的检查代数，用于过滤上一轮超时后到来的 stale 事件。 */
  private _checkGeneration = 0;

  /** 当前代数发起时的 snapshot，stale 事件/错误不更新 UI。 */
  private _activeGeneration = 0;

  /** 上一轮 autoUpdater.checkForUpdates() 的 pending Promise，新检查前需等待它 settle。 */
  private _pendingCheckPromise: Promise<unknown> | null = null;

  /** 当前使用的 feed URL（用于诊断日志）。 */
  private _currentFeedUrl = '';
  /** 当前使用的 channel（用于诊断日志）。 */
  private _currentChannel = '';
  /** 最近一次 resolve API 的 URL（用于诊断日志）。 */
  private _lastResolveUrl = '';

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
    this._currentFeedUrl = url;
    this._currentChannel = channel;
    logger.info(`[Updater] Built-in feed: ${url} (channel=${channel})`);
  }

  /**
   * Resolve server policy when logged in (stoToken). No token → built-in OSS.
   * Logged-in but resolve 失败 → hold（不回退公网），与灰度语义一致。
   * @returns 'hold' = do not call electron-updater (gray miss)
   */
  private async applyServerPolicyBeforeCheck(): Promise<{
    gate: 'proceed' | 'hold';
    checkIntervalSec: number;
    /** hold 原因：灰度未命中 vs 已登录但 resolve 请求失败（勿回退公网 feed） */
    holdReason?: 'gray' | 'resolve_failed';
    /** resolve 失败的详细原因 */
    resolveFailure?: ResolveFailureReason | null;
  }> {
    const version = app.getVersion();
    const platform = process.platform;
    const defaultInterval = DEFAULT_CHECK_INTERVAL_SEC;

    const token = await getStoToken();
    if (!token) {
      this.applyBuiltInFeed(version);
      this.lastFeedSlug = null;
      this.nextCheckIntervalMs = defaultInterval * 1000;
      return { gate: 'proceed', checkIntervalSec: defaultInterval };
    }

    const env = await getSsoEnvironment();
    // 记录 resolve API URL 用于诊断
    this._lastResolveUrl = `${getMemoryCenterApiOrigin(env)}/api/v1/client-updates/resolve`;
    const result = await resolveUpdatePolicy(token, env, {
      current_version: version,
      platform,
    });

    const feedSlugForTelemetry = result.ok ? result.data.feed_slug ?? null : null;
    sendClientUpdateEventsFireAndForget(env, [
      {
        event_type: 'policy_resolve',
        client_version: version,
        feed_slug: feedSlugForTelemetry,
        platform,
      },
    ]);

    if (!result.ok) {
      const { reason } = result;
      const isDev = getCurrentEnvConfig().isDevelopment;
      logger.warn(
        `[Updater] resolve failed (with stoToken): HTTP ${reason.httpStatus}` +
        (reason.serverMessage ? ` msg=${reason.serverMessage}` : '') +
        (reason.exceptionMessage ? ` exc=${reason.exceptionMessage}` : '') +
        (isDev ? ' [DEV fallback to built-in feed]' : ' — hold, no public feed fallback'),
      );
      this.lastFeedSlug = null;
      this.nextCheckIntervalMs = defaultInterval * 1000;

      // DEV 模式：resolve 失败时回退到内置 OSS feed，避免开发环境无法检查更新
      if (isDev) {
        this.applyBuiltInFeed(version);
        return { gate: 'proceed', checkIntervalSec: defaultInterval, resolveFailure: reason };
      }

      return {
        gate: 'hold',
        checkIntervalSec: defaultInterval,
        holdReason: 'resolve_failed',
        resolveFailure: reason,
      };
    }

    const data = result.data;
    const checkIntervalSec = clampCheckIntervalSec(data.check_interval_seconds);
    this.nextCheckIntervalMs = checkIntervalSec * 1000;

    this.lastFeedSlug = data.feed_slug ?? null;

    if (!data.update_offered) {
      logger.info('[Updater] Server policy: update not offered for this user (gray hold)');
      return { gate: 'hold', checkIntervalSec, holdReason: 'gray' };
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
      this._currentFeedUrl = base;
      this._currentChannel = ch;
      logger.info(`[Updater] Server feed: ${base} (channel=${ch})`);
      return { gate: 'proceed', checkIntervalSec };
    }

    logger.warn('[Updater] resolve had no feed_base_url — using built-in feed');
    this.applyBuiltInFeed(version);
    return { gate: 'proceed', checkIntervalSec };
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
      // 如果上一轮超时了，忽略这个 stale 事件
      if (this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale checking-for-update event (previous check timed out)');
        return;
      }
      this.updateStatus({ status: 'checking' });
      this.emit('checking-for-update');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale update-available event (previous check timed out)');
        return;
      }
      if (autoUpdater.autoDownload) {
        this._downloadStartReported = true;
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
      if (this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale update-not-available event (previous check timed out)');
        return;
      }
      this.updateStatus({ status: 'not-available', info, policyBlocked: false });
      this.emit('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      if (this._checkGeneration !== this._activeGeneration) return;
      this.updateStatus({ status: 'downloading', progress });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      if (this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale update-downloaded event (previous check timed out)');
        return;
      }
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
      // 如果是超时后的 stale error，不更新 UI 状态
      if (this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale autoUpdater error after timeout:', error.message);
        return;
      }
      // 将 electron-updater 英文错误转成用户友好的中文提示
      const raw = error.message || '';
      let friendly: string;
      if (raw.includes('net::') || raw.includes('ERR_')) {
        friendly = '网络连接异常，请检查网络后重试';
      } else if (raw.includes('signature') || raw.includes('checksum') || raw.includes('sha512')) {
        friendly = '更新包校验失败，请重试或联系管理员';
      } else if (raw.includes('ENOENT') || raw.includes('not found') || raw.includes('Could not find')) {
        friendly = '未找到可用更新，请稍后重试';
      } else if (raw.includes('permission') || raw.includes('EACCES')) {
        friendly = '权限不足，无法安装更新';
      } else if (raw.includes('cancel')) {
        friendly = '更新已取消';
      } else {
        friendly = '更新出错，请稍后重试';
      }
      // 附加诊断信息：原始错误 + 当前 feed URL，方便定位问题
      const diagParts: string[] = [];
      if (this._currentFeedUrl) diagParts.push(`Feed: ${this._currentFeedUrl}`);
      if (this._currentChannel) diagParts.push(`Channel: ${this._currentChannel}`);
      if (raw) diagParts.push(`原始错误: ${raw}`);
      const diagnostic = diagParts.length > 0 ? `\n\n[诊断] ${diagParts.join(' | ')}` : '';
      const fullError = friendly + diagnostic;
      logger.error(`[Updater] autoUpdater error (feed=${this._currentFeedUrl}, channel=${this._currentChannel}): ${raw}`);
      this.updateStatus({ status: 'error', error: fullError });
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
      resolveFailure:
        newStatus.resolveFailure !== undefined ? newStatus.resolveFailure : this.status.resolveFailure,
    };
    this.sendToRenderer('update:status-changed', this.status);
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  private clearPeriodicCheckTimer(): void {
    if (this.periodicCheckTimer) {
      clearTimeout(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
    }
  }

  /**
   * If auto-check is enabled, schedule the next run: first time after launch uses a short delay,
   * then uses server `check_interval_seconds` (default 6h).
   */
  private async reschedulePeriodicCheckIfEnabled(): Promise<void> {
    const enabled = await getSetting('autoCheckUpdate');
    if (!enabled) {
      this.clearPeriodicCheckTimer();
      return;
    }
    this.clearPeriodicCheckTimer();
    const delay = this.useStartupDelayForNextSchedule
      ? STARTUP_CHECK_DELAY_MS
      : this.nextCheckIntervalMs;
    this.periodicCheckTimer = setTimeout(() => {
      this.periodicCheckTimer = null;
      void this.checkForUpdates({ periodic: true }).catch((err) => {
        logger.warn('[Updater] Periodic update check failed:', err);
      });
    }, delay);
    logger.info(`[Updater] Next auto update check in ${Math.round(delay / 1000)}s`);
  }

  /**
   * Call when `autoCheckUpdate` changes or after app registers update handlers.
   * @param freshStart — if true, next scheduled check uses startup delay (e.g. user re-enabled auto-check).
   */
  async syncPeriodicCheckFromSettings(freshStart = false): Promise<void> {
    if (freshStart) {
      this.useStartupDelayForNextSchedule = true;
    }
    const enabled = await getSetting('autoCheckUpdate');
    if (!enabled) {
      this.clearPeriodicCheckTimer();
      return;
    }
    await this.reschedulePeriodicCheckIfEnabled();
  }

  async checkForUpdates(opts?: { periodic?: boolean }): Promise<UpdateInfo | null> {
    const periodic = opts?.periodic === true;

    // 防重入：如果已在检查中，直接返回
    if (this._checking) {
      logger.info('[Updater] checkForUpdates already in progress, skipping');
      return null;
    }
    this._checking = true;
    // 递增代数，新事件只有匹配 activeGeneration 才会被处理
    this._checkGeneration++;
    this._activeGeneration = this._checkGeneration;

    const prevSnapshot = periodic ? { ...this.status } : null;
    this._downloadStartReported = false;
    try {
      const packaged = app.isPackaged;

      this.updateStatus({ status: 'checking', policyBlocked: false });

      // applyServerPolicyBeforeCheck 内部调用 getStoToken/getSsoEnvironment/resolveUpdatePolicy
      // resolveUpdatePolicy 已有 20s 超时；为整个 applyServerPolicyBeforeCheck 加 25s 兜底
      const policyResult = await Promise.race<{
        gate: 'proceed' | 'hold';
        checkIntervalSec: number;
        holdReason?: 'gray' | 'resolve_failed';
        resolveFailure?: ResolveFailureReason | null;
      }>([
        this.applyServerPolicyBeforeCheck(),
        new Promise((resolve) =>
          setTimeout(() => {
            logger.warn('[Updater] applyServerPolicyBeforeCheck timed out after 25s');
            resolve({
              gate: 'hold',
              checkIntervalSec: DEFAULT_CHECK_INTERVAL_SEC,
              holdReason: 'resolve_failed' as const,
              resolveFailure: { httpStatus: 0, exceptionMessage: '策略请求超时（25秒未响应）' },
            });
          }, 25_000),
        ),
      ]);

      const { gate, holdReason, resolveFailure } = policyResult;
      if (gate === 'hold') {
        if (holdReason === 'resolve_failed') {
          // 构造用户友好的中文错误消息
          let detail = '';
          if (resolveFailure) {
            if (resolveFailure.httpStatus === 0) {
              // 网络层错误
              const exc = resolveFailure.exceptionMessage ?? '';
              if (exc.includes('CONNECTION_CLOSED')) {
                detail = '与服务器的连接被中断，请检查网络后重试';
              } else if (exc.includes('CONNECTION_REFUSED')) {
                detail = '无法连接到更新服务器，请检查网络';
              } else if (exc.includes('CERT') || exc.includes('SSL') || exc.includes('TLS')) {
                detail = '安全连接失败，请检查网络环境';
              } else if (exc.includes('TIMEOUT') || exc.includes('timed out')) {
                detail = '连接超时，请稍后重试';
              } else if (exc.includes('ENOTFOUND') || exc.includes('getaddrinfo')) {
                detail = '无法解析服务器地址，请检查网络';
              } else {
                detail = '网络连接失败，请检查网络后重试';
              }
            } else if (resolveFailure.httpStatus === 401) {
              detail = '登录已过期，请重新登录后重试';
            } else if (resolveFailure.httpStatus === 403) {
              detail = '没有更新权限，请联系管理员';
            } else if (resolveFailure.httpStatus === 404) {
              detail = '更新服务暂不可用，请稍后重试';
            } else if (resolveFailure.httpStatus >= 500) {
              detail = '服务器异常，请稍后重试';
            } else {
              detail = '更新服务暂不可用，请稍后重试';
            }
          }
          const errorMsg = detail
            ? `无法检查更新：${detail}`
            : '无法检查更新，请检查网络或稍后重试';
          // 附加 resolve API URL 诊断信息
          const resolveDiag = this._lastResolveUrl ? `\n\n[诊断] Resolve: ${this._lastResolveUrl}` : '';
          this.updateStatus({
            status: 'error',
            error: errorMsg + resolveDiag,
            policyBlocked: false,
            resolveFailure,
          });
        } else {
          this.updateStatus({ status: 'not-available', policyBlocked: true });
        }
        return null;
      }

      this.emitUpdateCheckTelemetry();

      // 诊断日志：记录即将使用的 feed URL
      logger.info(`[Updater] About to call autoUpdater.checkForUpdates() — feed=${this._currentFeedUrl} channel=${this._currentChannel} packaged=${String(packaged)}`);

      // 等待上一轮 autoUpdater.checkForUpdates() 彻底 settle，防止并发调用
      if (this._pendingCheckPromise) {
        logger.info('[Updater] Waiting for previous autoUpdater.checkForUpdates() to settle before starting new check');
        await this._pendingCheckPromise.catch(() => {});
        this._pendingCheckPromise = null;
      }

      // autoUpdater.checkForUpdates() 可能在网络异常时永远不 resolve/reject，加超时保护
      const checkPromise = autoUpdater.checkForUpdates();
      this._pendingCheckPromise = checkPromise;
      const result = await Promise.race([
        checkPromise,
        new Promise<null>((resolve) =>
          setTimeout(() => {
            logger.warn(`[Updater] autoUpdater.checkForUpdates() timed out after ${CHECK_UPDATER_TIMEOUT_MS / 1000}s`);
            // 递增代数，后续所有事件都会因为代数不匹配被忽略
            this._checkGeneration++;
            resolve(null);
          }, CHECK_UPDATER_TIMEOUT_MS),
        ),
      ]);

      if (result == null) {
        if (!packaged) {
          if (periodic && prevSnapshot) {
            this.updateStatus({ ...prevSnapshot });
          } else {
            this.updateStatus({
              status: 'not-available',
              policyBlocked: false,
            });
            logger.info('[Updater] App not packaged — auto-update not available in dev mode');
          }
          return null;
        }
        this.updateStatus({
          status: 'error',
          error: '检查更新超时，请检查网络后重试',
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
      if (periodic && prevSnapshot) {
        this.updateStatus({ ...prevSnapshot });
        return null;
      }
      const msg = (error as Error).message || String(error);
      const friendlyBase = msg.includes('net::') || msg.includes('ERR_')
        ? '网络连接异常，请检查网络后重试'
        : `检查更新失败，请稍后重试`;
      // 附加诊断信息
      const diagParts: string[] = [];
      if (this._currentFeedUrl) diagParts.push(`Feed: ${this._currentFeedUrl}`);
      if (this._currentChannel) diagParts.push(`Channel: ${this._currentChannel}`);
      if (msg) diagParts.push(`原始错误: ${msg}`);
      const diagnostic = diagParts.length > 0 ? `\n\n[诊断] ${diagParts.join(' | ')}` : '';
      this.updateStatus({
        status: 'error',
        error: friendlyBase + diagnostic,
        policyBlocked: false,
      });
      throw error;
    } finally {
      this._checking = false;
      this.useStartupDelayForNextSchedule = false;
      void this.reschedulePeriodicCheckIfEnabled();
    }
  }

  async downloadUpdate(): Promise<void> {
    const tv = (this.status.info as UpdateInfo | undefined)?.version;
    if (!this._downloadStartReported) {
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
      this._downloadStartReported = true;
    }
    try {
      // autoUpdater.downloadUpdate() 可能在网络异常时挂起，加超时保护 (10 分钟)
      const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
      await Promise.race([
        autoUpdater.downloadUpdate(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error('下载超时，请检查网络后重试')),
            DOWNLOAD_TIMEOUT_MS,
          ),
        ),
      ]);
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

  void updater.syncPeriodicCheckFromSettings();
}

export const appUpdater = new AppUpdater();
