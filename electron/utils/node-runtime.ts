/**
 * Managed Node runtime for user app projects (capability: service-node-runtime).
 *
 * Mirrors the proven uv/Python provisioning pattern in `uv-setup.ts`:
 * download a pinned portable Node on first use into `~/.stoclaw/runtime/node/`,
 * verify against SHASUMS256.txt, extract to a temp dir and atomically rename.
 * System Node is intentionally never used so template/toolchain behavior is
 * fully predictable across user machines.
 */

import { net } from 'electron';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, readFile, rename, rm } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import {
  MANAGED_NODE_VERSION,
  buildDownloadPlan,
  nodeArchiveName,
  nodeBinRelativePaths,
  nodeDistName,
  parseShasums,
  type NodeArch,
  type NodeDownloadSource,
  type NodePlatform,
} from './node-runtime-info';
import { logger } from './logger';

/**
 * Company-internal mirror root hosting the nodejs.org/dist layout
 * (`v<ver>/<archive>` + `v<ver>/SHASUMS256.txt`). Empty until infra
 * publishes the files; npmmirror is used as the first source meanwhile.
 * Overridable via env for testing/rollout.
 */
const INTERNAL_NODE_MIRROR_BASE = process.env.STOCLAW_NODE_MIRROR_BASE ?? '';

export type NodeRuntimeState = 'ready' | 'not-installed' | 'downloading' | 'extracting' | 'error';

export interface NodeRuntimeStatus {
  state: NodeRuntimeState;
  version: string;
  receivedBytes: number;
  totalBytes: number;
  /** Present when state === 'error'. */
  error?: string;
  /** Download source label currently/last used. */
  source?: string;
}

const runtimeRoot = () => join(homedir(), '.stoclaw', 'runtime', 'node');
const installDir = () => join(runtimeRoot(), `v${MANAGED_NODE_VERSION}`);

let status: NodeRuntimeStatus = {
  state: 'not-installed',
  version: MANAGED_NODE_VERSION,
  receivedBytes: 0,
  totalBytes: 0,
};

let setupPromise: Promise<void> | null = null;

function currentPlatform(): NodePlatform {
  return process.platform as NodePlatform;
}

function currentArch(): NodeArch {
  return process.arch as NodeArch;
}

/** Absolute paths of the managed node/npm binaries (regardless of install state). */
export function getManagedNodePaths(): { rootDir: string; nodeBin: string; npmBin: string; binDir: string } {
  const rel = nodeBinRelativePaths(currentPlatform());
  const rootDir = installDir();
  return {
    rootDir,
    nodeBin: join(rootDir, rel.node),
    npmBin: join(rootDir, rel.npm),
    binDir: join(rootDir, rel.binDir),
  };
}

export function isNodeRuntimeReady(): boolean {
  return existsSync(getManagedNodePaths().nodeBin);
}

export function getNodeRuntimeStatus(): NodeRuntimeStatus {
  if (status.state !== 'downloading' && status.state !== 'extracting') {
    status = { ...status, state: isNodeRuntimeReady() ? 'ready' : status.state === 'error' ? 'error' : 'not-installed' };
  }
  return { ...status };
}

/**
 * Environment for spawning user-project commands with the managed runtime:
 * managed bin dir prepended to PATH (child process only) and npm cache
 * consolidated under ~/.stoclaw so user defaults stay untouched.
 */
export function getNodeSpawnEnv(
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const { binDir } = getManagedNodePaths();
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const existing = baseEnv[pathKey] ?? baseEnv.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  return {
    ...baseEnv,
    [pathKey]: existing ? `${binDir}${sep}${existing}` : binDir,
    npm_config_cache: join(homedir(), '.stoclaw', 'npm-cache'),
  };
}

