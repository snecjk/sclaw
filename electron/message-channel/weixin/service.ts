/**
 * WeixinChannelService — Host: fork worker, IPC, lifecycle, single-Bot API.
 *
 * Startup (段 A): fail → disposeChild → immediate retry, max 2 attempts (no backoff).
 * Post-ready crash (段 B): if still bound → exponential backoff 1s/4s/16s… max 5 attempts.
 */

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type { GatewayManager } from '../../gateway/manager';
import { logger } from '../../utils/logger';
import type { WeixinWireCommand, WeixinWireEvent } from '../../../shared/weixin-runtime-protocol';
import {
  ensureWeixinCredentialsMigrated,
  getBoundWeixinAccountId,
  getWeixinBinding,
  upsertWeixinBinding,
} from './binding';
import { handleWeixinWireEvent } from './bridge-inbound';
import { WEIXIN_PEER_ERROR_TEXT } from './peer-copy';
import { buildWeixinUtilityForkOptions } from './runtime/fork-options';
import { resolvePrimaryAccount } from './runtime/transport/account-store';
import { resolveWeixinStateDir } from './runtime/transport/state-dir';

const READY_TIMEOUT_MS = 15_000;
const INITIAL_START_ATTEMPTS = 2;
const POST_READY_MAX_RESTARTS = 5;
/** Backoff delays for post-ready crash recovery: 1s, 4s, 16s, 64s, 256s */
const POST_READY_BACKOFF_MS = [1_000, 4_000, 16_000, 64_000, 256_000] as const;

type WeixinServiceEvents = {
  event: [WeixinWireEvent];
  exit: [{ code: number }];
};

export class WeixinChannelService extends EventEmitter<WeixinServiceEvents> {
  private child: UtilityProcess | null = null;
  private state: 'stopped' | 'starting' | 'ready' | 'failed' = 'stopped';
  private startPromise: Promise<void> | null = null;
  private gatewayManager: GatewayManager | null = null;
  private monitorStarted = false;
  /** Intentional shutdown — skip post-ready auto-restart. */
  private shuttingDown = false;
  private postReadyRestartCount = 0;
  private postReadyRestartTimer: ReturnType<typeof setTimeout> | null = null;

  setGatewayManager(gm: GatewayManager | null): void {
    this.gatewayManager = gm;
  }

  isReady(): boolean {
    return this.state === 'ready' && this.child != null;
  }

  isMonitorRunning(): boolean {
    return this.isReady() && this.monitorStarted;
  }

  getBoundAccountId(): string | null {
    return getBoundWeixinAccountId();
  }

  sendCommand(command: WeixinWireCommand): void {
    if (!this.child || this.state !== 'ready') {
      logger.warn('[weixin] drop command; worker not ready', { type: command.type });
      return;
    }
    try {
      this.child.postMessage(command);
    } catch (error) {
      logger.warn('[weixin] postMessage failed', { type: command.type, error: String(error) });
    }
  }

