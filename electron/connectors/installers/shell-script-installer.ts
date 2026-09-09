/**
 * Generic shell_script installer — download & run server-provided install scripts.
 * Used by managed_cli strategy=shell_script (e.g. QPath).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { buildSilentPowerShellArgs } from '../../utils/win-shell';

export interface ShellScriptInstallOptions {
  binary: string;
  unix?: string;
  windows?: string;
  /** e.g. ~/.sto/qpath-cli/bin — ~ expanded */
  binDir?: string;
}

export interface ShellScriptInstallResult {
  success: boolean;
  path?: string;
  version?: string;
  updated?: boolean;
  error?: string;
}

export type WindowsInstallScriptKind = 'cmd' | 'powershell';

export function detectWindowsInstallScriptKind(
  scriptUrl: string,
  script: string,
): WindowsInstallScriptKind {
  let pathname = scriptUrl.toLowerCase();
  try {
    pathname = new URL(scriptUrl).pathname.toLowerCase();
  } catch {
    // Keep the raw value for relative or otherwise non-standard URLs.
  }
  if (pathname.endsWith('.ps1')) return 'powershell';
  if (pathname.endsWith('.cmd') || pathname.endsWith('.bat')) return 'cmd';

  const withoutBom = script.replace(/^\uFEFF/, '');
  if (/^\s*(?:#requires\b|\[CmdletBinding\(\)\]|param\s*\(|\$[A-Za-z_][\w]*)/im.test(withoutBom)) {
    return 'powershell';
  }
  return 'cmd';
}

export function buildWindowsInstallScriptCommand(
  kind: WindowsInstallScriptKind,
  scriptPath: string,
): { command: string; args: string[] } {
  if (kind === 'powershell') {
    return {
      command: 'powershell.exe',
      args: buildSilentPowerShellArgs([
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ]),
    };
  }
  return { command: 'cmd.exe', args: ['/d', '/c', scriptPath] };
}

export function mergeWindowsPathValues(...values: Array<string | undefined>): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const value of values) {
    for (const rawEntry of value?.split(';') ?? []) {
      const entry = rawEntry.trim();
      const key = entry.replace(/[\\/]+$/, '').toLowerCase();
      if (!entry || seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.join(';');
}

function refreshWindowsProcessPath(): void {
  const command = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
    '@{ machine = [Environment]::GetEnvironmentVariable("Path", "Machine"); user = [Environment]::GetEnvironmentVariable("Path", "User") } | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawnSync('powershell.exe', buildSilentPowerShellArgs([
    '-Command',
    command,
  ]), {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout?.trim()) {
    logger.warn('[managed-cli] Unable to refresh Windows PATH after install');
    return;
  }
  try {
    const paths = JSON.parse(result.stdout) as { machine?: string; user?: string };
    process.env.PATH = mergeWindowsPathValues(paths.user, paths.machine, process.env.PATH);
  } catch (error) {
    logger.warn(
      '[managed-cli] Unable to parse refreshed Windows PATH:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function expandHome(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (trimmed.startsWith('~/') || trimmed === '~') {
    return join(homedir(), trimmed.slice(2));
  }
  if (trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function binaryFileName(binary: string): string {
  const base = binary.trim().replace(/\.exe$/i, '') || 'cli';
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function whichOnPath(name: string): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

export function resolveBinaryAfterInstall(options: {
  binary: string;
  binDir?: string;
}): string | null {
  const name = binaryFileName(options.binary);
  if (options.binDir?.trim()) {
    const dir = expandHome(options.binDir);
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return whichOnPath(name);
}

export function ensureBinDirOnPath(binDir?: string): void {
  if (!binDir?.trim()) return;
  const dir = expandHome(binDir);
  if (!existsSync(dir)) return;
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const current = process.env.PATH || '';
  const entries = current.split(pathSep);
  if (!entries.includes(dir)) {
    process.env.PATH = `${dir}${pathSep}${current}`;
    logger.info(`[managed-cli] Added ${dir} to process PATH`);
  }
}

async function runUnixScript(scriptUrl: string): Promise<void> {
  const response = await proxyAwareFetch(scriptUrl, {
    redirect: 'follow',
    headers: { Accept: '*/*' },
    timeoutMs: 120_000,
  });
  if (!response.ok) {
    throw new Error(`获取安装脚本失败 HTTP ${response.status}`);
  }
  const script = await response.text();
  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-cli-install-'));
  const scriptPath = join(tmpDir, 'install.sh');
  try {
    await writeFile(scriptPath, script, { mode: 0o755 });
    chmodSync(scriptPath, 0o755);
    const r = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      windowsHide: true,
      env: process.env,
    });
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || `install exit ${r.status}`).trim());
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runWindowsScript(scriptUrl: string): Promise<void> {
  const response = await proxyAwareFetch(scriptUrl, {
    redirect: 'follow',
    headers: { Accept: '*/*' },
    timeoutMs: 120_000,
  });
  if (!response.ok) {
    throw new Error(`获取 Windows 安装脚本失败 HTTP ${response.status}`);
  }
  const script = await response.text();
  const kind = detectWindowsInstallScriptKind(response.url || scriptUrl, script);
  const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-cli-install-'));
  const scriptPath = join(tmpDir, kind === 'powershell' ? 'install.ps1' : 'install.cmd');
  try {
    // Windows PowerShell 5.1 needs a BOM to reliably read non-ASCII UTF-8 scripts.
    const scriptContent = kind === 'powershell' && !script.startsWith('\uFEFF')
      ? `\uFEFF${script}`
      : script;
    await writeFile(scriptPath, scriptContent, 'utf8');
    const invocation = buildWindowsInstallScriptCommand(kind, scriptPath);
    const r = spawnSync(invocation.command, invocation.args, {
      encoding: 'utf8',
      windowsHide: true,
      cwd: tmpDir,
      env: process.env,
    });
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || `${scriptPath} exit ${r.status}`).trim());
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function probeVersion(binaryPath: string): string | undefined {
  const r = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const match = text.match(/(\d+\.\d+\.\d+[^\s]*)/);
  return match?.[1];
}

export async function installViaShellScript(
  options: ShellScriptInstallOptions,
): Promise<ShellScriptInstallResult> {
  try {
    const binary = options.binary.trim().replace(/\.exe$/i, '');
    if (!binary) {
      return { success: false, error: 'install.binary / runtime.binary 不能为空' };
    }

    if (options.binDir?.trim()) {
      mkdirSync(expandHome(options.binDir), { recursive: true });
    }

    const existing = resolveBinaryAfterInstall({
      binary,
      binDir: options.binDir,
    });
    if (existing) {
      ensureBinDirOnPath(options.binDir);
      return {
        success: true,
        path: existing,
        version: probeVersion(existing),
        updated: false,
      };
    }

    if (process.platform === 'win32') {
      const url = options.windows?.trim();
      if (!url) return { success: false, error: '缺少 install.windows 脚本 URL' };
      await runWindowsScript(url);
      // Installers commonly persist a new user PATH. Refresh it in this Electron
      // process so the newly installed binary is discoverable without a restart.
      refreshWindowsProcessPath();
    } else {
      const url = options.unix?.trim();
      if (!url) return { success: false, error: '缺少 install.unix 脚本 URL' };
      await runUnixScript(url);
    }

    ensureBinDirOnPath(options.binDir);
    const after = resolveBinaryAfterInstall({
      binary,
      binDir: options.binDir,
    });
    if (!after) {
      return {
        success: false,
        error: `安装脚本已执行，但未找到 ${binary} 二进制（检查 binDir / PATH）`,
      };
    }
    return {
      success: true,
      path: after,
      version: probeVersion(after),
      updated: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[managed-cli] shell_script install failed:', message);
    return { success: false, error: message };
  }
}
