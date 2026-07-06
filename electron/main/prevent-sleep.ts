import { powerSaveBlocker } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';

let blockerId: number | null = null;
let caffeinateProc: ChildProcess | null = null;

function stopCaffeinate(): void {
  if (caffeinateProc && !caffeinateProc.killed) {
    caffeinateProc.kill();
  }
  caffeinateProc = null;
}

function startCaffeinate(): void {
  if (process.platform !== 'darwin') return;

  stopCaffeinate();
  try {
    caffeinateProc = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], {
      detached: false,
      stdio: 'ignore',
    });
    caffeinateProc.on('error', (error) => {
      logger.warn('[prevent-sleep] caffeinate failed to start:', error);
    });
    caffeinateProc.on('exit', () => {
      caffeinateProc = null;
    });
  } catch (error) {
    logger.warn('[prevent-sleep] Failed to spawn caffeinate:', error);
  }
}

export async function applyPreventSystemSleepSetting(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
        blockerId = powerSaveBlocker.start('prevent-app-suspension');
        logger.info('[prevent-sleep] Enabled via powerSaveBlocker');
      }
      startCaffeinate();
      return;
    }

    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
    blockerId = null;
    stopCaffeinate();
    logger.info('[prevent-sleep] Disabled');
  } catch (error) {
    logger.error(`[prevent-sleep] Failed to apply enabled=${enabled}:`, error);
  }
}

export async function syncPreventSystemSleepSettingFromStore(): Promise<void> {
  const preventSystemSleep = await getSetting('preventSystemSleep');
  await applyPreventSystemSleepSetting(Boolean(preventSystemSleep));
}

export function releasePreventSystemSleepOnQuit(): void {
  void applyPreventSystemSleepSetting(false);
}
