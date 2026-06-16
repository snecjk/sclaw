import { constants } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { listClaudePluginExtensions, type EngineExtensionDefinition } from './engine-extension-registry';
import { logger } from '../utils/logger';
import { getClaudePluginsDir } from '../utils/paths';

const BRIDGE_MARKER_FILE = '.stoclaw-claude-plugin-bridge.json';
const BRIDGE_MARKER_SOURCE = 'stoclaw-claude-plugins';

type BridgeMarker = {
  source?: string;
  pluginId?: string;
  extensionId?: string;
  sourceDir?: string;
  syncedAt?: string;
  contentHash?: string;
};

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readBridgeMarkerPayload(targetDir: string): Promise<BridgeMarker | null> {
  const markerPath = join(targetDir, BRIDGE_MARKER_FILE);
  if (!(await fileExists(markerPath))) return null;

  try {
    const raw = await readFile(markerPath, 'utf-8');
    return JSON.parse(raw) as BridgeMarker;
  } catch (error) {
    logger.warn(`Failed to read Claude plugin bridge marker: ${markerPath}`, error);
    return null;
  }
}

async function writeBridgeMarker(targetDir: string, payload: BridgeMarker): Promise<void> {
  await writeFile(join(targetDir, BRIDGE_MARKER_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function buildDirectorySnapshot(rootDir: string): Promise<string[]> {
  const snapshot: string[] = [];

  async function walk(currentDir: string, relativeDir = ''): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === BRIDGE_MARKER_FILE) continue;

      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        snapshot.push(`dir:${relativePath}`);
        await walk(fullPath, relativePath);
        continue;
      }

      const entryStat = await stat(fullPath);
      if (entry.isFile()) {
        snapshot.push(`file:${relativePath}:${entryStat.size}:${entryStat.mtimeMs}`);
        continue;
      }

      snapshot.push(`other:${relativePath}:${entryStat.size}:${entryStat.mtimeMs}`);
    }
  }

  await walk(rootDir);
  return snapshot;
}

async function hashDirectory(rootDir: string): Promise<string> {
  const snapshot = await buildDirectorySnapshot(rootDir);
  const digest = createHash('sha1');

  for (const line of snapshot) {
    digest.update(line);
    digest.update('\n');
  }

  for (const line of snapshot) {
    if (!line.startsWith('file:')) continue;
    const relativePath = line.slice('file:'.length).split(':', 1)[0];
    const content = await readFile(join(rootDir, relativePath));
    digest.update(content);
    digest.update('\n');
  }

  return digest.digest('hex');
}

function getClaudePluginSourceDir(extension: EngineExtensionDefinition): string | null {
  return extension.supports.claudePlugin?.sourceDir ?? null;
}

async function hasClaudePluginManifest(sourceDir: string): Promise<boolean> {
  return fileExists(join(sourceDir, '.claude-plugin', 'plugin.json'));
}

export async function syncClaudePlugins(): Promise<{ mirrored: string[]; skippedConflicts: string[] }> {
  const targetRoot = getClaudePluginsDir();
  await mkdir(targetRoot, { recursive: true });

  const mirrored: string[] = [];
  const skippedConflicts: string[] = [];
  const desired = new Map<string, EngineExtensionDefinition>();

  for (const extension of listClaudePluginExtensions()) {
    const sourceDir = getClaudePluginSourceDir(extension);
    const pluginId = extension.supports.claudePlugin?.pluginId;
    if (!sourceDir || !pluginId) continue;
    if (!(await fileExists(sourceDir))) continue;
    if (!(await hasClaudePluginManifest(sourceDir))) continue;
    desired.set(pluginId, extension);
  }

  for (const [pluginId, extension] of desired) {
    const sourceDir = extension.supports.claudePlugin!.sourceDir;
    const targetDir = join(targetRoot, pluginId);
    const targetExists = await fileExists(targetDir);
    const marker = targetExists ? await readBridgeMarkerPayload(targetDir) : null;

    if (targetExists && marker?.source !== BRIDGE_MARKER_SOURCE) {
      skippedConflicts.push(pluginId);
      logger.warn(`Skipping Claude plugin bridge for ${pluginId}: target exists and is not bridge-managed`, { targetDir });
      continue;
    }

    const sourceHash = await hashDirectory(sourceDir);
    const isInSync = Boolean(
      marker
      && marker.source === BRIDGE_MARKER_SOURCE
      && marker.pluginId === pluginId
      && marker.extensionId === extension.id
      && marker.sourceDir === sourceDir
      && marker.contentHash === sourceHash,
    );

    if (targetExists && !isInSync) {
      await rm(targetDir, { recursive: true, force: true });
    }

    if (!targetExists || !isInSync) {
      await cp(sourceDir, targetDir, { recursive: true, force: true });
      await writeBridgeMarker(targetDir, {
        source: BRIDGE_MARKER_SOURCE,
        pluginId,
        extensionId: extension.id,
        sourceDir,
        contentHash: sourceHash,
        syncedAt: new Date().toISOString(),
      });
      mirrored.push(pluginId);
    }
  }

  let targetEntries: Array<import('node:fs').Dirent>;
  try {
    targetEntries = await readdir(targetRoot, { withFileTypes: true });
  } catch {
    targetEntries = [];
  }

  for (const entry of targetEntries) {
    if (!entry.isDirectory()) continue;
    const targetDir = join(targetRoot, entry.name);
    const marker = await readBridgeMarkerPayload(targetDir);
    if (marker?.source !== BRIDGE_MARKER_SOURCE) continue;
    if (desired.has(entry.name)) continue;
    await rm(targetDir, { recursive: true, force: true });
  }

  return { mirrored, skippedConflicts };
}

export async function listClaudeBridgePluginPaths(): Promise<string[]> {
  await syncClaudePlugins().catch((error) => {
    logger.warn('Failed to sync Claude plugins before listing:', error);
  });

  const targetRoot = getClaudePluginsDir();
  if (!(await fileExists(targetRoot))) return [];

  const results: string[] = [];
  for (const extension of listClaudePluginExtensions()) {
    const pluginId = extension.supports.claudePlugin?.pluginId;
    if (!pluginId) continue;
    const pluginDir = join(targetRoot, pluginId);
    if (await fileExists(pluginDir)) {
      results.push(pluginDir);
    }
  }

  return results;
}
