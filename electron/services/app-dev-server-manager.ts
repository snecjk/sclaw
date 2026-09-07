/**
 * Dev server lifecycle manager for user apps (capability: service-dev-server).
 *
 * Owns spawn / free-port allocation / HTTP readiness probe / log capture /
 * crash backoff restart / process-tree cleanup for every running user-app
 * dev server. All processes are terminated on app quit so no orphans remain.
 */

import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { existsSync } from 'fs';
import { join } from 'path';
import { isDevServerRepairWorthyLine } from '../../shared/app-dev-preview-noise';
import { getManagedNodePaths, getNodeSpawnEnv } from '../utils/node-runtime';
import { logger } from '../utils/logger';
import { getPort } from '../utils/config';
import {
  buildSsoAuthLocalServerEnvironment,
  createSsoAuthLocalSession,
  destroyAllSsoAuthLocalSessions,
  destroySsoAuthLocalSession,
} from './sso-auth-local-session';
import {
  KeyedSingleFlight,
  OperationCanceledError,
  type KeyedOperationLease,
} from './keyed-single-flight';
import { probeDevServerReady } from './dev-server-readiness';

/** Prefer app-root package.json (A2UI single package); fall back to legacy frontend/. */
function resolveDevServerCwd(appPath: string): string {
  if (existsSync(join(appPath, 'package.json'))) return appPath;
  const frontendDir = join(appPath, 'frontend');
  if (existsSync(join(frontendDir, 'package.json'))) return frontendDir;
  throw new Error('未找到 package.json（应用根或 frontend/），无法启动预览');
}

const LOG_BUFFER_LINES = 500;
const MAX_CRASH_RESTARTS = 3;
const CRASH_BACKOFF_BASE_MS = 1_000;

export interface DevServerEntry {
  workspaceId: string;
  appPath: string;
  port: number;
  previewUrl: string;
  child: ChildProcess;
  logs: string[];
  /** Compile/runtime error lines observed since last clear (for agent repair loop). */
  recentErrors: string[];
  crashCount: number;
  /** When true, exit handler must not auto-restart. */
  stopping: boolean;
}

const registry = new Map<string, DevServerEntry>();
const entrySsoSessionSecrets = new WeakMap<DevServerEntry, string>();
const startSingleFlight = new KeyedSingleFlight();
const crashRestartTimers = new Map<string, ReturnType<typeof setTimeout>>();
let cleanupRegistered = false;
let quitting = false;

function destroyEntrySsoSession(entry: DevServerEntry): void {
  destroySsoAuthLocalSession(entry.workspaceId, entrySsoSessionSecrets.get(entry));
}

function cancelCrashRestart(workspaceId: string): void {
  const timer = crashRestartTimers.get(workspaceId);
  if (timer) clearTimeout(timer);
  crashRestartTimers.delete(workspaceId);
}

function ensureCleanupHook(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  app.on('before-quit', () => {
    quitting = true;
    startSingleFlight.cancelAll();
    for (const timer of crashRestartTimers.values()) clearTimeout(timer);
    crashRestartTimers.clear();
    for (const entry of registry.values()) {
      entry.stopping = true;
      killProcessTree(entry.child);
      destroyEntrySsoSession(entry);
    }
    registry.clear();
    destroyAllSsoAuthLocalSessions();
  });
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (err) {
    logger.warn('[app-dev] failed to kill dev server process tree:', err);
  }
}

function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('failed to allocate port'))));
    });
  });
}

export async function allocateDevServerPort(): Promise<number> {
  return allocateFreePort();
}

function pushLog(entry: DevServerEntry, chunk: string): void {
  for (const line of chunk.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    entry.logs.push(trimmed);
    if (entry.logs.length > LOG_BUFFER_LINES) entry.logs.shift();
    if (isDevServerRepairWorthyLine(trimmed)) {
      entry.recentErrors.push(trimmed);
      if (entry.recentErrors.length > 50) entry.recentErrors.shift();
    }
  }
}

function scheduleCrashRestart(prev: DevServerEntry): void {
  if (quitting) return;
  const nextCount = prev.crashCount + 1;
  if (nextCount > MAX_CRASH_RESTARTS) {
    logger.error(
      `[app-dev] dev server for ${prev.workspaceId} crashed ${nextCount} times; escalating to agent`,
    );
    // Leave recentErrors + logs available for the workbench agent repair loop.
    return;
  }
  const delay = CRASH_BACKOFF_BASE_MS * 2 ** (nextCount - 1);
  logger.warn(
    `[app-dev] restarting ${prev.workspaceId} after crash #${nextCount} in ${delay}ms`,
  );
  cancelCrashRestart(prev.workspaceId);
  const timer = setTimeout(() => {
    if (crashRestartTimers.get(prev.workspaceId) !== timer || quitting) return;
    crashRestartTimers.delete(prev.workspaceId);
    void startDevServer(prev.workspaceId, prev.appPath, nextCount).catch((err) => {
      logger.error(`[app-dev] crash restart failed for ${prev.workspaceId}:`, err);
    });
  }, delay);
  crashRestartTimers.set(prev.workspaceId, timer);
}

export function getDevServer(workspaceId: string): DevServerEntry | null {
  return registry.get(workspaceId) ?? null;
}

