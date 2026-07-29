import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const LOCK_SCHEMA = 'stoclaw-instance-lock';
const LOCK_VERSION = 1;

export interface ProcessInstanceFileLock {
  acquired: boolean;
  lockPath: string;
  ownerPid?: number;
  ownerFormat?: 'legacy' | 'structured' | 'unknown';
  ownerExecutableName?: string;
  failureReason?: 'active-owner' | 'unverified-owner' | 'reclaim-failed' | 'io-error';
  release: () => void;
}

export interface ProcessInstanceFileLockOptions {
  userDataDir: string;
  lockName: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
  verifyOwnerExecutable?: boolean;
  reclaimUnknownLock?: boolean;
  currentExecutableName?: string;
  getProcessExecutableName?: (pid: number) => string | undefined;
}

function getWindowsProcessExecutableName(pid: number): string | undefined {
  if (process.platform !== 'win32') return undefined;

  try {
    const output = execFileSync(
      'tasklist.exe',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    const firstCsvField = /^"((?:""|[^"])*)",/.exec(output)?.[1];
    return firstCsvField?.replace(/""/g, '"').trim() || undefined;
  } catch {
    return undefined;
  }
}

function sameExecutableName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function shouldContinueWithElectronLock(
  fileLock: Pick<ProcessInstanceFileLock, 'acquired' | 'failureReason'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (fileLock.acquired) return true;
  if (fileLock.failureReason === 'io-error') return true;
  return platform === 'win32' && fileLock.failureReason !== 'active-owner';
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    return errno !== 'ESRCH';
  }
}

type ParsedLockOwner =
  | { kind: 'legacy'; pid: number }
  | { kind: 'structured'; pid: number }
  | { kind: 'unknown' };

interface StructuredLockContent {
  schema: string;
  version: number;
  pid: number;
}

function parsePositivePid(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseStructuredLockContent(raw: string): StructuredLockContent | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<StructuredLockContent>;
    if (
      parsed?.schema === LOCK_SCHEMA
      && parsed?.version === LOCK_VERSION
      && typeof parsed?.pid === 'number'
      && Number.isFinite(parsed.pid)
      && parsed.pid > 0
    ) {
      return {
        schema: parsed.schema,
        version: parsed.version,
        pid: parsed.pid,
      };
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}

function readLockOwner(lockPath: string): ParsedLockOwner {
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    const legacyPid = parsePositivePid(raw);
    if (legacyPid !== undefined) {
      return { kind: 'legacy', pid: legacyPid };
    }

    const structured = parseStructuredLockContent(raw);
    if (structured) {
      return { kind: 'structured', pid: structured.pid };
    }
  } catch {
    // ignore read errors
  }

  return { kind: 'unknown' };
}

export function acquireProcessInstanceFileLock(
  options: ProcessInstanceFileLockOptions,
): ProcessInstanceFileLock {
  const pid = options.pid ?? process.pid;
  const isPidAlive = options.isPidAlive ?? defaultPidAlive;

  mkdirSync(options.userDataDir, { recursive: true });
  const lockPath = join(options.userDataDir, `${options.lockName}.instance.lock`);

  let ownerPid: number | undefined;
  let ownerFormat: ProcessInstanceFileLock['ownerFormat'] = 'unknown';
  let ownerExecutableName: string | undefined;
  let failureReason: ProcessInstanceFileLock['failureReason'];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        // Keep writing legacy numeric format for broad backward compatibility.
        // Parser accepts both legacy numeric and structured JSON formats.
        writeFileSync(fd, String(pid), 'utf8');
      } finally {
        closeSync(fd);
      }

      let released = false;
      return {
        acquired: true,
        lockPath,
        release: () => {
          if (released) return;
          released = true;
          try {
            const currentOwner = readLockOwner(lockPath);
            if (
              (currentOwner.kind === 'legacy' || currentOwner.kind === 'structured')
              && currentOwner.pid !== pid
            ) {
              return;
            }
            if (currentOwner.kind === 'unknown') {
              return;
            }
            rmSync(lockPath, { force: true });
          } catch {
            // best-effort
          }
        },
      };
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno !== 'EEXIST') {
        failureReason = 'io-error';
        break;
      }

      const owner = readLockOwner(lockPath);
      if (owner.kind === 'legacy' || owner.kind === 'structured') {
        ownerPid = owner.pid;
        ownerFormat = owner.kind;
      } else {
        ownerPid = undefined;
        ownerFormat = 'unknown';
      }
      let shouldTreatAsStale = false;
      if (owner.kind === 'legacy' || owner.kind === 'structured') {
        if (!isPidAlive(owner.pid)) {
          shouldTreatAsStale = true;
        } else if (options.verifyOwnerExecutable) {
          const getProcessExecutableName =
            options.getProcessExecutableName ?? getWindowsProcessExecutableName;
          ownerExecutableName = getProcessExecutableName(owner.pid);
          const currentExecutableName =
            options.currentExecutableName ?? basename(process.execPath);
          if (ownerExecutableName) {
            shouldTreatAsStale = !sameExecutableName(
              ownerExecutableName,
              currentExecutableName,
            );
            if (!shouldTreatAsStale) failureReason = 'active-owner';
          } else {
            failureReason = 'unverified-owner';
          }
        } else {
          failureReason = 'active-owner';
        }
      } else if (options.reclaimUnknownLock) {
        shouldTreatAsStale = true;
      } else {
        failureReason = 'unverified-owner';
      }

      if (shouldTreatAsStale && existsSync(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
          continue;
        } catch {
          failureReason = 'reclaim-failed';
        }
      }

      break;
    }
  }

  return {
    acquired: false,
    lockPath,
    ownerPid,
    ownerFormat,
    ownerExecutableName,
    failureReason: failureReason ?? 'unverified-owner',
    release: () => {
      // no-op when lock wasn't acquired
    },
  };
}
