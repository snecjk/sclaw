/**
 * Fullstack app runtime: backend (Hono) + frontend (Vite via app-dev-server-manager).
 */

import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { isBackendRepairWorthyLine } from '../../shared/app-dev-backend-noise';
import { getManagedNodePaths, getNodeSpawnEnv } from '../utils/node-runtime';
import { getPort } from '../utils/config';
import { logger } from '../utils/logger';
import { getAppDevSecretsEnv } from './app-dev-secrets';
import {
  allocateDevServerPort,
  getDevServer,
  getDevServerLogs,
  startDevServer,
  stopDevServer,
} from './app-dev-server-manager';

const LOG_BUFFER_LINES = 500;
const MAX_CRASH_RESTARTS = 3;
const CRASH_BACKOFF_BASE_MS = 1_000;
const PROXY_PATH = 'contracts/dev-proxy.v1.json';
const MANAGED_BY = 'app-runtime';

export type RuntimeDbStatus = 'unknown' | 'ready' | 'error';

export interface AppRuntimeStatus {
  workspaceId: string;
  appPath: string;
  frontendRunning: boolean;
  backendRunning: boolean;
  previewUrl?: string;
  backendUrl?: string;
  backendPort?: number;
  dbStatus: RuntimeDbStatus;
  phase: 'stopped' | 'starting' | 'ready' | 'error';
  crashCount?: number;
  recentErrorCount?: number;
  /** True when crash restarts exhausted — workbench should auto-heal via agent. */
  escalateNeeded?: boolean;
  error?: string;
}

interface BackendEntry {
  workspaceId: string;
  appPath: string;
  port: number;
  url: string;
  child: ChildProcess;
  logs: string[];
  recentErrors: string[];
  crashCount: number;
  stopping: boolean;
  dbStatus: RuntimeDbStatus;
}

const backends = new Map<string, BackendEntry>();
const crashRestartTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Fingerprint → attempt count for auto-heal melt. */
const healAttempts = new Map<string, number>();
const escalateFlags = new Map<string, { fingerprint: string; lines: string[] }>();
let cleanupRegistered = false;
let quitting = false;

function ensureCleanupHook(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  app.on('before-quit', () => {
    quitting = true;
    for (const timer of crashRestartTimers.values()) clearTimeout(timer);
    crashRestartTimers.clear();
    for (const entry of backends.values()) {
      entry.stopping = true;
      killProcessTree(entry.child);
    }
    backends.clear();
  });
}

