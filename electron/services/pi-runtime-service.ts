import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type { NormalizedEngineEvent } from '../gateway/normalized-engine-event';
import type {
  PiWorkerMessage,
  PiWorkerRequest,
  PiWorkerCommand,
  SerializedPiError,
} from '../../shared/pi-runtime-protocol';
import { logger } from '../utils/logger';
import { syncPiDefaultContext } from './pi-context-sync';

const READY_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PROMPT_ACCEPT_TIMEOUT_MS = 30_000;

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

type PiRuntimeEvents = {
  event: [NormalizedEngineEvent];
  exit: [{ code: number; sessions: string[] }];
};

function errorFromSerialized(error: SerializedPiError | undefined, fallback: string): Error {
  const result = new Error(error?.message || fallback);
  if (error?.stack) result.stack = error.stack;
  if (error?.code) (result as Error & { code?: string }).code = error.code;
  return result;
}

export class PiRuntimeService extends EventEmitter<PiRuntimeEvents> {
  private child: UtilityProcess | null = null;
  private state: 'stopped' | 'starting' | 'ready' | 'failed' = 'stopped';
  private startPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private activeSessions = new Set<string>();
  private startedOnce = false;

  isEnabled(): boolean {
    return process.env.STO_PI_ENGINE_ENABLED !== 'false';
  }

  async warmup(): Promise<void> {
    if (!this.isEnabled()) return;
    await this.ensureReady();
  }

  async request<T>(
    command: PiWorkerCommand,
    options: { sessionKey?: string; payload?: Record<string, unknown>; timeoutMs?: number } = {},
  ): Promise<T> {
    if (!this.isEnabled()) throw new Error('PI_ENGINE_DISABLED: Pi engine is disabled');
    await this.ensureReady();
    const requestId = randomUUID();
    const request: PiWorkerRequest = {
      requestId,
      command,
      sessionKey: options.sessionKey,
      payload: options.payload,
    };
    const timeoutMs = options.timeoutMs ?? (command === 'session.prompt' ? PROMPT_ACCEPT_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Pi worker request timed out: ${command}`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.child!.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  markSessionActive(sessionKey: string): void {
    this.activeSessions.add(sessionKey);
  }

  markSessionTerminal(sessionKey: string): void {
    this.activeSessions.delete(sessionKey);
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    await this.request('runtime.shutdown', { timeoutMs: 3_000 }).catch(() => {});
    try { this.child?.kill(); } catch { /* best effort */ }
    this.child = null;
    this.state = 'stopped';
  }

  private async ensureReady(): Promise<void> {
    if (this.state === 'ready' && this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startWithRetry();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startWithRetry(): Promise<void> {
    try {
      await syncPiDefaultContext();
    } catch (error) {
      logger.warn('[pi-runtime] default context sync failed; starting with built-in runtime context', error);
    }
    const attempts = this.startedOnce ? 1 : 2;
    this.startedOnce = true;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.startChild();
        return;
      } catch (error) {
        lastError = error;
        logger.warn('[pi-runtime] worker start failed', { attempt, error: String(error) });
        this.disposeChild();
      }
    }
    this.state = 'failed';
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private workerEntryPath(): string {
    const candidates = [
      join(__dirname, '..', 'pi-runtime', 'worker-entry.js'),
      join(__dirname, '..', 'pi-runtime', 'worker-entry.cjs'),
      join(app.getAppPath(), 'dist-electron', 'pi-runtime', 'worker-entry.js'),
    ];
    return candidates.find(existsSync) ?? candidates[0];
  }

  private startChild(): Promise<void> {
    this.state = 'starting';
    const entry = this.workerEntryPath();
    logger.info('[pi-runtime] starting worker', { entry });
    return new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(entry, [], {
        cwd: app.getPath('userData'),
        env: { ...process.env, STO_PI_WORKER: '1' },
        stdio: 'pipe',
        serviceName: 'SClaw Pi Runtime',
      });
      this.child = child;
      let settled = false;
      const readyTimer = setTimeout(() => finish(new Error(`Pi worker ready timed out after ${READY_TIMEOUT_MS}ms`)), READY_TIMEOUT_MS);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        if (error) reject(error);
        else resolve();
      };

      child.on('message', (message: PiWorkerMessage) => {
        if (message.type === 'runtime.ready') {
          this.state = 'ready';
          logger.info('[pi-runtime] worker ready');
          finish();
          return;
        }
        if (message.type === 'runtime.failed') {
          finish(errorFromSerialized(message.error, 'Pi worker initialization failed'));
          return;
        }
        this.handleMessage(message);
      });
      child.on('error', (error) => finish(new Error(String(error))));
      child.on('exit', (code) => {
        const sessions = [...this.activeSessions];
        this.activeSessions.clear();
        this.rejectAll(new Error(`Pi worker exited with code ${code}`));
        this.child = null;
        this.state = 'failed';
        this.emit('exit', { code, sessions });
        if (!settled) finish(new Error(`Pi worker exited before ready with code ${code}`));
      });
      child.stdout?.on('data', (data) => {
        const output = String(data).trim();
        if (!output) return;
        if (output.includes('[pi-core]')) logger.info(`[pi-worker] ${output}`);
        else logger.debug(`[pi-worker] ${output}`);
      });
      child.stderr?.on('data', (data) => logger.warn(`[pi-worker] ${String(data).trim()}`));
    });
  }

  private handleMessage(message: PiWorkerMessage): void {
    if (message.type === 'engine.event') {
      if (['turn.completed', 'turn.failed', 'turn.aborted', 'turn.interrupted'].includes(message.event.type)) {
        this.markSessionTerminal(message.sessionKey);
      }
      this.emit('event', message.event);
      return;
    }
    if (message.type !== 'response') return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.success) pending.resolve(message.result);
    else pending.reject(errorFromSerialized(message.error, 'Pi worker request failed'));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private disposeChild(): void {
    try { this.child?.kill(); } catch { /* best effort */ }
    this.child = null;
    this.state = 'stopped';
  }
}

let singleton: PiRuntimeService | null = null;

export function getPiRuntimeService(): PiRuntimeService {
  singleton ??= new PiRuntimeService();
  return singleton;
}
