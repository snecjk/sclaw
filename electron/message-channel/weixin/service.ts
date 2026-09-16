/**
 * WeixinChannelService — Host: fork worker, IPC, lifecycle, single-Bot API.
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
  hasWeixinBotBound,
  upsertWeixinBinding,
} from './binding';
import { handleWeixinWireEvent } from './bridge-inbound';
import { buildWeixinUtilityForkOptions } from './runtime/fork-options';
import { resolvePrimaryAccount } from './runtime/transport/account-store';
import { resolveWeixinStateDir } from './runtime/transport/state-dir';

const READY_TIMEOUT_MS = 15_000;

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

  setGatewayManager(gm: GatewayManager | null): void {
    this.gatewayManager = gm;
  }

  isReady(): boolean {
    return this.state === 'ready' && this.child != null;
  }

  isMonitorRunning(): boolean {
    return this.isReady() && this.monitorStarted;
  }

  hasBoundBot(): boolean {
    return hasWeixinBotBound();
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
    this.startPromise = this.startChild();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Start worker + migrate credentials + start monitor if a bot is bound.
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
    try {
      this.sendCommand({ type: 'runtime.stop' });
    } catch {
      // ignore
    }
    try {
      this.child?.kill();
    } catch {
      // ignore
    }
    this.child = null;
    this.state = 'stopped';
    this.monitorStarted = false;
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
        this.state = 'failed';
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.child = child;
      let settled = false;
      const readyTimer = setTimeout(
        () => finish(new Error(`Weixin worker ready timed out after ${READY_TIMEOUT_MS}ms`)),
        READY_TIMEOUT_MS,
      );
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        if (error) reject(error);
        else resolve();
      };

      child.on('message', (message: WeixinWireEvent) => {
        if (message?.type === 'runtime.ready') {
          this.state = 'ready';
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
        this.state = 'failed';
        this.monitorStarted = false;
        this.emit('exit', { code });
        if (!settled) finish(new Error(`Weixin worker exited before ready with code ${code}`));
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
