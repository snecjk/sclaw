import { join } from 'path';
import { readdir, readFile, unlink } from 'fs/promises';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const raw = await readFile(lockPath, 'utf-8');
    const payload = JSON.parse(raw) as { pid?: number };
    if (typeof payload.pid === 'number' && payload.pid > 0) {
      return !isPidAlive(payload.pid);
    }
    // Lock file has no valid PID → treat as stale
    return true;
  } catch {
    // Cannot read or parse lock file → treat as stale
    return true;
  }
}

/**
 * Clean up stale session lock files left behind by crashed Gateway processes.
 *
 * OpenClaw uses .jsonl.lock files for session write locking. On Windows,
 * the lock-recovery mechanism is imperfect (no /proc filesystem for PID
 * starttime comparison). If the Gateway crashes or is force-killed, these
 * lock files may be left behind and cause new sessions to fail with
 * "session file locked (timeout 10000ms)".
 *
 * This function is called before Gateway start to ensure a clean slate.
 * It inspects each lock file's PID and only removes locks whose owner
 * process is no longer alive, avoiding races with a running Gateway.
 */
export async function cleanupStaleSessionLocks(): Promise<void> {
  try {
    const agentsDir = join(getOpenClawConfigDir(), 'agents');
    const agentEntries = await readdir(agentsDir).catch(() => [] as string[]);
    let removedCount = 0;
    let skippedCount = 0;

    await Promise.all(
      agentEntries.map(async (agentId) => {
        const sessionsDir = join(agentsDir, agentId, 'sessions');
        const entries = await readdir(sessionsDir).catch(() => [] as string[]);

        await Promise.all(
          entries.map(async (fileName) => {
            if (!fileName.endsWith('.jsonl.lock')) return;
            const lockPath = join(sessionsDir, fileName);
            try {
              const stale = await isLockStale(lockPath);
              if (!stale) {
                skippedCount++;
                return;
              }
              await unlink(lockPath);
              removedCount++;
            } catch {
              // ignore individual unlink failures
            }
          })
        );
      })
    );

    if (removedCount > 0 || skippedCount > 0) {
      logger.info(
        `Session lock cleanup: removed ${removedCount} stale, skipped ${skippedCount} active`
      );
    }
  } catch (err) {
    logger.warn('Failed to clean up stale session lock files:', err);
  }
}