export function getDevServerLogs(workspaceId: string): string[] {
  return [...(registry.get(workspaceId)?.logs ?? [])];
}

/** Read and clear collected error lines (consumed by the agent repair loop). */
export function drainDevServerErrors(workspaceId: string): string[] {
  const entry = registry.get(workspaceId);
  if (!entry) return [];
  const errors = [...entry.recentErrors];
  entry.recentErrors.length = 0;
  return errors;
}

async function startDevServerImpl(
  workspaceId: string,
  appPath: string,
  crashCount = 0,
  lease: KeyedOperationLease,
): Promise<DevServerEntry> {
  ensureCleanupHook();
  lease.throwIfCanceled();

  const existing = registry.get(workspaceId);
  if (existing && existing.child.exitCode === null && !existing.stopping) {
    return existing;
  }
  if (existing) {
    existing.stopping = true;
    killProcessTree(existing.child);
    registry.delete(workspaceId);
    destroyEntrySsoSession(existing);
  }

  const { npmBin } = getManagedNodePaths();
  if (!npmBin || !existsSync(npmBin)) {
    throw new Error(`未找到可用的 npm 可执行文件: ${npmBin || '(empty)'}`);
  }
  const port = await allocateFreePort();
  lease.throwIfCanceled();
  const cwd = resolveDevServerCwd(appPath);
  const previewUrl = `http://127.0.0.1:${port}/`;
  const ssoAuthSession = await createSsoAuthLocalSession({
    workspaceId,
    appPath,
    isCurrent: lease.isCurrent,
  }).catch((error) => {
    if (!lease.isCurrent()) throw new OperationCanceledError();
    throw error;
  });
  try {
    lease.throwIfCanceled();
  } catch (error) {
    destroySsoAuthLocalSession(workspaceId, ssoAuthSession.secret);
    throw error;
  }
  const childEnvironment = {
    ...(getNodeSpawnEnv() as NodeJS.ProcessEnv),
    ...buildSsoAuthLocalServerEnvironment(
      ssoAuthSession,
      getPort('CLAWX_HOST_API'),
    ),
  };

  logger.info(`[app-dev] starting dev server for ${workspaceId} on port ${port} cwd=${cwd}`);
  let child: ChildProcess;
  try {
    child = spawn(
      npmBin,
      ['run', 'dev', '--', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
      {
        cwd,
        env: childEnvironment,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    destroySsoAuthLocalSession(workspaceId, ssoAuthSession.secret);
    throw error;
  }

  const entry: DevServerEntry = {
    workspaceId,
    appPath,
    port,
    previewUrl,
    child,
    logs: existing?.logs ?? [],
    recentErrors: existing?.recentErrors ?? [],
    crashCount,
    stopping: false,
  };
  entrySsoSessionSecrets.set(entry, ssoAuthSession.secret);
  registry.set(workspaceId, entry);

  child.stdout?.on('data', (d) => pushLog(entry, String(d)));
  child.stderr?.on('data', (d) => pushLog(entry, String(d)));
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', reject);
  });
  child.on('error', (err) => {
    logger.error(`[app-dev] dev server spawn error for ${workspaceId}:`, err);
    const message = `spawn error: ${err instanceof Error ? err.message : String(err)}`;
    pushLog(entry, message);
    entry.recentErrors.push(message);
    if (registry.get(workspaceId) === entry) {
      registry.delete(workspaceId);
      destroyEntrySsoSession(entry);
      if (!entry.stopping) scheduleCrashRestart(entry);
    }
  });
  child.on('exit', (code) => {
    logger.info(`[app-dev] dev server for ${workspaceId} exited with code ${code}`);
    if (registry.get(workspaceId) !== entry) return;
    registry.delete(workspaceId);
    destroyEntrySsoSession(entry);
    if (!entry.stopping && code !== 0) {
      scheduleCrashRestart(entry);
    }
  });

  try {
    await Promise.race([probeDevServerReady(previewUrl, lease.signal), spawnFailure]);
    lease.throwIfCanceled();
  } catch (err) {
    entry.stopping = true;
    killProcessTree(child);
    if (registry.get(workspaceId) === entry) {
      registry.delete(workspaceId);
      destroyEntrySsoSession(entry);
    }
    const tail = entry.logs.slice(-20).join('\n');
    if (err instanceof OperationCanceledError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${reason}\n${tail}`, { cause: err });
  }

  return entry;
}

export function startDevServer(
  workspaceId: string,
  appPath: string,
  crashCount = 0,
): Promise<DevServerEntry> {
  if (quitting) return Promise.reject(new Error('应用正在退出，无法启动预览服务'));
  cancelCrashRestart(workspaceId);
  return startSingleFlight.run(workspaceId, (lease) => (
    startDevServerImpl(workspaceId, appPath, crashCount, lease)
  ));
}

export function stopDevServer(workspaceId: string): boolean {
  startSingleFlight.cancel(workspaceId);
  cancelCrashRestart(workspaceId);
  const entry = registry.get(workspaceId);
  if (!entry) {
    destroySsoAuthLocalSession(workspaceId);
    return false;
  }
  entry.stopping = true;
  killProcessTree(entry.child);
  registry.delete(workspaceId);
  destroyEntrySsoSession(entry);
  return true;
}
