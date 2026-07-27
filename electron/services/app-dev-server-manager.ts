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
import { get as httpGet } from 'http';
import { join } from 'path';
import { getManagedNodePaths, getNodeSpawnEnv } from '../utils/node-runtime';
import { logger } from '../utils/logger';

const LOG_BUFFER_LINES = 500;
const READY_PROBE_TIMEOUT_MS = 60_000;
const READY_PROBE_INTERVAL_MS = 400;
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
let cleanupRegistered = false;

function ensureCleanupHook(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  app.on('before-quit', () => {
    for (const entry of registry.values()) {
      entry.stopping = true;
      killProcessTree(entry.child);
    }
    registry.clear();
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

function probeReady(url: string): Promise<void> {
  const deadline = Date.now() + READY_PROBE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = httpGet(url, (res) => {
        res.on('data', () => undefined);
        if ((res.statusCode ?? 0) < 500) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error('dev server did not become ready in time'));
        return;
      }
      setTimeout(attempt, READY_PROBE_INTERVAL_MS);
    };
    attempt();
  });
}

function pushLog(entry: DevServerEntry, chunk: string): void {
  for (const line of chunk.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    entry.logs.push(trimmed);
    if (entry.logs.length > LOG_BUFFER_LINES) entry.logs.shift();
    if (/error|failed to compile|internal server error/i.test(trimmed)) {
      entry.recentErrors.push(trimmed);
      if (entry.recentErrors.length > 50) entry.recentErrors.shift();
    }
  }
}

function scheduleCrashRestart(prev: DevServerEntry): void {
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
  setTimeout(() => {
    void startDevServer(prev.workspaceId, prev.appPath, nextCount).catch((err) => {
      logger.error(`[app-dev] crash restart failed for ${prev.workspaceId}:`, err);
    });
  }, delay);
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

export async function startDevServer(
  workspaceId: string,
  appPath: string,
  crashCount = 0,
): Promise<DevServerEntry> {
  ensureCleanupHook();

  const existing = registry.get(workspaceId);
  if (existing && existing.child.exitCode === null && !existing.stopping) {
    return existing;
  }
  if (existing) {
    existing.stopping = true;
    killProcessTree(existing.child);
    registry.delete(workspaceId);
  }

  const { npmBin } = getManagedNodePaths();
  const port = await allocateFreePort();
  const frontendDir = join(appPath, 'frontend');
  const previewUrl = `http://127.0.0.1:${port}/`;

  logger.info(`[app-dev] starting dev server for ${workspaceId} on port ${port}`);
  const child = spawn(
    npmBin,
    ['run', 'dev', '--', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: frontendDir,
      env: getNodeSpawnEnv() as NodeJS.ProcessEnv,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

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
  registry.set(workspaceId, entry);

  child.stdout?.on('data', (d) => pushLog(entry, String(d)));
  child.stderr?.on('data', (d) => pushLog(entry, String(d)));
  child.on('exit', (code) => {
    logger.info(`[app-dev] dev server for ${workspaceId} exited with code ${code}`);
    if (registry.get(workspaceId) !== entry) return;
    registry.delete(workspaceId);
    if (!entry.stopping && code !== 0) {
      scheduleCrashRestart(entry);
    }
  });

  try {
    await probeReady(previewUrl);
  } catch (err) {
    entry.stopping = true;
    killProcessTree(child);
    registry.delete(workspaceId);
    const tail = entry.logs.slice(-20).join('\n');
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${reason}\n${tail}`, { cause: err });
  }

  return entry;
}

export function stopDevServer(workspaceId: string): boolean {
  const entry = registry.get(workspaceId);
  if (!entry) return false;
  entry.stopping = true;
  killProcessTree(entry.child);
  registry.delete(workspaceId);
  return true;
}
