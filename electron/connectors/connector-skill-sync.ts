/**
 * Sync connector detail skills: project to engine dirs when connected; remove when not.
 * Skills live under ~/.stoclaw/connectors/skills/{slug}/ (cache) and only project when connected.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { connectorSkillSlug } from '../../shared/connectors/resolve-agent-skill';
import type { ConnectorDescriptor } from '../../shared/connectors/types';
import { getClaudeSkillsDir, getOpenClawSkillsDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { listConnectedConnectorIds } from './state-store';

function connectorsRoot(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

export function getConnectorSkillsCacheDir(): string {
  return join(connectorsRoot(), 'skills');
}

function engineSkillDirs(slug: string): string[] {
  return [
    join(getOpenClawSkillsDir(), slug),
    join(getClaudeSkillsDir(), slug),
  ];
}

/** Remove skill projection from OpenClaw / Claude skill scan paths. */
export function removeSkillFromEngineDirs(slug: string): void {
  for (const dir of engineSkillDirs(slug)) {
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        `[connectors] remove skill projection ${dir} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/** Copy skill tree into engine scan paths. */
export function projectSkillToEngineDirs(slug: string, sourceDir: string): void {
  if (!existsSync(join(sourceDir, 'SKILL.md'))) {
    logger.warn(`[connectors] skip skill projection: SKILL.md missing in ${sourceDir}`);
    return;
  }
  for (const target of engineSkillDirs(slug)) {
    mkdirSync(join(target, '..'), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync(sourceDir, target, { recursive: true });
  }
}

function resolveSkillSourceDir(slug: string): string | null {
  const cacheDir = join(getConnectorSkillsCacheDir(), slug);
  if (existsSync(join(cacheDir, 'SKILL.md'))) return cacheDir;
  const openclawDir = join(getOpenClawSkillsDir(), slug);
  if (existsSync(join(openclawDir, 'SKILL.md'))) {
    try {
      mkdirSync(getConnectorSkillsCacheDir(), { recursive: true });
      rmSync(cacheDir, { recursive: true, force: true });
      cpSync(openclawDir, cacheDir, { recursive: true });
      return cacheDir;
    } catch {
      return openclawDir;
    }
  }
  return null;
}

/** After connect: project skill from connector cache to engine scan paths. */
export function projectConnectorSkillFromCache(slug: string): void {
  const cacheDir = join(getConnectorSkillsCacheDir(), slug);
  if (!existsSync(join(cacheDir, 'SKILL.md'))) return;
  projectSkillToEngineDirs(slug, cacheDir);
}

/** After connect / runtime install: cache skill then project if connected. */
export function cacheAndProjectConnectorSkill(slug: string, installedDir?: string): void {
  const source = installedDir && existsSync(join(installedDir, 'SKILL.md'))
    ? installedDir
    : resolveSkillSourceDir(slug);
  if (!source) return;
  const cacheDir = join(getConnectorSkillsCacheDir(), slug);
  try {
    mkdirSync(getConnectorSkillsCacheDir(), { recursive: true });
    rmSync(cacheDir, { recursive: true, force: true });
    cpSync(source, cacheDir, { recursive: true });
    projectSkillToEngineDirs(slug, cacheDir);
  } catch (error) {
    logger.warn(
      `[connectors] cache/project skill ${slug} failed:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Reconcile engine skill dirs with connected set.
 * Connected + has skill slug → project; otherwise remove from engine dirs.
 */
export function rebuildConnectorSkillProjections(catalog: ConnectorDescriptor[]): void {
  const connected = new Set(listConnectedConnectorIds());
  const slugByConnector = new Map<string, string>();
  const allSlugs = new Set<string>();

  for (const descriptor of catalog) {
    const slug = connectorSkillSlug(descriptor);
    if (!slug) continue;
    allSlugs.add(slug);
    slugByConnector.set(descriptor.id, slug);
  }

  for (const descriptor of catalog) {
    const slug = slugByConnector.get(descriptor.id);
    if (!slug) continue;
    if (connected.has(descriptor.id)) {
      const source = resolveSkillSourceDir(slug);
      if (source) {
        projectSkillToEngineDirs(slug, source);
      }
    } else {
      removeSkillFromEngineDirs(slug);
    }
  }

  const engineRoots = [getOpenClawSkillsDir(), getClaudeSkillsDir()];
  for (const root of engineRoots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!allSlugs.has(entry)) continue;
      const ownerConnected = catalog.some(
        (d) => connectorSkillSlug(d) === entry && connected.has(d.id),
      );
      if (!ownerConnected) {
        removeSkillFromEngineDirs(entry);
      }
    }
  }
}

/** On disconnect: drop engine projection (cache may remain for faster reconnect). */
export function unpublishConnectorSkill(descriptor: ConnectorDescriptor): void {
  const slug = connectorSkillSlug(descriptor);
  if (!slug) return;
  removeSkillFromEngineDirs(slug);
}
