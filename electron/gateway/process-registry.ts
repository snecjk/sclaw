/**
 * Gateway process registry (pidfile).
 *
 * Records the pid/port of the Gateway process this app instance spawned, so
 * that the next app launch can detect and terminate an orphaned Gateway left
 * behind by a crash or force-kill.
 *
 * Why this matters: without it, a surviving orphan keeps port 18789 occupied,
 * the new launch silently auto-increments to another port and spawns a SECOND
 * Gateway. Both gateways then share the same OpenClaw state directory — the
 * orphan's heartbeat/cron runs keep holding session `.jsonl.lock` files, and
 * the new Gateway fails with "session file locked (timeout 10000ms): pid=...".
 */
import { app } from 'electron';
import path from 'path';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { logger } from '../utils/logger';
import {
  getListeningProcessIds,
  listGatewayChildProcessIds,
  terminateOrphanedProcessIds,
  terminateProcessIds,
  waitForPortFree,
} from './supervisor';

interface OwnedGatewayRecord {
  pid: number;
  port: number;
  startedAt: number;
}

function registryFilePath(): string {
  return path.join(app.getPath('userData'), 'gateway-process.json');
}

function readRecord(): OwnedGatewayRecord | null {
  try {
    const raw = readFileSync(registryFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<OwnedGatewayRecord>;
    if (typeof parsed.pid !== 'number' || parsed.pid <= 0 || typeof parsed.port !== 'number') {
      return null;
    }
    return { pid: parsed.pid, port: parsed.port, startedAt: parsed.startedAt ?? 0 };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function recordOwnedGatewayProcess(pid: number | undefined, port: number): void {
  if (typeof pid !== 'number' || pid <= 0) return;
  try {
    const filePath = registryFilePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    const record: OwnedGatewayRecord = { pid, port, startedAt: Date.now() };
    writeFileSync(filePath, JSON.stringify(record), 'utf-8');
    logger.debug(`Recorded owned Gateway process (pid=${pid}, port=${port})`);
  } catch (err) {
    logger.warn('Failed to record owned Gateway process:', err);
  }
}

/**
 * Clear the registry record. When `pid` is provided, only clears if the
 * stored record matches, so an exit event from an old process cannot wipe
 * the record of a newer one.
 */
export function clearOwnedGatewayProcess(pid?: number): void {
  try {
    if (typeof pid === 'number') {
      const record = readRecord();
      if (record && record.pid !== pid) return;
    }
    unlinkSync(registryFilePath());
  } catch {
    // File absent or not removable — nothing to do.
  }
}

/**
 * Terminate a Gateway process orphaned by a previous app run.
 *
 * Safety checks before killing:
 * - the recorded pid must not be the current app or its owned child;
 * - the pid must still be alive;
 * - the pid must actually be listening on the recorded port (guards against
 *   OS pid reuse after reboot — if not listening, we only clear the record).
 */
export async function terminateOrphanedOwnedGateway(currentOwnedPid?: number): Promise<void> {
  const record = readRecord();
  if (!record) return;

  if (record.pid === process.pid || (currentOwnedPid != null && record.pid === currentOwnedPid)) {
    return;
  }

  if (!isPidAlive(record.pid)) {
    clearOwnedGatewayProcess();
    return;
  }

  const listeners = await getListeningProcessIds(record.port);
  if (!listeners.includes(String(record.pid))) {
    logger.info(
      `Recorded Gateway pid=${record.pid} is alive but not listening on port ${record.port} (likely pid reuse); skipping kill`,
    );
    clearOwnedGatewayProcess();
    return;
  }

  logger.warn(
    `Found orphaned Gateway from a previous run (pid=${record.pid}, port=${record.port}); terminating to avoid duplicate gateways holding session locks`,
  );
  await terminateOrphanedProcessIds(record.port, [String(record.pid)]);
  clearOwnedGatewayProcess();
}

export type TerminateDuplicateGatewayChildrenOptions = {
  /** Keep this gateway child alive (the one GatewayManager currently owns). */
  keepPid?: number;
  /** Electron main process whose direct openclaw-gateway children should be scanned. */
  parentPid?: number;
  reason: string;
};

/**
 * Terminate duplicate openclaw-gateway children spawned by this app instance.
 *
 * Only targets direct Electron children named openclaw-gateway. Agent tool
 * processes (bash/python) are grandchildren and are not affected.
 */
export async function terminateDuplicateGatewayChildren(
  options: TerminateDuplicateGatewayChildrenOptions,
): Promise<number[]> {
  const parentPid = options.parentPid ?? process.pid;
  const childPids = await listGatewayChildProcessIds(parentPid);
  const targets = childPids.filter((pid) => pid !== options.keepPid);

  if (targets.length === 0) {
    return [];
  }

  logger.warn(
    `Terminating ${targets.length} duplicate Gateway child process(es) (${options.reason}; keepPid=${options.keepPid ?? 'none'}; pids=${targets.join(', ')})`,
  );
  await terminateProcessIds(targets.map(String));
  return targets;
}

export type PrepareGatewayStartupPortOptions = {
  defaultPort: number;
  keepPid?: number;
  parentPid?: number;
  findAvailablePort: (startPort: number, maxAttempts?: number) => Promise<number>;
};

/**
 * Ensure a single Gateway binds the default port before spawn.
 *
 * 1. Kill duplicate openclaw-gateway children from this app instance.
 * 2. Reset to the default port and wait for it to become free.
 * 3. Only increment the port when an unrelated process still owns it.
 */
export async function prepareGatewayStartupPort(
  options: PrepareGatewayStartupPortOptions,
): Promise<number> {
  await terminateDuplicateGatewayChildren({
    keepPid: options.keepPid,
    parentPid: options.parentPid,
    reason: 'pre-start',
  });

  await waitForPortFree(options.defaultPort);

  const availablePort = await options.findAvailablePort(options.defaultPort);
  if (availablePort !== options.defaultPort) {
    logger.warn(
      `Default Gateway port ${options.defaultPort} is occupied by an external process; using ${availablePort}`,
    );
  }

  return availablePort;
}
