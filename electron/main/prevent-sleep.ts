import { powerSaveBlocker } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';

let blockerId: number | null = null;
let caffeinateProc: ChildProcess | null = null;
let windowsPowerProc: ChildProcess | null = null;

/**
 * Refresh interval for the Windows power helper.
 * Keep below typical idle sleep/hibernate timeouts (e.g. 60s).
 */
const WINDOWS_POWER_REFRESH_SEC = 15;

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

function stopWindowsExecutionState(): void {
  if (windowsPowerProc && !windowsPowerProc.killed) {
    windowsPowerProc.kill();
  }
  windowsPowerProc = null;
}

function buildWindowsPowerHelperScript(parentPid: number): string {
  return `
$ErrorActionPreference = 'Stop'
$parentPid = ${parentPid}
$refreshSec = ${WINDOWS_POWER_REFRESH_SEC}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class StoClawPower {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
# SYSTEM only: block idle sleep/hibernate; display may still turn off per power plan.
$active = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED
$clear = $ES_CONTINUOUS
function Set-StoClawActiveState {
  $result = [StoClawPower]::SetThreadExecutionState($active)
  if ($result -eq 0) {
    throw 'SetThreadExecutionState failed'
  }
}
Set-StoClawActiveState
while (Get-Process -Id $parentPid -ErrorAction SilentlyContinue) {
  Start-Sleep -Seconds $refreshSec
  if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }
  Set-StoClawActiveState
}
[void][StoClawPower]::SetThreadExecutionState($clear)
`.trim();
}

function startWindowsExecutionState(): void {
  if (process.platform !== 'win32') return;

  stopWindowsExecutionState();
  try {
    windowsPowerProc = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          buildWindowsPowerHelperScript(process.pid),
        ],
        {
          detached: false,
          stdio: 'ignore',
          windowsHide: true,
        },
    );
    windowsPowerProc.on('error', (error) => {
      logger.warn('[prevent-sleep] Windows SetThreadExecutionState helper failed to start:', error);
    });
    windowsPowerProc.on('exit', (code) => {
      windowsPowerProc = null;
      if (code !== 0 && code !== null) {
        logger.warn(`[prevent-sleep] Windows SetThreadExecutionState helper exited with code ${code}`);
      }
    });
    logger.info('[prevent-sleep] Enabled via SetThreadExecutionState (win32, system-only)');
  } catch (error) {
    logger.warn('[prevent-sleep] Failed to spawn Windows power helper:', error);
  }
}

export async function applyPreventSystemSleepSetting(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
        blockerId = powerSaveBlocker.start('prevent-app-suspension');
        logger.info('[prevent-sleep] Enabled via powerSaveBlocker (prevent-app-suspension)');
      }
      startCaffeinate();
      startWindowsExecutionState();
      return;
    }

    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
    blockerId = null;
    stopCaffeinate();
    stopWindowsExecutionState();
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
