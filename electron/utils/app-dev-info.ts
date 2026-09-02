/**
 * Helpers for user app creation and the setup pipeline
 * (capabilities: app-create-scaffold / service-dev-server). No Electron deps.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export type AppDevPhase =
  | 'created'        // scaffold done, pipeline not started
  | 'preparing-env'  // managed Node runtime downloading
  | 'checking-snpm'  // detect or install STO snpm
  | 'installing'     // snpm install running
  | 'starting'       // dev server spawning / probing
  | 'ready'          // preview reachable
  | 'stopped'        // dev server not running (installed)
  | 'error';

/**
 * Map a phase (plus intra-phase ratio 0..1) onto one continuous 0-100 progress
 * bar so the user sees a single smooth progression instead of separate
 * technical steps (UX requirement: one continuous progress indication).
 */
export function pipelineProgress(phase: AppDevPhase, ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  switch (phase) {
    case 'created':
      return 0;
    case 'preparing-env':
      return Math.round(clamped * 18);
    case 'checking-snpm':
      return Math.round(18 + clamped * 14);
    case 'installing':
      return Math.round(32 + clamped * 48);
    case 'starting':
      return Math.round(80 + clamped * 19);
    case 'ready':
      return 100;
    case 'stopped':
    case 'error':
      return 0;
  }
}

/** Derive an npm-safe package name from a user-facing app name. */
export function sanitizePackageName(appName: string): string {
  const normalized = appName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'sclaw-app';
}

/** Text file extensions that go through template variable substitution. */
const TEXT_EXTENSIONS = new Set([
  '.json', '.html', '.md', '.ts', '.tsx', '.css', '.js', '.jsx', '.txt', '.npmrc', '.gitignore',
  '.yaml', '.yml',
]);

export function isTemplateTextFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot) : fileName;
  // dotfiles like .npmrc / .gitignore have the "extension" equal to the name
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(fileName);
}

/** Apply template variables to file content. */
export function substituteTemplateVars(
  content: string,
  vars: { appName: string; appTitle: string },
): string {
  return content
    .replaceAll('__APP_NAME__', vars.appName)
    .replaceAll('__APP_TITLE__', vars.appTitle);
}

/**
 * Synthetic creeping progress for phases without deterministic progress
 * (npm install): approach 1.0 asymptotically as activity events arrive so the
 * bar keeps moving without ever completing prematurely.
 */
export function creepRatio(previous: number, step = 0.06): number {
  return Math.min(0.98, previous + (1 - previous) * step);
}

const NPM_BOOKKEEPING_DIRS = new Set(['.bin', '.cache', '.vite']);

function dirHasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'));
}

/**
 * True when the app npm cwd still needs `npm install`.
 * Treats a leftover empty or interrupted `node_modules` as missing
 * (killed install often leaves the folder without real packages).
 */
export function needsAppNpmInstall(npmCwd: string): boolean {
  const nodeModules = join(npmCwd, 'node_modules');
  if (!existsSync(nodeModules)) return true;
  try {
    const entries = readdirSync(nodeModules, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || NPM_BOOKKEEPING_DIRS.has(entry.name)) continue;
      const child = join(nodeModules, entry.name);
      if (entry.name.startsWith('@')) {
        let scoped: ReturnType<typeof readdirSync>;
        try {
          scoped = readdirSync(child, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const pkg of scoped) {
          if (pkg.isDirectory() && dirHasPackageJson(join(child, pkg.name))) return false;
        }
        continue;
      }
      if (dirHasPackageJson(child)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Host Electron/npm env must not override a user app's `.npmrc` registry. */
export function stripInheritedNpmRegistryEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...env };
  for (const key of Object.keys(next)) {
    const lower = key.toLowerCase();
    if (!lower.startsWith('npm_config_')) continue;
    if (lower.includes('registry')) delete next[key];
  }
  return next;
}

export function parseNpmrcRegistry(contents: string): string | undefined {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^registry\s*=\s*(.+)$/i.exec(trimmed);
    if (!match) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (value) return value;
  }
  return undefined;
}

/** STO snpm (`@sto/snpm` / cnpm) install args. */
export function buildSnpmInstallArgs(registry?: string, packages: string[] = []): string[] {
  const args = ['install', ...packages];
  if (packages.length > 0) args.push('--save');
  if (registry) args.push(`--registry=${registry}`);
  return args;
}

export function isTransientNpmInstallFailure(message: string): boolean {
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket disconnected|TLS connection|network request to /i.test(
    message,
  );
}
