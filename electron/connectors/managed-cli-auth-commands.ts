/**
 * Run managed_cli auth status/logout from server descriptor argv.
 * Embedded login UIs remain product-specific for now.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ManagedCliAuthSpec } from '../../shared/connectors/types';
import { resolveBinaryAfterInstall } from './installers/shell-script-installer';

export interface CliAuthCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

function resolveBinaryPath(options: {
  binary: string;
  binDir?: string;
}): string | null {
  const fromInstall = resolveBinaryAfterInstall({
    binary: options.binary,
    binDir: options.binDir,
  });
  if (fromInstall) return fromInstall;

  const name = options.binary.trim().replace(/\.exe$/i, '');
  const stoclaw = join(
    homedir(),
    '.stoclaw',
    'bin',
    process.platform === 'win32' ? `${name}.exe` : name,
  );
  if (existsSync(stoclaw)) return stoclaw;
  return null;
}

function runArgv(
  argv: string[],
  options: { binary: string; binDir?: string; timeoutMs?: number },
): Promise<CliAuthCommandResult> {
  if (argv.length === 0) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      error: 'auth argv 为空',
    });
  }

  const [head, ...rest] = argv;
  const headName = head.replace(/\.exe$/i, '').toLowerCase();
  const binaryName = options.binary.trim().replace(/\.exe$/i, '').toLowerCase();

  let cmd = head;
  let cmdArgs = rest;
  if (headName === binaryName) {
    const resolved = resolveBinaryPath({
      binary: options.binary,
      binDir: options.binDir,
    });
    if (resolved) cmd = resolved;
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: 124,
        error: `command timed out: ${argv.join(' ')}`,
      });
    }, options.timeoutMs ?? 30_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: 1,
        error: error.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        exitCode,
        error: exitCode === 0 ? undefined : (stderr || stdout || `exit ${exitCode}`),
      });
    });
  });
}

export async function runAuthArgv(options: {
  argv: string[];
  binary: string;
  binDir?: string;
  timeoutMs?: number;
}): Promise<CliAuthCommandResult> {
  return runArgv(options.argv, {
    binary: options.binary,
    binDir: options.binDir,
    timeoutMs: options.timeoutMs,
  });
}

export async function runAuthLoginFromSpec(options: {
  auth: ManagedCliAuthSpec;
  binary: string;
  binDir?: string;
  timeoutMs?: number;
}): Promise<CliAuthCommandResult> {
  const argv = options.auth.login;
  if (!argv?.length) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      error: 'auth.login 未配置',
    };
  }
  return runArgv(argv, {
    binary: options.binary,
    binDir: options.binDir,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
}

export async function runAuthStatusFromSpec(options: {
  auth: ManagedCliAuthSpec;
  binary: string;
  binDir?: string;
}): Promise<CliAuthCommandResult> {
  const argv = options.auth.status;
  if (!argv?.length) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      error: 'auth.status 未配置',
    };
  }
  return runArgv(argv, {
    binary: options.binary,
    binDir: options.binDir,
  });
}

export async function runAuthLogoutFromSpec(options: {
  auth: ManagedCliAuthSpec;
  binary: string;
  binDir?: string;
}): Promise<CliAuthCommandResult> {
  const argv = options.auth.logout;
  if (!argv?.length) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      error: 'auth.logout 未配置',
    };
  }
  return runArgv(argv, {
    binary: options.binary,
    binDir: options.binDir,
  });
}
