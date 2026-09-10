/**
 * Windows shell quoting utilities for child_process.spawn().
 *
 * When spawn() is called with `shell: true` on Windows, the command and
 * arguments are concatenated and passed to cmd.exe. Paths containing spaces
 * must be wrapped in double-quotes to prevent cmd.exe from splitting them
 * into separate tokens.
 *
 * This module is intentionally dependency-free so it can be unit-tested
 * without mocking Electron.
 */
import path from 'path';

/**
 * Quote a path/value for safe use with Windows cmd.exe (shell: true in spawn).
 *
 * When Node.js spawn is called with `shell: true` on Windows, cmd.exe
 * interprets spaces as argument separators. Wrapping the value in double
 * quotes prevents this. On non-Windows platforms the value is returned
 * unchanged so this function can be called unconditionally.
 */
export function quoteForCmd(value: string): string {
  if (process.platform !== 'win32') return value;
  if (!value.includes(' ')) return value;
  if (value.startsWith('"') && value.endsWith('"')) return value;
  return `"${value}"`;
}

/** True when `bin` is a cmd.exe script that Node cannot spawn without a shell. */
export function isWinBatchFile(bin: string): boolean {
  return /\.(cmd|bat)$/i.test(bin);
}

/**
 * Determine whether a spawn call needs `shell: true` on Windows.
 *
 * Full (absolute) `.exe` paths can be executed directly by the OS via
 * CreateProcessW. Simple command names (e.g. 'uv', 'node') need shell for
 * PATH/PATHEXT resolution. `.cmd` / `.bat` files always need a shell:
 * Node 18.20+/20.12+ rejects them with `spawn EINVAL` (CVE-2024-27980).
 */
export function needsWinShell(bin: string): boolean {
  if (process.platform !== 'win32') return false;
  if (isWinBatchFile(bin)) return true;
  return !path.win32.isAbsolute(bin);
}

/**
 * Prepare command and args for spawn(), handling Windows paths with spaces.
 *
 * Returns the shell option, the (possibly quoted) command, and the
 * (possibly quoted) args array ready for child_process.spawn().
 */
export function prepareWinSpawn(
  command: string,
  args: string[],
  forceShell?: boolean,
): { shell: boolean; command: string; args: string[] } {
  const isWin = process.platform === 'win32';
  const useShell = forceShell ?? needsWinShell(command);

  if (!useShell || !isWin) {
    return { shell: useShell, command, args };
  }

  return {
    shell: true,
    command: quoteForCmd(command),
    args: args.map(a => quoteForCmd(a)),
  };
}

/**
 * Normalize a module path for NODE_OPTIONS `--require` usage.
 *
 * Node parses NODE_OPTIONS using shell-like escaping rules. On Windows,
 * a quoted path with backslashes (e.g. "C:\Users\...") loses separators
 * because backslashes are interpreted as escapes. Using forward slashes
 * keeps the absolute path intact while still being valid on Windows.
 */
export function normalizeNodeRequirePathForNodeOptions(modulePath: string): string {
  if (process.platform !== 'win32') return modulePath;
  return modulePath.replace(/\\/g, '/');
}

/**
 * Append a `--require` preload module path to NODE_OPTIONS safely.
 */
export function appendNodeRequireToNodeOptions(
  nodeOptions: string | undefined,
  modulePath: string,
): string {
  const normalized = normalizeNodeRequirePathForNodeOptions(modulePath);
  return `${nodeOptions ?? ''} --require "${normalized}"`.trim();
}

/**
 * Quiet powershell.exe without allocating a console window.
 * Must appear before `-Command` / `-File` / `-EncodedCommand`.
 *
 * Do not pass `-WindowStyle Hidden`: PowerShell creates a real window then
 * hides it, which flashes a black console. Hide with CREATE_NO_WINDOW
 * (`windowsHide: true`) instead — same as main.
 */
const SILENT_POWERSHELL_PREFIX = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
] as const;

export function silentPowerShellPrefix(): string[] {
  return [...SILENT_POWERSHELL_PREFIX];
}

/** Build powershell.exe argv: quiet prefix + caller flags (`-Command` / `-File` / …). */
export function buildSilentPowerShellArgs(rest: string[]): string[] {
  return ensureSilentPowerShellArgs(rest);
}

function hasPowerShellSwitch(args: string[], name: string): boolean {
  const needle = name.toLowerCase();
  return args.some((arg) => String(arg).toLowerCase() === needle);
}

/** Drop `-WindowStyle …` so callers cannot reintroduce the console flash. */
export function stripPowerShellWindowStyle(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (String(args[i]).toLowerCase() === '-windowstyle') {
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

/** Prepend missing quiet flags without duplicating switches already present. */
export function ensureSilentPowerShellArgs(args: string[]): string[] {
  const stripped = stripPowerShellWindowStyle(args);
  const prefix: string[] = [];
  if (!hasPowerShellSwitch(stripped, '-NoLogo')) prefix.push('-NoLogo');
  if (!hasPowerShellSwitch(stripped, '-NoProfile')) prefix.push('-NoProfile');
  if (!hasPowerShellSwitch(stripped, '-NonInteractive')) prefix.push('-NonInteractive');
  return prefix.length > 0 ? [...prefix, ...stripped] : stripped;
}

export function isPowerShellExecutable(cmd: string): boolean {
  const token = cmd.trim().replace(/^"(.*)"$/, '$1').split(/\s+/)[0]?.replace(/^"(.*)"$/, '$1') ?? '';
  return /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(token)
    || /^(?:powershell|pwsh)(?:\.exe)?$/i.test(token);
}

export function isWindowsConsoleHost(cmd: string): boolean {
  if (isPowerShellExecutable(cmd)) return true;
  const token = cmd.trim().replace(/^"(.*)"$/, '$1').split(/\s+/)[0]?.replace(/^"(.*)"$/, '$1') ?? '';
  return /(?:^|[\\/])cmd(?:\.exe)?$/i.test(token) || /^cmd(?:\.exe)?$/i.test(token);
}

function findChildProcessOptionsIndex(args: unknown[]): number {
  for (let i = 1; i < args.length; i += 1) {
    const value = args[i];
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value !== 'function') {
      return i;
    }
  }
  return -1;
}

function withWindowsHideOptions(
  options: Record<string, unknown> | undefined,
  cmd: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(options ?? {}), windowsHide: true };
  // DETACHED_PROCESS fights CREATE_NO_WINDOW and still allocates a console.
  if (isWindowsConsoleHost(cmd)) next.detached = false;
  return next;
}

/**
 * Force Windows child processes to use CREATE_NO_WINDOW (`windowsHide`).
 * Do not add `-WindowStyle Hidden` — that allocates a console then hides it.
 */
export function applyWindowsHiddenSpawnArgs(args: unknown[]): unknown[] {
  if (process.platform !== 'win32') return args;
  const next = [...args];
  const cmd = typeof next[0] === 'string' ? next[0] : '';
  if (Array.isArray(next[1]) && isPowerShellExecutable(cmd)) {
    next[1] = ensureSilentPowerShellArgs(next[1].map(String));
  }

  const optIdx = findChildProcessOptionsIndex(next);
  if (optIdx >= 0) {
    next[optIdx] = withWindowsHideOptions(next[optIdx] as Record<string, unknown>, cmd);
    return next;
  }

  const hideOptions = withWindowsHideOptions(undefined, cmd);
  if (typeof next[next.length - 1] === 'function') {
    next.splice(next.length - 1, 0, hideOptions);
  } else {
    next.push(hideOptions);
  }
  return next;
}
