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
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const execFile = promisify(execFileCb);
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
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'installed'
    | 'error';
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
 * 固定返回 latest，所有客户端统一走 latest channel，不根据版本号后缀区分。
 */
function detectChannel(_version: string): string {
  return 'latest';
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

  /** Whether a download is currently in progress (regardless of who started it:
   *  UI-triggered downloadUpdate() or electron-updater's internal autoDownload).
   *  Used to suppress concurrent checks and to bypass stale-event filtering
   *  for in-flight downloads. */
  private _downloading = false;

  /** Timestamp (ms) of the most recent download-progress event; used by idle watchdog. */
  private _lastProgressAt = 0;

  /** Idle watchdog timer that runs while _downloading is true. */
  private _idleWatchdogTimer: NodeJS.Timeout | null = null;

  /** Rejector for the awaitable idle promise (only used when UI manually awaits downloadUpdate()). */
  private _idleRejecter: ((err: Error) => void) | null = null;

  /** Idle threshold (ms) — no download-progress for this long triggers an idle error. */
  private static readonly DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
  /** How often the idle watchdog checks (ms). */
  private static readonly DOWNLOAD_IDLE_TICK_MS = 5_000;

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

  /** Local path of the downloaded update file (zip/dmg), provided by electron-updater. */
  private _downloadedFilePath: string | null = null;

  /** Backup path of the old .app while a manual install is in progress (for rollback). */
  private _backupAppPath: string | null = null;

  /**
   * manualInstall 会把当前 .app rename 到 .old-*，process.execPath 仍指向备份里的可执行文件。
   * 服务端回滚版本后若用默认 relaunch，会再次拉起备份中的高版本，需显式指向原路径下的新 .app。
   */
  private _relaunchExecPath: string | null = null;

  /** Delay (ms) after the new version starts before purging the install backup. */
  private static readonly BACKUP_CLEANUP_DELAY_MS = 60_000;

  /** Restart-after-install countdown timer (replaces old auto-install timer for installed state). */
  private _restartCountdownTimer: NodeJS.Timeout | null = null;
  private _restartCountdown = 0;
  private static readonly RESTART_COUNTDOWN_SECONDS = 5;

  constructor() {
    super();

    this.on('error', (error: Error) => {
      logger.error('[Updater] AppUpdater emitted error:', error);
    });

    autoUpdater.autoDownload = false;
    // 禁用 electron-updater 内置的"app quit 时自动安装"机制，
    // 因为它走的是 Squirrel.Mac 路径，会触发代码签名校验失败。
    // manualInstall() 是我们唯一的安装入口（绕开 Squirrel）。
    autoUpdater.autoInstallOnAppQuit = false;

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
    const ch = 'latest'; // 固定 latest，忽略服务端返回的 channel

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

  /**
   * Enter "download protection" mode. Idempotent — calling multiple times is safe.
   * Must be invoked at the start of any download path:
   *   1. UI-triggered downloadUpdate() (manual)
   *   2. electron-updater's autoDownload path (auto, fires after update-available)
   *
   * What it does:
   *   - Sync generation counters so stale-event filter doesn't eat our events
   *   - Stop periodic update check to avoid contention with autoUpdater singleton
   *   - Start idle watchdog so download stalls surface as errors quickly
   */
  private beginDownloadProtection(): void {
    if (this._downloading) {
      logger.info('[Updater] beginDownloadProtection: already protecting an in-flight download');
      return;
    }
    this._activeGeneration = this._checkGeneration;
    this.clearPeriodicCheckTimer();
    this._downloading = true;
    this._lastProgressAt = Date.now();

    this._idleWatchdogTimer = setInterval(() => {
      const idleFor = Date.now() - this._lastProgressAt;
      if (idleFor <= AppUpdater.DOWNLOAD_IDLE_TIMEOUT_MS) return;

      logger.warn(`[Updater] Download idle for ${Math.round(idleFor / 1000)}s, aborting`);
      const err = new Error(
        `下载停滞超过 ${Math.round(AppUpdater.DOWNLOAD_IDLE_TIMEOUT_MS / 1000)} 秒，连接可能已中断，请检查网络后重试`,
      );

      // 1. 如果 UI 在 await downloadUpdate()，通过 reject 让外层 try/catch 抛错
      if (this._idleRejecter) {
        const r = this._idleRejecter;
        this._idleRejecter = null;
        r(err);
      }

      // 2. autoDownload 路径下没有外层 await：直接把错误状态推给 UI
      this.updateStatus({ status: 'error', error: err.message, policyBlocked: false });
      this.endDownloadProtection();
    }, AppUpdater.DOWNLOAD_IDLE_TICK_MS);

    logger.info('[Updater] beginDownloadProtection: protection armed (idle watchdog active)');
  }

  private endDownloadProtection(): void {
    if (!this._downloading) return;

    if (this._idleWatchdogTimer) {
      clearInterval(this._idleWatchdogTimer);
      this._idleWatchdogTimer = null;
    }
    this._idleRejecter = null;
    this._downloading = false;
    void this.reschedulePeriodicCheckIfEnabled();

    logger.info('[Updater] endDownloadProtection: protection released');
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
        // autoDownload 路径下 electron-updater 会绕过 AppUpdater.downloadUpdate() 直接开下，
        // 必须在这里手动 arm 下载保护，否则周期 check 干扰 + idle 看门狗都不会生效。
        this.beginDownloadProtection();
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
      // 下载期间不应用代数过滤：一旦 downloadUpdate() 开始，所有 progress
      // 事件都必须送达 UI，否则会出现"进度卡在某个百分比"的现象。
      if (!this._downloading && this._checkGeneration !== this._activeGeneration) return;
      this._lastProgressAt = Date.now();
      this.updateStatus({ status: 'downloading', progress });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      // 同 download-progress：下载完成事件必须送达，避免下载已成功但 UI 永远停在 downloading。
      if (!this._downloading && this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale update-downloaded event (previous check timed out)');
        return;
      }
      // 下载完成，关闭保护（清 idle 看门狗、恢复周期 check）
      this.endDownloadProtection();

      // 保存下载好的本地文件路径，manualInstall() 会用它解压并替换 .app
      this._downloadedFilePath = event.downloadedFile || null;
      logger.info(`[Updater] Downloaded file path: ${this._downloadedFilePath ?? '(missing)'}`);

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

      // 仅当用户在 settings 里开启了 "自动更新" 时，才下载完后自动启动 5 秒安装倒计时。
      // 关闭时停在 downloaded 状态，必须用户主动点 "立即安装"。
      if (autoUpdater.autoDownload) {
        this.startAutoInstallCountdown();
      }
    });

    autoUpdater.on('error', (error: Error) => {
      // 如果是超时后的 stale error，不更新 UI 状态
      if (!this._downloading && this._checkGeneration !== this._activeGeneration) {
        logger.warn('[Updater] Ignoring stale autoUpdater error after timeout:', error.message);
        return;
      }
      // 下载过程中出错：关闭保护，让外层 await 走 reject 路径
      if (this._downloading) {
        if (this._idleRejecter) {
          const r = this._idleRejecter;
          this._idleRejecter = null;
          r(error);
        }
        this.endDownloadProtection();
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
    // 下载进行中时跳过 check：autoUpdater 是全局单例，并发 check 会污染监听器状态
    // 并可能因 check 超时导致下载事件被代数过滤误伤。
    if (this._downloading) {
      logger.info('[Updater] checkForUpdates skipped because a download is in progress');
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
            // 递增代数，后续所有事件都会因为代数不匹配被忽略。
            // 但下载进行中时不要动代数，避免误伤 download-progress / update-downloaded 事件
            // （这些事件在下载期间已通过 _downloading 标志绕过代数过滤，但仍保留此判断作为双保险）。
            if (!this._downloading) {
              this._checkGeneration++;
            }
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
    if (this._downloading) {
      logger.info('[Updater] downloadUpdate already in progress, skipping duplicate call');
      return;
    }

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

    // beginDownloadProtection 会：同步 generation、暂停周期 check、armed idle 看门狗。
    // idle 超时时会通过 _idleRejecter（如果设置了）reject 当前 await，让外层 IPC 看到错误。
    this.beginDownloadProtection();
    const idlePromise = new Promise<never>((_resolve, reject) => {
      this._idleRejecter = reject;
    });

    try {
      await Promise.race([
        autoUpdater.downloadUpdate(),
        idlePromise,
      ]);
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    } finally {
      this.endDownloadProtection();
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

  /**
   * 手动安装：解压下载好的 zip，把当前 .app 改名备份，把新 .app 放到 /Applications，
   * 移除 com.apple.quarantine（绕开 Gatekeeper），然后切到 'installed' 状态。
   *
   * 完全不调用 Squirrel.Mac，因此不受其代码签名校验影响。
   * 失败时自动回滚（恢复备份）。
   *
   * Windows / Linux 仍走 electron-updater 内置 quitAndInstall。
   */
  async manualInstall(): Promise<void> {
    // 防重入：已经在安装中（用户在倒计时内手动点 + 倒计时归零并发）直接返回
    if (this.status.status === 'installing' || this.status.status === 'installed') {
      logger.info(`[Updater] manualInstall skipped, current status = ${this.status.status}`);
      return;
    }

    // 入口先把"5 秒自动安装倒计时"清掉，避免倒计时归零后又触发一次
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });

    // 仅 macOS 走自定义流程；其他平台沿用原 Squirrel/NSIS 路径
    if (process.platform !== 'darwin') {
      this.quitAndInstall();
      return;
    }

    if (!this._downloadedFilePath || !existsSync(this._downloadedFilePath)) {
      const msg = '未找到已下载的更新文件，请重试';
      logger.error(`[Updater] manualInstall: ${msg} (path=${this._downloadedFilePath ?? 'null'})`);
      this.updateStatus({ status: 'error', error: msg });
      throw new Error(msg);
    }

    this.updateStatus({ status: 'installing' });
    logger.info(`[Updater] manualInstall: starting (file=${this._downloadedFilePath})`);

    const zipPath = this._downloadedFilePath;
    const currentAppPath = app.getAppPath().replace(/\/Contents\/Resources\/app\.asar.*$/, '');
    // 兜底：若上面替换没拿到 .app 路径，尝试用 process.execPath 推导
    const appPath = currentAppPath.endsWith('.app')
      ? currentAppPath
      : path.dirname(path.dirname(path.dirname(process.execPath)));
    this._relaunchExecPath = path.join(appPath, 'Contents/MacOS', path.basename(process.execPath));
    logger.info(
      `[Updater] manualInstall: target app path = ${appPath}, relaunch exec = ${this._relaunchExecPath}`,
    );

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'stoclaw-install-'));
    let extractedAppPath: string | null = null;

    try {
      // 1. 解压 zip 到临时目录
      logger.info(`[Updater] manualInstall: extracting zip to ${tmpDir}`);
      await execFile('unzip', ['-q', zipPath, '-d', tmpDir]);

      const entries = await fsp.readdir(tmpDir);
      const appEntry = entries.find((n) => n.endsWith('.app'));
      if (!appEntry) {
        throw new Error('解压后未在压缩包中找到 .app');
      }
      extractedAppPath = path.join(tmpDir, appEntry);
      logger.info(`[Updater] manualInstall: extracted app = ${extractedAppPath}`);

      // 2. 备份旧 app（同设备 rename 是原子操作，运行中的进程仍可继续）
      const backupPath = `${appPath}.old-${Date.now()}`;
      if (existsSync(appPath)) {
        await fsp.rename(appPath, backupPath);
        this._backupAppPath = backupPath;
        logger.info(`[Updater] manualInstall: backed up old app to ${backupPath}`);
      }

      // 3. 把新 app 放到原位置（跨设备时 rename 会失败，fallback 到 cp -R）
      try {
        await fsp.rename(extractedAppPath, appPath);
      } catch (e) {
        logger.warn('[Updater] manualInstall: rename failed, falling back to cp -R', e);
        await execFile('cp', ['-R', extractedAppPath, appPath]);
      }

      // 4. 移除 quarantine 扩展属性（绕开 Gatekeeper）
      try {
        await execFile('xattr', ['-rd', 'com.apple.quarantine', appPath]);
        logger.info('[Updater] manualInstall: quarantine attribute removed');
      } catch (e) {
        // 没有 quarantine 属性时 xattr 也会 exit 非零，不算致命错误
        logger.warn('[Updater] manualInstall: xattr remove returned non-zero (may be normal)', e);
      }

      // 5. 不立即删备份，写一个 marker 到 userData，新版本启动后 60s 再清理。
      //    这样万一新版本启动崩溃，用户可以手动把 .app.old-* rename 回去恢复。
      if (this._backupAppPath) {
        const installedVersion = this.status.info?.version ?? null;
        await this.writeBackupMarker({
          backupPath: this._backupAppPath,
          installedVersion,
          createdAt: Date.now(),
        });
        logger.info(
          `[Updater] manualInstall: backup retained at ${this._backupAppPath}, ` +
          `marker written (will clean up after new version runs for ` +
          `${AppUpdater.BACKUP_CLEANUP_DELAY_MS / 1000}s)`,
        );
        this._backupAppPath = null;
      }
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      logger.info('[Updater] manualInstall: success, switching to installed state');
      this.updateStatus({ status: 'installed' });
      this.startRestartCountdown();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[Updater] manualInstall failed: ${msg}`);

      // 回滚：恢复备份的旧 app
      if (this._backupAppPath && existsSync(this._backupAppPath)) {
        try {
          if (existsSync(appPath)) {
            await fsp.rm(appPath, { recursive: true, force: true });
          }
          await fsp.rename(this._backupAppPath, appPath);
          logger.info(`[Updater] manualInstall: rolled back to backup ${this._backupAppPath}`);
        } catch (rollbackErr) {
          logger.error('[Updater] manualInstall: rollback failed', rollbackErr);
        }
        this._backupAppPath = null;
      }

      // 清理临时目录
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      this.updateStatus({ status: 'error', error: `安装失败: ${msg}` });
      this._relaunchExecPath = null;
      throw error;
    }
  }

  /** Marker 文件路径：记录待清理的旧版本备份。 */
  private getBackupMarkerPath(): string {
    return path.join(app.getPath('userData'), 'pending-backup-cleanup.json');
  }

  private async writeBackupMarker(marker: {
    backupPath: string;
    installedVersion: string | null;
    createdAt: number;
  }): Promise<void> {
    try {
      await fsp.writeFile(
        this.getBackupMarkerPath(),
        JSON.stringify(marker, null, 2),
        'utf-8',
      );
    } catch (e) {
      logger.warn('[Updater] writeBackupMarker failed:', e);
    }
  }

  private async readBackupMarker(): Promise<
    | { backupPath: string; installedVersion: string | null; createdAt: number }
    | null
  > {
    const markerPath = this.getBackupMarkerPath();
    if (!existsSync(markerPath)) return null;
    try {
      const raw = await fsp.readFile(markerPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed?.backupPath !== 'string') return null;
      return parsed;
    } catch (e) {
      logger.warn('[Updater] readBackupMarker parse failed:', e);
      return null;
    }
  }

  private async deleteBackupMarker(): Promise<void> {
    await fsp.rm(this.getBackupMarkerPath(), { force: true }).catch(() => {});
  }

  /**
   * 扫描 /Applications/ 下所有匹配 "<AppName>.app.old-<timestamp>" 模式的目录，
   * 立刻清理掉**孤立**的（即不在当前 marker 记录范围内的）。
   *
   * 场景：连续多次更新、上次清理被中断、跨机器拷贝等，可能在 /Applications/ 留下
   * 多个 .app.old-* 残留。marker 只记录最近一次的备份，其他需要主动扫描清理。
   *
   * 当前 marker 记录的那一个**不在这里删**，由 cleanupPendingBackup 走 60s 延迟流程。
   */
  private async cleanupOrphanedBackups(protectedPath: string | null): Promise<void> {
    try {
      // 推导出当前 app 所在目录和 basename："/Applications" + "S Claw"
      const currentAppPath = path.dirname(path.dirname(path.dirname(process.execPath)));
      if (!currentAppPath.endsWith('.app')) {
        logger.warn(`[Updater] cleanupOrphanedBackups: unexpected app path ${currentAppPath}`);
        return;
      }
      const appDir = path.dirname(currentAppPath);
      const appBaseName = path.basename(currentAppPath, '.app');
      const escapedName = appBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^${escapedName}\\.app\\.old-\\d+$`);

      const entries = await fsp.readdir(appDir);
      for (const entry of entries) {
        if (!pattern.test(entry)) continue;
        const fullPath = path.join(appDir, entry);
        if (protectedPath && fullPath === protectedPath) {
          // 这一个是 marker 记录的"刚装好的备份"，留给 60s 延迟清理流程处理
          continue;
        }
        logger.info(`[Updater] cleanupOrphanedBackups: removing orphan backup ${fullPath}`);
        await fsp.rm(fullPath, { recursive: true, force: true }).catch((e) => {
          logger.warn(`[Updater] cleanupOrphanedBackups: failed to remove ${fullPath}:`, e);
        });
      }
    } catch (e) {
      logger.warn('[Updater] cleanupOrphanedBackups: scan failed', e);
    }
  }

  /**
   * 启动时调用：
   *  1) 扫描并立刻清理 /Applications/ 下**所有孤立**的 .app.old-* 残留
   *  2) 对 marker 记录的"刚安装的备份"，延迟 BACKUP_CLEANUP_DELAY_MS 清理（给新版本试运行窗口）
   *
   * 如果用户已经手动 rename 备份回原位置（回滚），则 app.getVersion() 会变回旧版本，
   * marker 校验会失败，备份不会被清理，但 marker 会被删除（避免反复检查）。
   */
  async cleanupPendingBackup(): Promise<void> {
    if (process.platform !== 'darwin') return;
    const marker = await this.readBackupMarker();

    // 先把孤立备份立刻清掉（marker 记录的那个会被保护，不会误删）
    await this.cleanupOrphanedBackups(marker?.backupPath ?? null);

    if (!marker) return;

    const currentVersion = app.getVersion();
    const expected = marker.installedVersion;

    if (expected && expected !== currentVersion) {
      logger.warn(
        `[Updater] cleanupPendingBackup: version mismatch ` +
        `(expected=${expected}, current=${currentVersion}), ` +
        `备份可能被手动回滚，保留备份但删除 marker`,
      );
      await this.deleteBackupMarker();
      return;
    }

    if (!existsSync(marker.backupPath)) {
      logger.info('[Updater] cleanupPendingBackup: backup already gone, removing marker');
      await this.deleteBackupMarker();
      return;
    }

    logger.info(
      `[Updater] cleanupPendingBackup: will purge ${marker.backupPath} ` +
      `in ${AppUpdater.BACKUP_CLEANUP_DELAY_MS / 1000}s`,
    );

    // 延迟清理：给新版本 60 秒"试运行"窗口，确保没崩
    setTimeout(() => {
      void (async () => {
        try {
          if (existsSync(marker.backupPath)) {
            await fsp.rm(marker.backupPath, { recursive: true, force: true });
            logger.info(`[Updater] cleanupPendingBackup: removed backup ${marker.backupPath}`);
          }
          await this.deleteBackupMarker();
        } catch (e) {
          logger.warn('[Updater] cleanupPendingBackup: cleanup failed:', e);
        }
      })();
    }, AppUpdater.BACKUP_CLEANUP_DELAY_MS).unref();
  }

  /** 开始重启倒计时，结束后自动调用 restartApp()。 */
  private startRestartCountdown(): void {
    this.clearRestartCountdownTimer();
    this._restartCountdown = AppUpdater.RESTART_COUNTDOWN_SECONDS;
    this.sendToRenderer('update:restart-countdown', { seconds: this._restartCountdown });

    this._restartCountdownTimer = setInterval(() => {
      this._restartCountdown--;
      this.sendToRenderer('update:restart-countdown', { seconds: this._restartCountdown });

      if (this._restartCountdown <= 0) {
        this.clearRestartCountdownTimer();
        this.restartApp();
      }
    }, 1000);
  }

  cancelRestartCountdown(): void {
    this.clearRestartCountdownTimer();
    this.sendToRenderer('update:restart-countdown', { seconds: -1, cancelled: true });
  }

  private clearRestartCountdownTimer(): void {
    if (this._restartCountdownTimer) {
      clearInterval(this._restartCountdownTimer);
      this._restartCountdownTimer = null;
    }
  }

  /**
   * 重启当前应用。manualInstall 完成后新 .app 已在原路径，但 process.execPath 仍指向 .old 备份。
   */
  restartApp(): void {
    logger.info('[Updater] restartApp called');
    setQuitting();
    this.clearRestartCountdownTimer();
    const execPath = this._relaunchExecPath ?? process.execPath;
    logger.info(`[Updater] restartApp: relaunch execPath=${execPath}`);
    const targetVersion = (this.status.info as UpdateInfo | undefined)?.version;
    // 留一点时间让 IPC / 日志 flush；写入 pending marker 供重启后检测更新完成并强制重登
    void (async () => {
      if (targetVersion && app.isPackaged) {
        await writePendingInstallReport({
          targetVersion,
          feedSlug: this.lastFeedSlug,
        });
      }
      setTimeout(() => {
        app.relaunch({ execPath });
        app.quit();
      }, 100);
    })();
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
        // 走 manualInstall（绕开 Squirrel.Mac 签名校验），失败时进入 error 状态
        void this.manualInstall().catch((err) => {
          logger.error('[Updater] auto-install (manualInstall) failed:', err);
        });
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

  // 'update:install' 默认走 manualInstall（绕过 Squirrel.Mac 的签名校验），
  // 安装完成后切到 'installed' 状态并启动 5 秒重启倒计时。
  ipcMain.handle('update:install', async () => {
    try {
      await updater.manualInstall();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 'update:installViaSquirrel' 保留原 Squirrel.Mac 路径作为备选，
  // 在你们走 Apple Developer ID 签名后可以一键切回。
  ipcMain.handle('update:installViaSquirrel', () => {
    updater.quitAndInstall();
    return { success: true };
  });

  ipcMain.handle('update:restart', () => {
    updater.restartApp();
    return { success: true };
  });

  ipcMain.handle('update:cancelRestartCountdown', () => {
    updater.cancelRestartCountdown();
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

  // 清理上一次 manualInstall 遗留的旧版本 .app 备份（延迟 60s，等新版本确认稳定）
  void updater.cleanupPendingBackup();
}

export const appUpdater = new AppUpdater();
