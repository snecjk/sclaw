/**
 * Pure helpers for the managed Node runtime (no Electron dependencies).
 *
 * SClaw provisions a pinned portable Node runtime for user app projects
 * (see openspec/changes/app-dev-workbench-mvp, capability service-node-runtime).
 * Download sources are ordered: internal mirror (when configured) -> npmmirror -> nodejs.org.
 */

/** Pinned Node LTS version used for all user app projects. */
export const MANAGED_NODE_VERSION = '22.14.0';

export type NodePlatform = 'darwin' | 'win32' | 'linux';
export type NodeArch = 'x64' | 'arm64';

export interface NodeDownloadSource {
  /** Short label for logging, e.g. 'internal' | 'npmmirror' | 'official'. */
  label: string;
  /** Full URL of the portable archive. */
  archiveUrl: string;
  /** Full URL of the SHASUMS256.txt published next to the archive. */
  shasumsUrl: string;
}

const NPMMIRROR_BASE = 'https://registry.npmmirror.com/-/binary/node';
const OFFICIAL_BASE = 'https://nodejs.org/dist';

function distPlatform(platform: NodePlatform): string {
  return platform === 'win32' ? 'win' : platform;
}

/** Directory name at the root of the official archive, e.g. node-v22.14.0-darwin-arm64 */
export function nodeDistName(
  version: string,
  platform: NodePlatform,
  arch: NodeArch,
): string {
  return `node-v${version}-${distPlatform(platform)}-${arch}`;
}

/** Archive file name, e.g. node-v22.14.0-win-x64.zip / node-v22.14.0-darwin-arm64.tar.gz */
export function nodeArchiveName(
  version: string,
  platform: NodePlatform,
  arch: NodeArch,
): string {
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  return `${nodeDistName(version, platform, arch)}.${ext}`;
}

function sourceFromBase(label: string, baseUrl: string, version: string, archiveName: string): NodeDownloadSource {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    label,
    archiveUrl: `${base}/v${version}/${archiveName}`,
    shasumsUrl: `${base}/v${version}/SHASUMS256.txt`,
  };
}

/**
 * Ordered download plan. `internalBaseUrl` is the optional company-internal
 * mirror root that hosts the same layout as nodejs.org/dist (v<ver>/<archive>).
 */
export function buildDownloadPlan(
  version: string,
  platform: NodePlatform,
  arch: NodeArch,
  internalBaseUrl?: string,
): NodeDownloadSource[] {
  const archiveName = nodeArchiveName(version, platform, arch);
  const plan: NodeDownloadSource[] = [];
  if (internalBaseUrl && internalBaseUrl.trim()) {
    plan.push(sourceFromBase('internal', internalBaseUrl.trim(), version, archiveName));
  }
  plan.push(sourceFromBase('npmmirror', NPMMIRROR_BASE, version, archiveName));
  plan.push(sourceFromBase('official', OFFICIAL_BASE, version, archiveName));
  return plan;
}

/**
 * Parse a SHASUMS256.txt body and return the lowercase hex digest for the
 * given file name, or null when absent. Format: `<sha256>  <filename>` per line.
 */
export function parseShasums(shasumsText: string, fileName: string): string | null {
  for (const rawLine of shasumsText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!match) continue;
    if (match[2].trim() === fileName) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

/** Relative paths (from the installed runtime root) of the node/npm binaries. */
export function nodeBinRelativePaths(platform: NodePlatform): { node: string; npm: string; binDir: string } {
  if (platform === 'win32') {
    return { node: 'node.exe', npm: 'npm.cmd', binDir: '.' };
  }
  return { node: 'bin/node', npm: 'bin/npm', binDir: 'bin' };
}
