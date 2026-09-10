import childProcess from 'node:child_process';
import { applyWindowsHiddenSpawnArgs } from './win-shell';

const PATCH_FLAG = '__sclawChildProcessWindowsHidePatched';

function patchMethod<K extends keyof typeof childProcess>(method: K): void {
  const original = (childProcess[method] as (...args: unknown[]) => unknown).bind(childProcess);
  (childProcess[method] as unknown) = ((...args: unknown[]) => (
    original(...applyWindowsHiddenSpawnArgs(args))
  ));
}

/** Hide console windows for every child_process spawn in this process (Windows only). */
export function installChildProcessWindowsHidePatch(): void {
  if (process.platform !== 'win32') return;
  const flagHolder = childProcess as typeof childProcess & { [PATCH_FLAG]?: boolean };
  if (flagHolder[PATCH_FLAG]) return;
  flagHolder[PATCH_FLAG] = true;

  try {
    (['spawn', 'exec', 'execFile'] as const).forEach(patchMethod);
    (['spawnSync', 'execSync', 'execFileSync'] as const).forEach(patchMethod);
  } catch {
    flagHolder[PATCH_FLAG] = false;
  }
}