function pushLog(entry: BackendEntry, chunk: string): void {
  for (const line of chunk.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    entry.logs.push(`[backend] ${trimmed}`);
    if (entry.logs.length > LOG_BUFFER_LINES) entry.logs.shift();
    if (isBackendRepairWorthyLine(trimmed)) {
      entry.recentErrors.push(trimmed);
      if (entry.recentErrors.length > 50) entry.recentErrors.shift();
    }
  }
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
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

function cancelCrashRestart(workspaceId: string): void {
  const timer = crashRestartTimers.get(workspaceId);
  if (timer) clearTimeout(timer);
  crashRestartTimers.delete(workspaceId);
}

function scheduleCrashRestart(prev: BackendEntry): void {
  if (quitting) return;
  const nextCount = prev.crashCount + 1;
  if (nextCount > MAX_CRASH_RESTARTS) {
    logger.error(
      `[app-runtime] backend for ${prev.workspaceId} crashed ${nextCount} times; escalate to agent`,
    );
    const lines = prev.recentErrors.slice(-20);
    const fingerprint = lines.slice(0, 3).join('|').slice(0, 200) || 'backend-crash';
    escalateFlags.set(prev.workspaceId, { fingerprint, lines });
    return;
  }
  const delay = CRASH_BACKOFF_BASE_MS * 2 ** (nextCount - 1);
  logger.warn(
    `[app-runtime] restarting backend ${prev.workspaceId} after crash #${nextCount} in ${delay}ms`,
  );
  cancelCrashRestart(prev.workspaceId);
  const timer = setTimeout(() => {
    if (crashRestartTimers.get(prev.workspaceId) !== timer || quitting) return;
    crashRestartTimers.delete(prev.workspaceId);
    void startBackend(prev.workspaceId, prev.appPath, nextCount).catch((err) => {
      logger.error(`[app-runtime] backend crash restart failed for ${prev.workspaceId}:`, err);
    });
  }, delay);
  crashRestartTimers.set(prev.workspaceId, timer);
}

async function updateAppBackendProxy(appPath: string, backendUrl: string): Promise<void> {
  const filePath = join(appPath, PROXY_PATH);
  let file: { version: string; proxies: Array<Record<string, unknown>> } = {
    version: 'v1',
    proxies: [],
  };
  if (existsSync(filePath)) {
    try {
      file = JSON.parse(await readFile(filePath, 'utf8')) as typeof file;
      if (!Array.isArray(file.proxies)) file.proxies = [];
    } catch {
      // keep empty
    }
  }
  const rest = file.proxies.filter((entry) => !(
    entry.managedBy === MANAGED_BY && entry.key === 'appBackend'
  ));
  rest.push({
    key: 'appBackend',
    target: backendUrl,
    changeOrigin: true,
    managedBy: MANAGED_BY,
  });
  await mkdir(join(appPath, 'contracts'), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ version: file.version || 'v1', proxies: rest }, null, 2)}\n`, 'utf8');
}

async function runMigrate(appPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  const { npmBin } = getManagedNodePaths();
  if (!npmBin) throw new Error('未找到可用的 npm');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmBin, ['run', 'db:migrate'], {
      cwd: appPath,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d) => { output += String(d); });
    child.stderr?.on('data', (d) => { output += String(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`db:migrate 失败 (code=${code})\n${output.slice(-2000)}`));
    });
  });
}

async function waitForBackendHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'timeout';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        const body = await res.json() as { ok?: boolean };
        if (body.ok) return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`后端健康检查失败: ${lastErr}`);
}

function stopBackend(workspaceId: string): void {
  cancelCrashRestart(workspaceId);
  const entry = backends.get(workspaceId);
  if (!entry) return;
  entry.stopping = true;
  killProcessTree(entry.child);
  backends.delete(workspaceId);
}

export async function startBackend(
  workspaceId: string,
  appPath: string,
  crashCount = 0,
): Promise<BackendEntry> {
  ensureCleanupHook();
  cancelCrashRestart(workspaceId);

  const existing = backends.get(workspaceId);
  if (existing && existing.child.exitCode === null && !existing.stopping) {
    return existing;
  }
  if (existing) stopBackend(workspaceId);

  const { npmBin } = getManagedNodePaths();
  if (!npmBin) throw new Error('未找到可用的 npm');

  const secrets = await getAppDevSecretsEnv(workspaceId);
  const port = await allocateDevServerPort();
  const url = `http://127.0.0.1:${port}`;
  const dataDir = join(appPath, '.data');
  await mkdir(dataDir, { recursive: true });

  const hostApiPort = getPort('CLAWX_HOST_API');
  const env: NodeJS.ProcessEnv = {
    ...(getNodeSpawnEnv() as NodeJS.ProcessEnv),
    ...secrets,
    PORT: String(port),
    DATABASE_URL: join(dataDir, 'app.db'),
    SESSION_SECRET: secrets.SESSION_SECRET || `dev-${workspaceId.slice(0, 8)}`,
    // P2 AI gateway placeholders — empty until ai-gateway-service lands
    SCLAW_AI_BASE_URL: `http://127.0.0.1:${hostApiPort}/api/app-dev/ai/v1`,
    SCLAW_SERVICE_AK: secrets.SCLAW_SERVICE_AK || '',
  };

  let dbStatus: RuntimeDbStatus = 'unknown';
  try {
    await runMigrate(appPath, env);
    dbStatus = 'ready';
  } catch (err) {
    dbStatus = 'error';
    throw err;
  }

  await updateAppBackendProxy(appPath, url);

  logger.info(`[app-runtime] starting backend ${workspaceId} on ${url}`);
  const child = spawn(npmBin, ['run', 'dev:server'], {
    cwd: appPath,
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry: BackendEntry = {
    workspaceId,
    appPath,
    port,
    url,
    child,
    logs: existing?.logs ?? [],
    recentErrors: existing?.recentErrors ?? [],
    crashCount,
    stopping: false,
    dbStatus,
  };
  backends.set(workspaceId, entry);
  child.stdout?.on('data', (d) => pushLog(entry, String(d)));
  child.stderr?.on('data', (d) => pushLog(entry, String(d)));
  child.on('exit', (code) => {
    if (backends.get(workspaceId) !== entry) return;
    backends.delete(workspaceId);
    if (!entry.stopping && code !== 0) {
      scheduleCrashRestart(entry);
    }
  });

  try {
    await waitForBackendHealth(url);
    // Successful start clears escalate until next exhaustion
    if (crashCount === 0) escalateFlags.delete(workspaceId);
  } catch (err) {
    entry.stopping = true;
    killProcessTree(child);
    backends.delete(workspaceId);
    const tail = entry.logs.slice(-30).join('\n');
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n${tail}`);
  }

  return entry;
}

export async function startRuntime(workspaceId: string, appPath: string): Promise<AppRuntimeStatus> {
  const backend = await startBackend(workspaceId, appPath);
  const frontend = await startDevServer(workspaceId, appPath);
  return getRuntimeStatus(workspaceId, appPath);
}

export function stopRuntime(workspaceId: string): void {
  stopBackend(workspaceId);
  stopDevServer(workspaceId);
  escalateFlags.delete(workspaceId);
}

export async function restartRuntime(workspaceId: string, appPath: string): Promise<AppRuntimeStatus> {
  stopRuntime(workspaceId);
  return startRuntime(workspaceId, appPath);
}

export async function restartBackendOnly(workspaceId: string, appPath: string): Promise<AppRuntimeStatus> {
  stopBackend(workspaceId);
  await startBackend(workspaceId, appPath);
  return getRuntimeStatus(workspaceId, appPath);
}

export function getRuntimeStatus(workspaceId: string, appPath?: string): AppRuntimeStatus {
  const backend = backends.get(workspaceId);
  const frontend = getDevServer(workspaceId);
  const backendRunning = Boolean(backend && backend.child.exitCode === null && !backend.stopping);
  const frontendRunning = Boolean(frontend && frontend.child.exitCode === null && !frontend.stopping);
  const escalate = escalateFlags.get(workspaceId);
  let phase: AppRuntimeStatus['phase'] = 'stopped';
  if (backendRunning && frontendRunning) phase = 'ready';
  else if (backendRunning || frontendRunning) phase = 'starting';
  else if (escalate) phase = 'error';
  return {
    workspaceId,
    appPath: appPath || backend?.appPath || frontend?.appPath || '',
    frontendRunning,
    backendRunning,
    previewUrl: frontend?.previewUrl,
    backendUrl: backend?.url,
    backendPort: backend?.port,
    dbStatus: backend?.dbStatus ?? 'unknown',
    phase,
    crashCount: backend?.crashCount ?? (escalate ? MAX_CRASH_RESTARTS + 1 : 0),
    recentErrorCount: backend?.recentErrors.length ?? escalate?.lines.length ?? 0,
    escalateNeeded: Boolean(escalate),
  };
}

export function getRuntimeLogs(workspaceId: string, source?: 'frontend' | 'backend' | 'all'): string[] {
  const want = source ?? 'all';
  const lines: string[] = [];
  if (want === 'all' || want === 'frontend') {
    lines.push(...getDevServerLogs(workspaceId).map((line) => `[frontend] ${line}`));
  }
  if (want === 'all' || want === 'backend') {
    const backend = backends.get(workspaceId);
    if (backend) lines.push(...backend.logs);
  }
  return lines.slice(-LOG_BUFFER_LINES);
}

export function drainBackendErrors(workspaceId: string): string[] {
  const entry = backends.get(workspaceId);
  if (!entry) {
    const escalate = escalateFlags.get(workspaceId);
    return escalate ? [...escalate.lines] : [];
  }
  const errors = [...entry.recentErrors];
  entry.recentErrors.length = 0;
  return errors;
}

/** Consume escalate flag once (for auto-heal UI). Returns null if none / melted. */
export function consumeBackendEscalate(workspaceId: string): {
  fingerprint: string;
  lines: string[];
  attempt: number;
  melted: boolean;
} | null {
  const escalate = escalateFlags.get(workspaceId);
  if (!escalate) return null;
  escalateFlags.delete(workspaceId);
  const attempt = (healAttempts.get(escalate.fingerprint) ?? 0) + 1;
  healAttempts.set(escalate.fingerprint, attempt);
  const melted = attempt > 3;
  return { ...escalate, attempt, melted };
}

export function buildBackendRepairPrompt(lines: string[]): string {
  return [
    '应用后端出了问题，正在自动修复（业务用户看不到终端）。请根据下面的错误修复代码，改完后我会自动重启并复检。',
    '约束：只改 server/routes、drizzle/schema 等允许区域；改 schema 后需 migrate；前端走 /proxy/appBackend。',
    '',
    ...lines.slice(-30),
  ].join('\n');
}

export async function migrateAppDatabase(workspaceId: string, appPath: string): Promise<void> {
  const secrets = await getAppDevSecretsEnv(workspaceId);
  const dataDir = join(appPath, '.data');
  await mkdir(dataDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...(getNodeSpawnEnv() as NodeJS.ProcessEnv),
    ...secrets,
    DATABASE_URL: join(dataDir, 'app.db'),
  };
  await runMigrate(appPath, env);
  const backend = backends.get(workspaceId);
  if (backend) backend.dbStatus = 'ready';
}

/** Run template smoke against a live backend URL; returns stdout or throws. */
export async function runAppSmoke(appPath: string, backendUrl: string): Promise<string> {
  const { npmBin } = getManagedNodePaths();
  if (!npmBin) throw new Error('未找到可用的 npm');
  const env: NodeJS.ProcessEnv = {
    ...(getNodeSpawnEnv() as NodeJS.ProcessEnv),
    SMOKE_BASE_URL: backendUrl.replace(/\/$/, ''),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(npmBin, ['run', 'smoke'], {
      cwd: appPath,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d) => { output += String(d); });
    child.stderr?.on('data', (d) => { output += String(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`smoke 失败 (code=${code})\n${output.slice(-3000)}`));
    });
  });
}
