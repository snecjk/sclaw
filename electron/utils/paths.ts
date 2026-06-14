/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { app } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { logger } from './logger';

export {
  quoteForCmd,
  needsWinShell,
  prepareWinSpawn,
  normalizeNodeRequirePathForNodeOptions,
  appendNodeRequireToNodeOptions,
} from './win-shell';

/**
 * Expand ~ to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

/**
 * Get OpenClaw config directory
 * Isolated under ~/.stoclaw/openclaw to avoid colliding with other OpenClaw installations.
 */
export function getOpenClawConfigDir(): string {
  return join(homedir(), '.stoclaw', 'openclaw');
}

/**
 * Get OpenClaw skills directory
 */
export function getOpenClawSkillsDir(): string {
  return join(getOpenClawConfigDir(), 'skills');
}

/**
 * Get agent-scoped skills directory
 * Used when a skill is installed from an Agent detail page,
 * scoping it to ~/.stoclaw/openclaw/agents/{agentId}/agent/skills/
 */
export function getOpenClawAgentSkillsDir(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'agent', 'skills');
}

// ── User-scoped skill workspace (for multi-account isolation) ──

// eslint-disable-next-line no-control-regex
const INVALID_PATH_CHARS = /[<>:"|?*\\/\x00-\x1f]/g;

function sanitizeUserCodeForPath(userCode: string): string {
  return userCode.replace(INVALID_PATH_CHARS, '_');
}

/**
 * Get the base directory for a user's isolated skill workspace.
 */
export function getOpenClawUserBaseDir(userCode: string): string {
  return join(getOpenClawConfigDir(), 'users', sanitizeUserCodeForPath(userCode));
}

/**
 * Get a user's isolated skills directory.
 */
export function getOpenClawUserSkillsDir(userCode: string): string {
  return join(getOpenClawUserBaseDir(userCode), 'skills');
}

/**
 * Get a user's isolated disabled-skills directory.
 */
export function getOpenClawUserDisabledDir(userCode: string): string {
  return join(getOpenClawUserBaseDir(userCode), 'skills-disabled');
}

/**
 * Get a user's isolated ClawHub lock directory.
 */
export function getOpenClawUserLockDir(userCode: string): string {
  return join(getOpenClawUserBaseDir(userCode), '.clawhub');
}

/**
 * Get a user's isolated ClawHub lock file path.
 */
export function getOpenClawUserLockPath(userCode: string): string {
  return join(getOpenClawUserLockDir(userCode), 'lock.json');
}

/**
 * Get StoClaw config directory
 */
export function getClawXConfigDir(): string {
  return join(homedir(), '.stoclaw');
}

/**
 * Get StoClaw-managed Claude config directory.
 */
export function getClaudeConfigDir(): string {
  return join(getClawXConfigDir(), '.claude');
}

/**
 * Get Claude skills directory managed by StoClaw.
 */
export function getClaudeSkillsDir(): string {
  return join(getClaudeConfigDir(), 'skills');
}

/**
 * Get Claude plugins directory managed by StoClaw.
 */
export function getClaudePluginsDir(): string {
  return join(getClaudeConfigDir(), 'plugins');
}

/**
 * Get StoClaw logs directory
 */
export function getLogsDir(): string {
  return join(app.getPath('userData'), 'logs');
}

/**
 * Get StoClaw data directory
 */
export function getDataDir(): string {
  return app.getPath('userData');
}

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get resources directory (for bundled assets)
 */
export function getResourcesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources');
  }
  return join(__dirname, '../../resources');
}

/**
 * Get preload script path
 */
export function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

const OPENCLAW_ASAR_NAME = 'openclaw.asar';
const OPENCLAW_PLUGINS_ASAR_NAME = 'openclaw-plugins.asar';

/**
 * Packaged OpenClaw ASAR path (undefined when not packaged or legacy layout).
 */
export function getOpenClawAsarPath(): string | null {
  if (!app.isPackaged) return null;
  const asarPath = join(process.resourcesPath, OPENCLAW_ASAR_NAME);
  return existsSync(asarPath) ? asarPath : null;
}

/**
 * Working directory for OpenClaw child processes (gateway, doctor, CLI).
 * ASAR archives cannot be used as process cwd — use resources root instead.
 */
export function getOpenClawProcessCwd(): string {
  if (!app.isPackaged) {
    return getOpenClawDir();
  }
  if (getOpenClawAsarPath()) {
    return process.resourcesPath;
  }
  return join(process.resourcesPath, 'openclaw');
}

/**
 * NODE_PATH entries for Gateway / doctor / plugin module resolution.
 * Includes openclaw runtime node_modules plus dev fallbacks for hoisted deps.
 */
export function getOpenClawNodeModulesPath(): string {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const paths: string[] = [];
  const openclawDir = getOpenClawDir();

  paths.push(join(openclawDir, 'node_modules'));

  if (!app.isPackaged) {
    const projectRoot = join(__dirname, '../..');
    paths.push(join(projectRoot, 'build/openclaw/node_modules'));
    paths.push(join(projectRoot, 'node_modules'));
  }

  const unique = [...new Set(paths.filter((entry) => existsSync(entry)))];
  return unique.join(delimiter);
}