/** Download `url` and return the body as a string (for small files like SHASUMS256.txt). */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on('response', (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        response.on('data', () => undefined); // drain
        reject(new Error(`HTTP ${statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', (err: Error) => reject(err));
    });
    request.on('error', reject);
    request.end();
  });
}

/** Stream `url` to `destPath`, updating download progress on the module status. */
function downloadToFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on('response', (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        response.on('data', () => undefined); // drain
        reject(new Error(`HTTP ${statusCode} for ${url}`));
        return;
      }
      const totalHeader = response.headers['content-length'];
      const totalRaw = Array.isArray(totalHeader) ? totalHeader[0] : totalHeader;
      status.totalBytes = Number(totalRaw) || 0;
      status.receivedBytes = 0;

      const file = createWriteStream(destPath);
      response.on('data', (chunk) => {
        status.receivedBytes += chunk.length;
        file.write(chunk);
      });
      response.on('end', () => file.end(() => resolve()));
      response.on('error', (err: Error) => {
        file.destroy();
        reject(err);
      });
      file.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

/** Extract with the system tar (bsdtar on Win10+ also handles .zip). */
function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xf', archivePath, '-C', destDir], { windowsHide: true });
    const stderr: string[] = [];
    child.stderr?.on('data', (d) => stderr.push(String(d)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}: ${stderr.join('').trim()}`));
    });
    child.on('error', reject);
  });
}

async function installFromSource(source: NodeDownloadSource, tmpDir: string): Promise<void> {
  const platform = currentPlatform();
  const arch = currentArch();
  const archiveName = nodeArchiveName(MANAGED_NODE_VERSION, platform, arch);
  const archivePath = join(tmpDir, archiveName);

  status = { ...status, state: 'downloading', source: source.label, error: undefined };
  logger.info(`[node-runtime] downloading ${source.archiveUrl}`);
  await downloadToFile(source.archiveUrl, archivePath);

  const shasumsText = await fetchText(source.shasumsUrl);
  const expected = parseShasums(shasumsText, archiveName);
  if (!expected) {
    throw new Error(`SHASUMS256.txt from ${source.label} has no entry for ${archiveName}`);
  }
  const actual = await sha256OfFile(archivePath);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${archiveName} from ${source.label} (expected ${expected}, got ${actual})`);
  }

  status = { ...status, state: 'extracting' };
  const extractDir = join(tmpDir, 'extract');
  await mkdir(extractDir, { recursive: true });
  await extractArchive(archivePath, extractDir);

  const extractedRoot = join(extractDir, nodeDistName(MANAGED_NODE_VERSION, platform, arch));
  if (!existsSync(extractedRoot)) {
    throw new Error(`extracted archive missing expected root directory ${extractedRoot}`);
  }

  await mkdir(runtimeRoot(), { recursive: true });
  // Atomic move into the final location; a concurrent success is fine.
  try {
    await rename(extractedRoot, installDir());
  } catch (err) {
    if (!isNodeRuntimeReady()) throw err;
  }
}

async function performSetup(): Promise<void> {
  const plan = buildDownloadPlan(
    MANAGED_NODE_VERSION,
    currentPlatform(),
    currentArch(),
    INTERNAL_NODE_MIRROR_BASE,
  );

  const tmpDir = join(runtimeRoot(), `.tmp-${process.pid}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    let lastError: unknown = null;
    for (const source of plan) {
      try {
        await installFromSource(source, tmpDir);
        status = { ...status, state: 'ready', error: undefined };
        logger.info(`[node-runtime] managed Node ${MANAGED_NODE_VERSION} installed via ${source.label}`);
        return;
      } catch (err) {
        lastError = err;
        logger.warn(`[node-runtime] source ${source.label} failed:`, err);
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    status = { ...status, state: 'error', error: message };
    throw new Error(`managed Node setup failed after all sources: ${message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Ensure the managed Node runtime is installed. Concurrent callers join the
 * same in-flight setup (single-flight, same pattern as setupManagedPython).
 */
export async function setupManagedNode(): Promise<void> {
  if (isNodeRuntimeReady()) {
    status = { ...status, state: 'ready' };
    return;
  }
  if (setupPromise) {
    logger.info('[node-runtime] setup already in progress; joining existing run');
    return setupPromise;
  }
  setupPromise = (async () => {
    if (isNodeRuntimeReady()) {
      status = { ...status, state: 'ready' };
      return;
    }
    await performSetup();
  })().finally(() => {
    setupPromise = null;
  });
  return setupPromise;
}
