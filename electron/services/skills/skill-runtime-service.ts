import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { SclawAgentEngine, SclawAgentSessionMode } from '../../../shared/agent-extensions';
import { logger } from '../../utils/logger';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import { listDesiredPackages, type DesiredSkillPackage } from './canonical-store';
import { computeSkillPackageHash } from './skill-package-hash';
import { skillRoutingRemoteService } from './skill-routing-remote-service';
import { markSkillLoaded, markSkillUsed } from './session-skill-state-service';

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 10;

export type SkillRuntimeErrorCode =
  | 'INVALID_REQUEST'
  | 'SKILL_NOT_FOUND'
  | 'RESOURCE_NOT_FOUND';

export class SkillRuntimeError extends Error {
  constructor(readonly code: SkillRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'SkillRuntimeError';
  }
}

export interface RuntimeSkillSearchItem {
  slug: string;
  name: string;
  description: string;
  score: number;
  reasons: string[];
  sourceHash: string;
  skillRoot: string;
  skillMdPath: string;
}

export interface RuntimeSkillSearchResult {
  query: string;
  items: RuntimeSkillSearchItem[];
  totalEnabled: number;
  degraded: boolean;
}

export async function recordRuntimeSkillRead(input: {
  sessionKey: string;
  runId?: string;
  agentId?: string;
  slug: string;
  sourceHash: string;
  requestedPath: string;
}): Promise<{ slug: string; recorded: true }> {
  if (!input.runId) throw new SkillRuntimeError('INVALID_REQUEST', 'runId is required');
  const slug = normalize(input.slug || '');
  const pkg = (await enabledCatalog(input.agentId)).find((item) => normalize(item.slug) === slug);
  if (!pkg) throw new SkillRuntimeError('SKILL_NOT_FOUND', `Enabled skill not found: ${slug}`);
  try {
    const [skillRoot, target, sourceHash] = await Promise.all([
      realpath(pkg.sourceDir),
      realpath(input.requestedPath),
      computeSkillPackageHash(pkg),
    ]);
    if (!isPathInsideSkillRoot(skillRoot, target) || sourceHash !== input.sourceHash) {
      throw new SkillRuntimeError('RESOURCE_NOT_FOUND', 'Skill candidate is stale or outside its package');
    }
    await markSkillLoaded(input.sessionKey, input.runId, {
      slug,
      sourceHash,
      state: 'loaded',
      score: 5_000_000,
      reasons: ['runtime-read'],
    });
    await markSkillUsed(input.sessionKey, input.runId, slug);
    return { slug, recorded: true };
  } catch (error) {
    if (error instanceof SkillRuntimeError) throw error;
    throw new SkillRuntimeError('RESOURCE_NOT_FOUND', error instanceof Error ? error.message : String(error));
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function queryTokens(value: string): string[] {
  const normalized = normalize(value);
  const ascii = normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? [];
  const cjk = [...normalized].filter((char) => (char.codePointAt(0) ?? 0) > 127 && !/\s/u.test(char));
  const bigrams = cjk.slice(0, -1).map((char, index) => `${char}${cjk[index + 1]}`);
  return [...new Set([...ascii, ...cjk, ...bigrams])];
}

export function scoreRuntimeSkill(query: string, pkg: DesiredSkillPackage): number {
  const normalizedQuery = normalize(query);
  const slug = normalize(pkg.slug);
  const name = normalize(pkg.name || pkg.slug);
  const description = normalize(pkg.description || '');
  const searchable = `${slug} ${name} ${description}`;
  let score = 0;
  if (normalizedQuery === slug || normalizedQuery === name) score += 1_000;
  else {
    if (normalizedQuery.includes(slug)) score += 150;
    if (name && normalizedQuery.includes(name)) score += 120;
  }
  for (const token of queryTokens(query)) {
    if (token.length > 1 && searchable.includes(token)) score += 5;
  }
  return score;
}

async function enabledCatalog(agentId?: string): Promise<DesiredSkillPackage[]> {
  const userCode = await getCurrentActiveUserCode();
  return (await listDesiredPackages({ userCode, agentId })).filter((pkg) => pkg.enabled);
}

export async function searchRuntimeSkills(input: {
  query: string;
  engine: SclawAgentEngine;
  mode: SclawAgentSessionMode;
  agentId?: string;
  limit?: number;
}): Promise<RuntimeSkillSearchResult> {
  const query = input.query?.trim();
  if (!query) throw new SkillRuntimeError('INVALID_REQUEST', 'query is required');
  const limit = Math.min(Math.max(Math.floor(input.limit ?? DEFAULT_SEARCH_LIMIT), 1), MAX_SEARCH_LIMIT);
  const catalog = await enabledCatalog(input.agentId);
  const bySlug = new Map(catalog.map((pkg) => [normalize(pkg.slug), pkg]));
  const scored = new Map<string, { score: number; reasons: string[] }>();
  for (const pkg of catalog) {
    const score = scoreRuntimeSkill(query, pkg);
    if (score > 0) scored.set(normalize(pkg.slug), { score, reasons: ['local-catalog'] });
  }

  let degraded: boolean;
  try {
    const remote = await skillRoutingRemoteService.search({
      query,
      engine: input.engine,
      mode: input.mode,
      agentId: input.agentId,
      candidateK: Math.max(limit * 4, 20),
      topK: Math.max(limit * 2, 10),
    });
    degraded = Boolean(remote.degraded);
    for (const item of remote.items ?? []) {
      const slug = normalize(item.slug);
      if (!bySlug.has(slug)) continue;
      const existing = scored.get(slug);
      scored.set(slug, {
        score: Math.max(existing?.score ?? 0, 10_000 + item.score * 100),
        reasons: [...new Set([...(existing?.reasons ?? []), ...(item.reasons ?? []), 'remote-hybrid'])],
      });
    }
  } catch (error) {
    degraded = true;
    logger.warn('[skill-runtime] remote search unavailable; using local catalog', {
      engine: input.engine,
      agentId: input.agentId,
      error: String(error),
    });
  }

  const matches = [...scored]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, limit);
  const items = (await Promise.all(matches.map(async ([slug, match]) => {
      const pkg = bySlug.get(slug)!;
      try {
        const skillRoot = await realpath(pkg.sourceDir);
        const skillMdPath = await realpath(join(skillRoot, 'SKILL.md'));
        const info = await stat(skillMdPath);
        if (!info.isFile() || !isPathInsideSkillRoot(skillRoot, skillMdPath)) return undefined;
        const sourceHash = await computeSkillPackageHash(pkg);
        return {
          slug,
          name: pkg.name || pkg.slug,
          description: pkg.description || '',
          score: match.score,
          reasons: match.reasons,
          sourceHash,
          skillRoot,
          skillMdPath,
        };
      } catch {
        return undefined;
      }
    }))).filter((item): item is RuntimeSkillSearchItem => Boolean(item));
  logger.info('[skill-runtime] search completed', {
    engine: input.engine,
    agentId: input.agentId,
    totalEnabled: catalog.length,
    resultCount: items.length,
    degraded,
  });
  return { query, items, totalEnabled: catalog.length, degraded };
}

export function isPathInsideSkillRoot(root: string, candidate: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const child = relative(normalizedRoot, normalizedCandidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}
