import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireProcessInstanceFileLock,
  shouldContinueWithElectronLock,
} from '@electron/main/process-instance-lock';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stoclaw-instance-lock-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('process instance file lock', () => {
  it('acquires lock and writes owner pid', () => {
    const userDataDir = createTempDir();
    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 12345,
    });

    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    expect(lock.acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('12345');

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('rejects a second lock when owner pid is alive', () => {
    const userDataDir = createTempDir();
    const first = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 2222,
      isPidAlive: () => true,
    });

    const second = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 3333,
      isPidAlive: () => true,
    });

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.ownerPid).toBe(2222);
    expect(second.ownerFormat).toBe('legacy');

    first.release();
  });

  it('replaces stale lock file when owner pid is not alive', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, '4444', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 5555,
      isPidAlive: () => false,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('5555');
    lock.release();
  });

  it('reclaims a live PID lock when the PID belongs to another executable', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, '4444', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 5555,
      isPidAlive: () => true,
      verifyOwnerExecutable: true,
      currentExecutableName: 'SClaw.exe',
      getProcessExecutableName: () => 'cmd.exe',
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('5555');
    lock.release();
  });

  it('keeps a live lock owned by the same executable', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, '4444', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 5555,
      isPidAlive: () => true,
      verifyOwnerExecutable: true,
      currentExecutableName: 'SClaw.exe',
      getProcessExecutableName: () => 's claw.EXE',
    });

    expect(lock.acquired).toBe(false);
    expect(lock.failureReason).toBe('active-owner');
    expect(lock.ownerExecutableName).toBe('s claw.EXE');
    expect(readFileSync(lockPath, 'utf8')).toBe('4444');
  });

  it('reclaims malformed lock content when recovery is enabled', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, 'not-a-pid', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 6666,
      reclaimUnknownLock: true,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('6666');
    lock.release();
  });

  it('replaces stale structured lock file when owner pid is not alive', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, JSON.stringify({
      schema: 'stoclaw-instance-lock',
      version: 1,
      pid: 7777,
    }), 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 6666,
      isPidAlive: () => false,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('6666');
    lock.release();
  });

  it('does not treat malformed lock file content as stale', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, 'not-a-pid', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 6666,
    });

    expect(lock.acquired).toBe(false);
    expect(lock.ownerPid).toBeUndefined();
    expect(lock.ownerFormat).toBe('unknown');
    expect(readFileSync(lockPath, 'utf8')).toBe('not-a-pid');
  });

  it('does not remove lock file if ownership changed before release', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    const first = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 1234,
    });

    // Simulate a new process acquiring the lock after a handover race.
    writeFileSync(lockPath, '9999', 'utf8');
    first.release();

    expect(readFileSync(lockPath, 'utf8')).toBe('9999');
  });

  it('does not treat unknown structured lock schema as stale', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'stoclaw.instance.lock');
    writeFileSync(lockPath, JSON.stringify({
      schema: 'future-lock-schema',
      version: 2,
      pid: 8888,
      owner: 'future-build',
    }), 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'stoclaw',
      pid: 9999,
    });

    expect(lock.acquired).toBe(false);
    expect(lock.ownerPid).toBeUndefined();
    expect(lock.ownerFormat).toBe('unknown');
    expect(readFileSync(lockPath, 'utf8')).toContain('future-lock-schema');
  });

  it('only lets Windows fall back for an unverified file lock', () => {
    const unverifiedLock = {
      acquired: false,
      failureReason: 'unverified-owner' as const,
    };
    const activeLock = {
      acquired: false,
      failureReason: 'active-owner' as const,
    };

    expect(shouldContinueWithElectronLock(unverifiedLock, 'win32')).toBe(true);
    expect(shouldContinueWithElectronLock(unverifiedLock, 'linux')).toBe(false);
    expect(shouldContinueWithElectronLock(activeLock, 'win32')).toBe(false);
    expect(shouldContinueWithElectronLock({
      acquired: false,
      failureReason: 'reclaim-failed',
    }, 'win32')).toBe(true);
    expect(shouldContinueWithElectronLock({
      acquired: false,
      failureReason: 'io-error',
    }, 'linux')).toBe(true);
  });
});
