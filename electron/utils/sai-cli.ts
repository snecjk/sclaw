/**
 * SAI CLI bridge — spawn sai binary from Electron main process
 *
 * Provides a thin wrapper around the SAI CLI binary so the renderer
 * can discover and execute dynamic commands through the existing
 * IPC / unified-request layer.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, chmodSync, readFileSync, appendFileSync } from 'node:fs';
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
  const binaryName = platform === 'win32' ? 'sai-cli.exe' : 'sai-cli';

  // 1. ~/.sai/bin/sai-cli (SAI CLI standard install path)
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
  const bundledBinName = platform === 'win32' ? 'sai-cli.exe' : 'sai-cli';

  // ── 1. New: unified resources/cli/ (platform-agnostic naming) ─────────────
  if (app.isPackaged) {
    const cliPath = join(process.resourcesPath, 'cli', bundledBinName);
    if (existsSync(cliPath)) return cliPath;
  }
  const devCliPath = join(__dirname, '../..', 'resources', 'cli', bundledBinName);
  if (existsSync(devCliPath)) return devCliPath;

  // ── 2. SAI/ directory with platform-arch subdirs ──────────────────────────
  const saiDirMap: Record<string, string> = {
    'darwin-x64': 'mac-amd64',
    'darwin-arm64': 'mac-arm64',
    'win32-x64': 'win-amd64',
    'win32-arm64': 'win-arm64',
    'linux-x64': 'linux-amd64',
    'linux-arm64': 'linux-arm64',
  };
  const saiDir = saiDirMap[`${platform}-${arch}`];

  if (app.isPackaged) {
    if (saiDir) {
      const packaged = join(process.resourcesPath, 'SAI', saiDir, bundledBinName);
      if (existsSync(packaged)) return packaged;
    }
    const packaged = join(process.resourcesPath, 'SAI', `${platform}-${arch}`, bundledBinName);
    if (existsSync(packaged)) return packaged;
  }

  if (saiDir) {
    const devPath = join(__dirname, '../..', 'SAI', saiDir, bundledBinName);
    if (existsSync(devPath)) return devPath;
  }
  const devPath = join(__dirname, '../..', 'SAI', `${platform}-${arch}`, bundledBinName);
  if (existsSync(devPath)) return devPath;

  // ── 3. Legacy fallback: resources/bin/ ────────────────────────────────────
  const legacyBinName = platform === 'win32' ? 'sai.exe' : 'sai';
  if (app.isPackaged) {
    const legacy = join(process.resourcesPath, 'bin', legacyBinName);
    if (existsSync(legacy)) return legacy;
    const legacyArch = join(process.resourcesPath, 'bin', `${platform}-${arch}`, legacyBinName);
    if (existsSync(legacyArch)) return legacyArch;
  }
  const devLegacy = join(__dirname, '../../resources/bin', `${platform}-${arch}`, legacyBinName);
  if (existsSync(devLegacy)) return devLegacy;

  return null;
}

function getSaiInstallTarget(): string {
  const binName = process.platform === 'win32' ? 'sai-cli.exe' : 'sai-cli';
  return join(homedir(), '.sai', 'bin', binName);
}

const SAI_BIN_DIR = join(homedir(), '.sai', 'bin');

/**
 * Ensure ~/.sai/bin is in the system PATH so `sai` can be invoked from
 * any shell / terminal window (including Gateway bash agents).
 *
 * - Windows: persists to the user registry PATH and broadcasts the change.
 * - macOS/Linux: appends an export line to detected shell RC files.
 */
function ensureSaiBinInPath(): void {
  const platform = process.platform;
  const pathSep = platform === 'win32' ? ';' : ':';
  const currentPath = process.env.PATH || '';

  // 1. Update the current Electron process PATH immediately so subsequent
  //    spawn() calls (including Gateway child processes) can resolve `sai`.
  const pathEntries = currentPath.split(pathSep);
  if (!pathEntries.includes(SAI_BIN_DIR)) {
    process.env.PATH = `${SAI_BIN_DIR}${pathSep}${currentPath}`;
    logger.info(`Added ${SAI_BIN_DIR} to current process PATH`);
  }

  // 2. Persist to the OS so new terminal windows also see the PATH.
  if (platform === 'win32') {
    ensureSaiBinInWindowsPath();
  } else {
    ensureSaiBinInUnixPath();
  }
}

function ensureSaiBinInWindowsPath(): void {
  try {
    const query = spawnSync('reg', [
      'query', 'HKEY_CURRENT_USER\\Environment', '/v', 'PATH',
    ], { encoding: 'utf-8' });

    let userPath = '';
    if (query.status === 0) {
      const match = query.stdout.match(/PATH\s+REG_\w+\s+(.+)/);
      if (match) userPath = match[1].trim();
    }

    if (userPath.includes(SAI_BIN_DIR)) return;

    const newPath = userPath ? `${userPath};${SAI_BIN_DIR}` : SAI_BIN_DIR;
    const add = spawnSync('reg', [
      'add', 'HKEY_CURRENT_USER\\Environment', '/v', 'PATH',
      '/t', 'REG_EXPAND_SZ', '/d', newPath, '/f',
    ], { encoding: 'utf-8' });

    if (add.status === 0) {
      logger.info(`Added ${SAI_BIN_DIR} to Windows user PATH`);
      broadcastWindowsEnvChange();
    } else {
      logger.warn('Failed to update Windows PATH:', add.stderr || add.stdout);
    }
  } catch (err) {
    logger.warn('Failed to update Windows PATH:', err);
  }
}

function broadcastWindowsEnvChange(): void {
  try {
    // Broadcast WM_SETTINGCHANGE so Explorer and other processes pick up
    // the new PATH without a reboot.
    spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      'Add-Type -MemberDefinition \'[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint fuFlags,uint uTimeout,out UIntPtr lpdwResult);\' -Name NativeMethods -Namespace Win32; $r = [UIntPtr]::Zero; [void][Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$r)',
    ], { encoding: 'utf-8', windowsHide: true });
  } catch {
    // Best-effort broadcast — ignore failures.
  }
}

function ensureSaiBinInUnixPath(): void {
  const rcFiles = [
    join(homedir(), '.zshrc'),
    join(homedir(), '.bashrc'),
    join(homedir(), '.bash_profile'),
    join(homedir(), '.profile'),
  ];

  const exportLine = `export PATH="${SAI_BIN_DIR}:\$PATH"`;

  for (const rcFile of rcFiles) {
    try {
      if (!existsSync(rcFile)) continue;
      const content = readFileSync(rcFile, 'utf-8');
      if (content.includes(SAI_BIN_DIR)) continue;

      appendFileSync(rcFile, `\n# Added by STO Claw\n${exportLine}\n`);
      logger.info(`Added ${SAI_BIN_DIR} to ${rcFile}`);
    } catch (err) {
      logger.warn(`Failed to update ${rcFile}:`, err);
    }
  }
}

/**
 * Auto-install SAI CLI from bundled app resources to ~/.sai/bin/
 * Called during startup so users don't need to manually install.
 */
export async function autoInstallSaiCliIfNeeded(
  notify?: (path: string) => void,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const target = getSaiInstallTarget();

  // Already installed — just make sure PATH is up to date
  if (existsSync(target)) {
    logger.debug('SAI CLI already installed at', target);
    ensureSaiBinInPath();
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

    ensureSaiBinInPath();

    logger.info(`SAI CLI auto-installed: ${target} (from ${bundled})`);
    notify?.(target);
    return { success: true, path: target };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to auto-install SAI CLI:', msg);
    return { success: false, error: msg };
  }
}