/**
 * Candidate directories for bundled plugin mirrors in packaged builds.
 */
export function getBundledPluginSourceCandidates(pluginDirName: string): string[] {
  if (!app.isPackaged) {
    return [
      join(app.getAppPath(), 'build', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName),
      join(__dirname, '../../build/openclaw-plugins', pluginDirName),
    ];
  }

  const root = process.resourcesPath;
  const pluginsAsar = join(root, OPENCLAW_PLUGINS_ASAR_NAME);
  return [
    join(pluginsAsar, pluginDirName),
    join(`${pluginsAsar}.unpacked`, pluginDirName),
    join(root, 'openclaw-plugins', pluginDirName),
    join(root, 'app.asar.unpacked', 'openclaw-plugins', pluginDirName),
  ];
}

/**
 * Candidate directories for bundled Claude plugin mirrors in packaged builds.
 */
export function getBundledClaudePluginSourceCandidates(pluginDirName: string): string[] {
  if (!app.isPackaged) {
    return [
      join(app.getAppPath(), 'resources', 'claude-plugins', pluginDirName),
      join(process.cwd(), 'resources', 'claude-plugins', pluginDirName),
      join(__dirname, '../../resources/claude-plugins', pluginDirName),
    ];
  }

  const root = process.resourcesPath;
  return [
    join(root, 'resources', 'claude-plugins', pluginDirName),
    join(root, 'claude-plugins', pluginDirName),
    join(root, 'app.asar.unpacked', 'resources', 'claude-plugins', pluginDirName),
  ];
}

/**
 * Get OpenClaw package directory
 * - Production (packaged): resources/openclaw.asar (preferred) or legacy resources/openclaw/
 * - Development: node_modules/openclaw，若 pnpm 链接不完整则回退 build/openclaw（bundle-openclaw.mjs 产出）
 */
function isValidOpenClawPackageDir(dir: string): boolean {
  if (dir.endsWith('.asar')) {
    return existsSync(dir) && existsSync(join(dir, 'openclaw.mjs'));
  }
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'openclaw.mjs'));
}

export function getOpenClawDir(): string {
  if (app.isPackaged) {
    const asarPath = getOpenClawAsarPath();
    if (asarPath) return asarPath;
    return join(process.resourcesPath, 'openclaw');
  }

  const projectRoot = join(__dirname, '../..');
  const candidates = [
    join(projectRoot, 'node_modules/openclaw'),
    join(projectRoot, 'build/openclaw'),
  ];

  for (const dir of candidates) {
    if (isValidOpenClawPackageDir(dir)) {
      return dir;
    }
  }

  return candidates[0];
}

/**
 * Get OpenClaw package directory resolved to a real path.
 * Useful when consumers need deterministic module resolution under pnpm symlinks.
 */
export function getOpenClawResolvedDir(): string {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) {
    return dir;
  }
  if (dir.endsWith('.asar')) {
    return dir;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Get OpenClaw entry script path (openclaw.mjs)
 */
export function getOpenClawEntryPath(): string {
  return join(getOpenClawDir(), 'openclaw.mjs');
}

/**
 * Get ClawHub CLI entry script path (clawdhub.js)
 */
export function getClawHubCliEntryPath(): string {
  return join(app.getAppPath(), 'node_modules', 'clawhub', 'bin', 'clawdhub.js');
}

/**
 * Get ClawHub CLI binary path (node_modules/.bin)
 */
export function getClawHubCliBinPath(): string {
  const binName = process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub';
  return join(app.getAppPath(), 'node_modules', '.bin', binName);
}

/**
 * Check if OpenClaw package exists
 */
export function isOpenClawPresent(): boolean {
  const dir = getOpenClawDir();
  const pkgJsonPath = join(dir, 'package.json');
  return existsSync(dir) && existsSync(pkgJsonPath);
}

/**
 * Check if OpenClaw is built (has dist folder)
 * For the npm package, this should always be true since npm publishes the built dist.
 */
export function isOpenClawBuilt(): boolean {
  const dir = getOpenClawDir();
  const distDir = join(dir, 'dist');
  const hasDist = existsSync(distDir);
  return hasDist;
}

/**
 * Get OpenClaw status for environment check
 */
export interface OpenClawStatus {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
}

export function getOpenClawStatus(): OpenClawStatus {
  const dir = getOpenClawDir();
  let version: string | undefined;

  // Try to read version from package.json
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pkg.version;
    }
  } catch {
    // Ignore version read errors
  }

  const status: OpenClawStatus = {
    packageExists: isOpenClawPresent(),
    isBuilt: isOpenClawBuilt(),
    entryPath: getOpenClawEntryPath(),
    dir,
    version,
  };

  logger.info('OpenClaw status:', status);
  return status;
}
