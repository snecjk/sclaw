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
 * Flags that keep powershell.exe from allocating a visible console.
 * Must appear before `-Command` / `-File` / `-EncodedCommand`.
 */
const SILENT_POWERSHELL_PREFIX = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-WindowStyle',
  'Hidden',
] as const;

export function silentPowerShellPrefix(): string[] {
  return [...SILENT_POWERSHELL_PREFIX];
}

/** Build powershell.exe argv: silent prefix + caller flags (`-Command` / `-File` / …). */
export function buildSilentPowerShellArgs(rest: string[]): string[] {
  return [...SILENT_POWERSHELL_PREFIX, ...rest];
}

function hasPowerShellSwitch(args: string[], name: string): boolean {
  const needle = name.toLowerCase();
  return args.some((arg) => String(arg).toLowerCase() === needle);
}

/** Prepend missing hide flags without duplicating switches already present. */
export function ensureSilentPowerShellArgs(args: string[]): string[] {
  const prefix: string[] = [];
  if (!hasPowerShellSwitch(args, '-NoLogo')) prefix.push('-NoLogo');
  if (!hasPowerShellSwitch(args, '-NoProfile')) prefix.push('-NoProfile');
  if (!hasPowerShellSwitch(args, '-NonInteractive')) prefix.push('-NonInteractive');
  if (!hasPowerShellSwitch(args, '-WindowStyle')) prefix.push('-WindowStyle', 'Hidden');
  return prefix.length > 0 ? [...prefix, ...args] : args;
}
