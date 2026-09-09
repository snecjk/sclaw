/**
 * Resolve / bootstrap STO snpm (`@sto/snpm`) for user-app dependency installs.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';
import { getManagedNodePaths, getNodeSpawnEnv } from './node-runtime';
import { prepareWinSpawn } from './win-shell';
import { logger } from './logger';

export const STO_SNPM_REGISTRY = 'http://snpm-registry.sto.cn';
export const STO_SNPM_PACKAGE = '@sto/snpm';

export function snpmInstallPrefix(): string {
  return join(homedir(), '.stoclaw', 'runtime', 'snpm');
}

function snpmFileNames(): string[] {
  return process.platform === 'win32' ? ['snpm.cmd', 'snpm.bat', 'snpm'] : ['snpm'];
}

function extraSnpmDirs(): string[] {
  const prefix = snpmInstallPrefix();
  const dirs = [
    join(prefix, 'bin'),
    prefix,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  return [...dirs, ...pathDirs];
}

export function resolveSnpmBin(): string | null {
  const names = snpmFileNames();
  for (const dir of extraSnpmDirs()) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function spawnOnce(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const prepared = prepareWinSpawn(command, args);
    const child = spawn(prepared.command, prepared.args, {
      cwd,
      env: getNodeSpawnEnv() as NodeJS.ProcessEnv,
      windowsHide: true,
      shell: prepared.shell,
    });
    const tail: string[] = [];
    const onData = (chunk: unknown) => {
      tail.push(String(chunk));
      if (tail.length > 40) tail.shift();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`snpm bootstrap failed (code ${code})\n${tail.join('').trim()}`));
    });
  });
}

/** Ensure snpm exists: PATH / Homebrew, else install `@sto/snpm` under ~/.stoclaw. */
export async function ensureSnpmBin(): Promise<string> {
  const existing = resolveSnpmBin();
  if (existing) return existing;

  const { npmBin } = getManagedNodePaths();
  if (!npmBin || !existsSync(npmBin)) {
    throw new Error('未找到 snpm，且托管 npm 不可用，无法安装 @sto/snpm');
  }
  const prefix = snpmInstallPrefix();
  logger.info(`[app-dev] installing ${STO_SNPM_PACKAGE} prefix=${prefix}`);
  await spawnOnce(npmBin, [
    'install',
    '-g',
    STO_SNPM_PACKAGE,
    `--prefix=${prefix}`,
    `--registry=${STO_SNPM_REGISTRY}`,
  ]);
  const installed = resolveSnpmBin();
  if (!installed) {
    throw new Error(
      `未找到 snpm。请安装：npm install -g ${STO_SNPM_PACKAGE} --registry=${STO_SNPM_REGISTRY}`,
    );
  }
  return installed;
}