  async ensureReady(): Promise<void> {
    if (this.state === 'ready' && this.child) return;
    if (this.startPromise) return this.startPromise;
    this.shuttingDown = false;
    this.startPromise = this.startChildWithInitialRetry();
    try {
      await this.startPromise;
      // Per-cluster budget: a successful ready handshake resets the post-ready restart count.
      this.postReadyRestartCount = 0;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Start worker and start monitor when a bot is bound.
   * Legacy credential migration is a permanent no-op.
   */
  async start(gatewayManager?: GatewayManager | null): Promise<void> {
    if (gatewayManager) this.gatewayManager = gatewayManager;
    ensureWeixinCredentialsMigrated();
    await this.ensureReady();
    const primary = resolvePrimaryAccount();
    if (!primary?.data.token) {
      logger.info('[weixin] no bound credentials; worker idle until login');
      return;
    }
    this.sendCommand({
      type: 'account.upsert',
      accountId: primary.accountId,
      token: primary.data.token,
      baseUrl: primary.data.baseUrl,
      userId: primary.data.userId,
    });
    this.sendCommand({ type: 'runtime.start' });
    this.monitorStarted = true;
    logger.info('[weixin] monitor requested', {
      accountId: primary.accountId,
      stateDir: resolveWeixinStateDir(),
    });
  }

  async applyLoginSuccess(input: {
    accountId: string;
    token: string;
    baseUrl?: string;
    userId?: string;
    agentId?: string;
  }): Promise<void> {
    const nextId = input.accountId.trim();
    const previousId = getBoundWeixinAccountId();
    // Single-Bot: re-scan replaces the local slot (WeChat often issues a new accountId).
    if (previousId && previousId !== nextId) {
      logger.info('[weixin] replacing single-Bot binding', { previousId, nextId });
      this.sendCommand({ type: 'account.remove', accountId: previousId });
    }
    await upsertWeixinBinding(input);
    await this.ensureReady();
    this.sendCommand({
      type: 'account.upsert',
      accountId: nextId,
      token: input.token,
      baseUrl: input.baseUrl,
      userId: input.userId,
    });
    this.sendCommand({ type: 'runtime.start' });
    this.monitorStarted = true;
  }

  async stopMonitor(): Promise<void> {
    this.sendCommand({ type: 'runtime.stop' });
    this.monitorStarted = false;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.clearPostReadyRestartTimer();
    try {
      this.sendCommand({ type: 'runtime.stop' });
    } catch {
      // ignore
    }
    this.disposeChild();
  }

  /** Fixed peer-facing error copy — never forward String(error) to the chat. */
  static peerErrorText(): string {
    return WEIXIN_PEER_ERROR_TEXT;
  }

  /**
   * Kill child if any, clear handle, set state=stopped.
   * Used on timeout / failed / fork error / intentional shutdown.
   */
  disposeChild(): void {
    try {
      this.child?.kill();
    } catch {
      // best effort
    }
    this.child = null;
    this.state = 'stopped';
    this.monitorStarted = false;
  }

  private clearPostReadyRestartTimer(): void {
    if (this.postReadyRestartTimer) {
      clearTimeout(this.postReadyRestartTimer);
      this.postReadyRestartTimer = null;
    }
  }

  /** 段 A: max 2 immediate retries, no backoff (inspired by Pi, not a copy). */
  private async startChildWithInitialRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= INITIAL_START_ATTEMPTS; attempt += 1) {
      try {
        await this.startChild();
        return;
      } catch (error) {
        lastError = error;
        logger.warn('[weixin] worker start failed', { attempt, error: String(error) });
        this.disposeChild();
      }
    }
    this.state = 'failed';
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private schedulePostReadyRestart(): void {
    if (this.shuttingDown) return;
    if (this.postReadyRestartCount >= POST_READY_MAX_RESTARTS) {
      logger.warn('[weixin] post-ready restart limit reached; leaving disconnected', {
        attempts: this.postReadyRestartCount,
      });
      this.state = 'failed';
      return;
    }
    const delay = POST_READY_BACKOFF_MS[
      Math.min(this.postReadyRestartCount, POST_READY_BACKOFF_MS.length - 1)
    ];
    this.postReadyRestartCount += 1;
    logger.info('[weixin] scheduling post-ready restart', {
      attempt: this.postReadyRestartCount,
      delayMs: delay,
    });
    this.clearPostReadyRestartTimer();
    this.postReadyRestartTimer = setTimeout(() => {
      this.postReadyRestartTimer = null;
      void this.tryPostReadyRestart();
    }, delay);
  }

  private async tryPostReadyRestart(): Promise<void> {
    if (this.shuttingDown) return;
    try {
      const binding = await getWeixinBinding();
      if (!binding) {
        logger.info('[weixin] skip post-ready restart: unbound');
        this.state = 'stopped';
        return;
      }
      await this.start(this.gatewayManager);
    } catch (error) {
      logger.warn('[weixin] post-ready restart failed', error);
      this.schedulePostReadyRestart();
    }
  }

  private workerEntryPath(): string {
    const candidates = [
      join(__dirname, '..', 'weixin-runtime', 'worker-entry.js'),
      join(__dirname, 'runtime', 'worker-entry.js'),
      join(app.getAppPath(), 'dist-electron', 'weixin-runtime', 'worker-entry.js'),
    ];
    // Dev: allow tsx-unbundled path via STO_WEIXIN_WORKER_ENTRY
    const fromEnv = process.env.STO_WEIXIN_WORKER_ENTRY?.trim();
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    return candidates.find(existsSync) ?? candidates[0];
  }

  private startChild(): Promise<void> {
    this.state = 'starting';
    const entry = this.workerEntryPath();
    logger.info('[weixin] starting worker', { entry, stateDir: resolveWeixinStateDir() });
    return new Promise<void>((resolve, reject) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(
          entry,
          [],
          buildWeixinUtilityForkOptions({
            cwd: app.getPath('userData'),
            env: {
              ...process.env,
              STO_WEIXIN_WORKER: '1',
              STOCLAW_WEIXIN_STATE_DIR: resolveWeixinStateDir(),
            },
          }),
        );
      } catch (error) {
        this.disposeChild();
        this.state = 'failed';
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.child = child;
      let settled = false;
      let becameReady = false;
      const readyTimer = setTimeout(
        () => finish(new Error(`Weixin worker ready timed out after ${READY_TIMEOUT_MS}ms`)),
        READY_TIMEOUT_MS,
      );
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        if (error) {
          this.disposeChild();
          reject(error);
        } else {
          resolve();
        }
      };

      child.on('message', (message: WeixinWireEvent) => {
        if (message?.type === 'runtime.ready') {
          this.state = 'ready';
          becameReady = true;
          logger.info('[weixin] worker ready');
          finish();
          return;
        }
        if (message?.type === 'runtime.failed') {
          finish(new Error(message.error?.message || 'Weixin worker initialization failed'));
          return;
        }
        this.emit('event', message);
        handleWeixinWireEvent(this, message, this.gatewayManager);
      });
      child.on('error', (error) => finish(new Error(String(error))));
      child.on('exit', (code) => {
        this.child = null;
        this.monitorStarted = false;
        this.emit('exit', { code });
        if (!settled) {
          finish(new Error(`Weixin worker exited before ready with code ${code}`));
          return;
        }
        // 段 B: crashed after ready
        this.state = 'failed';
        if (becameReady && !this.shuttingDown) {
          this.schedulePostReadyRestart();
        }
      });
      child.stdout?.on('data', (data) => {
        const output = String(data).trim();
        if (output) logger.info(`[weixin-worker] ${output}`);
      });
      child.stderr?.on('data', (data) => {
        const output = String(data).trim();
        if (output) logger.warn(`[weixin-worker] ${output}`);
      });
    });
  }
}

let singleton: WeixinChannelService | null = null;

export function getWeixinChannelService(): WeixinChannelService {
  singleton ??= new WeixinChannelService();
  return singleton;
}

/** Test helper — reset singleton between unit tests. */
export function __resetWeixinChannelServiceForTests(): void {
  singleton = null;
}
