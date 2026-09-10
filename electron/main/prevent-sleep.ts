import { powerSaveBlocker } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { getOpenClawResolvedDir } from '../utils/paths';
import { getSetting } from '../utils/store';
import { buildSilentPowerShellArgs } from '../utils/win-shell';

let blockerId: number | null = null;
let caffeinateProc: ChildProcess | null = null;
let windowsPowerProc: ChildProcess | null = null;
let windowsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let cachedSetThreadExecutionState: ((flags: number) => number) | null | undefined;

/**
 * Refresh interval for the Windows power helper.
 * Keep below typical idle sleep/hibernate timeouts (e.g. 60s).
 */
const WINDOWS_POWER_REFRESH_SEC = 15;
const ES_CONTINUOUS = 0x80000000 >>> 0;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_SYSTEM_ACTIVE = (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0;

const localRequire = createRequire(import.meta.url);

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

function resolveKoffiModule(): typeof import('koffi') | null {
  const requireRoots: string[] = [];
  const openclawDir = getOpenClawResolvedDir();
  requireRoots.push(join(openclawDir, 'package.json'));
  if (openclawDir.endsWith('.asar')) {
    requireRoots.push(join(`${openclawDir}.unpacked`, 'package.json'));
  }

  for (const root of requireRoots) {
    try {
      const openclawRequire = createRequire(root);
      return openclawRequire('koffi') as typeof import('koffi');
    } catch {
      // try next resolution root
    }
  }

  try {
    return localRequire('koffi') as typeof import('koffi');
  } catch {
    return null;
  }
}

function loadSetThreadExecutionState(): ((flags: number) => number) | null {
  if (cachedSetThreadExecutionState !== undefined) return cachedSetThreadExecutionState;
  if (process.platform !== 'win32') {
    cachedSetThreadExecutionState = null;
    return null;
  }

  try {
    const koffi = resolveKoffiModule();
    if (!koffi) {
      cachedSetThreadExecutionState = null;
      return null;
    }
    const kernel32 = koffi.load('kernel32.dll');
    cachedSetThreadExecutionState = kernel32.func(
      'uint32 __stdcall SetThreadExecutionState(uint32 esFlags)',
    );
    return cachedSetThreadExecutionState;
  } catch {
    cachedSetThreadExecutionState = null;
    return null;
  }
}

function applyWindowsExecutionState(flags: number): boolean {
  const api = loadSetThreadExecutionState();
  if (!api) return false;
  return api(flags) !== 0;
}

function stopWindowsPowerHelperProcess(): void {
  if (windowsPowerProc && !windowsPowerProc.killed) {
    windowsPowerProc.kill();
  }
  windowsPowerProc = null;
}

function stopWindowsExecutionState(): void {
  if (windowsRefreshTimer) {
    clearInterval(windowsRefreshTimer);
    windowsRefreshTimer = null;
  }
  stopWindowsPowerHelperProcess();
  if (cachedSetThreadExecutionState) {
    try {
      cachedSetThreadExecutionState(ES_CONTINUOUS);
    } catch {
      // ignore
    }
  }
}

export function buildWindowsPowerHelperScript(parentPid: number): string {
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

export function buildWindowsPowerHelperSpawnArgs(parentPid: number): string[] {
  return buildSilentPowerShellArgs([
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    buildWindowsPowerHelperScript(parentPid),
  ]);
}

function startWindowsPowerHelperProcess(): void {
  windowsPowerProc = spawn(
    'powershell.exe',
    buildWindowsPowerHelperSpawnArgs(process.pid),
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
  logger.info('[prevent-sleep] Enabled via SetThreadExecutionState (win32, hidden powershell fallback)');
}

function startWindowsExecutionState(): void {
  if (process.platform !== 'win32') return;

  stopWindowsExecutionState();
  try {
    if (applyWindowsExecutionState(ES_SYSTEM_ACTIVE)) {
      windowsRefreshTimer = setInterval(() => {
        if (!applyWindowsExecutionState(ES_SYSTEM_ACTIVE)) {
          logger.warn('[prevent-sleep] In-process SetThreadExecutionState refresh failed');
        }
      }, WINDOWS_POWER_REFRESH_SEC * 1000);
      if (typeof windowsRefreshTimer.unref === 'function') {
        windowsRefreshTimer.unref();
      }
      logger.info('[prevent-sleep] Enabled via SetThreadExecutionState (win32, in-process)');
      return;
    }
    startWindowsPowerHelperProcess();
  } catch (error) {
    logger.warn('[prevent-sleep] Failed to enable Windows power helper:', error);
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

export function setWindowsSetThreadExecutionStateForTests(
  fn: ((flags: number) => number) | null | undefined,
): void {
  cachedSetThreadExecutionState = fn;
}
