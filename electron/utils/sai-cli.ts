/**
 * SAI CLI bridge — spawn sai binary from Electron main process
 *
 * Provides a thin wrapper around the SAI CLI binary so the renderer
 * can discover and execute dynamic commands through the existing
 * IPC / unified-request layer.
 */
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import { logger } from './logger';

export interface SaiCliResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  exitCode: number;
}

function resolveSaiBinary(): string | null {
  const platform = process.platform;
  const binaryName = platform === 'win32' ? 'sai.exe' : 'sai';

  // 1. ~/.sai/bin/sai (SAI CLI standard install path)
  const userBin = join(homedir(), '.sai', 'bin', binaryName);
  if (existsSync(userBin)) return userBin;

  // 2. Bundled binary (packaged or development mode)
  const bundled = getBundledSaiPath();
  if (bundled) return bundled;

  // 3. Let shell resolve via PATH
  return binaryName;
}

function runSai(args: string[], timeoutMs = 30000): Promise<SaiCliResult> {
  const binary = resolveSaiBinary();
  if (!binary) {
    return Promise.resolve({
      ok: false,
      error: 'SAI CLI not found. Install it first.',
      exitCode: -1,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      env: { ...process.env, SAI_OUTPUT: 'json' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn SAI CLI: ${err.message}`,
        exitCode: -1,
      });
    });

    child.on('close', (code) => {
      // SAI CLI outputs JSON envelope as the last line:
      // {"ok":true,"data":...} or {"ok":false,"error":...}
      const lastLine = stdout.trim().split('\n').pop() || '{}';
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed && typeof parsed.ok === 'boolean') {
          resolve({ ...parsed, exitCode: code ?? 0 });
          return;
        }
      } catch {
        // Not a JSON envelope — fall through to raw output handling
      }

      if (code === 0) {
        resolve({ ok: true, data: stdout.trim() || undefined, exitCode: 0 });
      } else {
        resolve({
          ok: false,
          error: stderr.trim() || stdout.trim() || `exit code ${code}`,
          exitCode: code ?? 1,
        });
      }
    });
  });
}

// ── Basic commands ──────────────────────────────────────────────────────────

export async function saiVersion(): Promise<SaiCliResult> {
  return runSai(['version', '--json']);
}

export async function saiWhoami(): Promise<SaiCliResult> {
  return runSai(['whoami']);
}

export async function saiDiscover(context?: string): Promise<SaiCliResult> {
  const args = ['discover'];
  if (context) args.push('--context', context);
  return runSai(args);
}

export async function saiList(filter?: { product?: string; module?: string }): Promise<SaiCliResult> {
  const args = ['list'];
  if (filter?.product) args.push('--product', filter.product);
  if (filter?.module) args.push('--module', filter.module);
  return runSai(args);
}

// ── Dynamic command execution ───────────────────────────────────────────────

export async function saiExecute(
  commandPath: string,
  params?: Record<string, unknown>,
): Promise<SaiCliResult> {
  const args = commandPath.split('/');
  if (params && Object.keys(params).length > 0) {
    args.push('--params', JSON.stringify(params));
  }
  return runSai(args, 60000);
}

// ── Installation detection ──────────────────────────────────────────────────

export async function saiCheckInstalled(): Promise<{
  installed: boolean;
  version?: string;
  path?: string;
}> {
  const binary = resolveSaiBinary();
  const result = await saiVersion();

  if (!result.ok) {
    return { installed: false };
  }

  const versionStr =
    typeof result.data === 'object' && result.data !== null
      ? (result.data as Record<string, unknown>).version
      : undefined;

  return {
    installed: true,
    version: typeof versionStr === 'string' ? versionStr : undefined,
    path: binary ?? undefined,
  };
}

// ── Auto-install from bundled resources ─────────────────────────────────────

function getBundledSaiPath(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  const binName = platform === 'win32' ? 'sai.exe' : 'sai';

  // 1. Packaged mode: electron-builder puts binaries in resources/bin/
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'bin', binName);
    if (existsSync(bundled)) return bundled;

    const altBundled = join(process.resourcesPath, 'bin', `${platform}-${arch}`, binName);
    if (existsSync(altBundled)) return altBundled;
  }

  // 2. Development mode: look in project resources/bin/<platform>/
  const devBundled = join(__dirname, '../../resources/bin', `${platform}-${arch}`, binName);
  if (existsSync(devBundled)) return devBundled;

  // 3. Fallback: look in SAI/ directory at project root
  const sourceMapping: Record<string, string> = {
    'darwin-arm64': 'SAI/mac-arm64/sai-cli',
    'darwin-x64': 'SAI/mac-amd64/sai-cli',
    'linux-arm64': 'SAI/linux-arm64/sai-cli',
    'linux-x64': 'SAI/linux-amd64/sai-cli',
    'win32-arm64': 'SAI/win-arm64/sai-cli.exe',
    'win32-x64': 'SAI/win-amd64/sai-cli.exe',
  };
  const platformArch = `${platform}-${arch}`;
  if (sourceMapping[platformArch]) {
    const sourceBin = join(__dirname, '../..', sourceMapping[platformArch]);
    if (existsSync(sourceBin)) return sourceBin;
  }

  return null;
}

function getSaiInstallTarget(): string {
  const binName = process.platform === 'win32' ? 'sai.exe' : 'sai';
  return join(homedir(), '.sai', 'bin', binName);
}

/**
 * Auto-install SAI CLI from bundled app resources to ~/.sai/bin/
 * Called during startup so users don't need to manually install.
 */
export async function autoInstallSaiCliIfNeeded(
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const target = getSaiInstallTarget();

  // Already installed — nothing to do
  if (existsSync(target)) {
    logger.debug('SAI CLI already installed at', target);
    return { success: true, path: target };
  }

  const bundled = getBundledSaiPath();
  if (!bundled) {
    const msg = 'Bundled SAI CLI not found in app resources.';
    logger.warn(msg);
    return { success: false, error: msg };
  }

  try {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(bundled, target);

    if (process.platform !== 'win32') {
      chmodSync(target, 0o755);
    }

    logger.info(`SAI CLI auto-installed: ${target} (from ${bundled})`);
    notify?.(target);
    return { success: true, path: target };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to auto-install SAI CLI:', msg);
    return { success: false, error: msg };
  }
}
