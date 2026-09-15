import { createHash } from 'node:crypto';
import { parseSkillTranscriptMarkers } from '../../../shared/skill-transcript-marker';
import type { SclawAgentEngine, SclawAgentSessionMode } from '../../../shared/agent-extensions/types';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import { logger } from '../../utils/logger';
import { getSetting } from '../../utils/store';
import { listDesiredPackages, type DesiredSkillPackage } from './canonical-store';
import {
  beginSkillTurn,
  getSessionSkillState,
  reconcileSessionSkillState,
} from './session-skill-state-service';
import { orderSessionSkillLeases, type SelectedSkillInput } from './session-skill-state';
import { skillRoutingRemoteService } from './skill-routing-remote-service';
import { computeSkillPackageHash } from './skill-package-hash';
import { getDefaultEngineSkillSlugs } from './default-engine-skills';
import { isAppDevSessionKey } from '../../../shared/app-dev-session';

const INTERACTIVE_LIMIT = 6;
const SCHEDULED_LIMIT = 4;
const PINNED_LIMIT = 4;
const ROUTE_REFRESH_TURNS = 5;
const ROUTING_CARD_SYNC_BATCH_SIZE = 10;
const TOPIC_CHANGE_RE = /(?:换个问题|另一个问题|另外(?:一件事|一个)|现在(?:帮我|处理|检查)|unrelated|new topic)/i;
const FOLLOW_UP_RE = /(?:继续|再加|再改|按刚才|这个也|然后|颜色换|同样|基于上面|接着|also|continue|same way|then)/i;
const syncedCatalogRevisions = new Map<string, string>();

export interface RoutedSessionSkill {
  slug: string;
  sourceHash: string;
  sourceDir: string;
  score: number;
  reasons: string[];
}

export interface SessionSkillRouteDecision {
  selected: RoutedSessionSkill[];
  skillSetHash: string;
  manifestRevision: string;
  remoteSearched: boolean;
  degraded: boolean;
  topicChanged: boolean;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokens(value: string): string[] {
  const normalized = normalize(value);
  const ascii = normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? [];
  const cjk = [...normalized].filter((char) => (char.codePointAt(0) ?? 0) > 127 && !/\s/u.test(char));
  const cjkBigrams = cjk.map((char, index) => `${char}${cjk[index + 1] ?? ''}`).filter((item) => item.length > 1);
  return [...new Set([...ascii, ...cjk, ...cjkBigrams])];
}

function fileExtensions(names: string[]): string[] {
  return [...new Set(names.map((name) => {
    const match = name.toLowerCase().match(/\.[a-z0-9]{1,10}$/);
    return match?.[0];
  }).filter((value): value is string => Boolean(value)))];
}

function localScore(query: string, pkg: DesiredSkillPackage, extensions: string[]): number {
  const name = normalize(pkg.name || pkg.slug);
  const description = normalize(pkg.description || '');
  const searchable = `${normalize(pkg.slug)} ${name} ${description}`;
  let score = 0;
  if (normalize(query).includes(normalize(pkg.slug))) score += 100;
  if (name && normalize(query).includes(name)) score += 80;
  for (const token of tokens(query)) {
    if (token.length > 1 && searchable.includes(token)) score += 2;
  }
  for (const extension of extensions) {
    if (searchable.includes(extension) || searchable.includes(extension.slice(1))) score += 20;
  }
  return score;
}

function taskFingerprint(query: string, extensions: string[]): string {
  return createHash('sha256').update(`${tokens(query).sort().join('|')}|${extensions.sort().join('|')}`).digest('hex');
}

export async function routeSessionSkills(input: {
  sessionKey: string;
  runId: string;
  agentId: string;
  engine: SclawAgentEngine;
  mode: SclawAgentSessionMode;
  query: string;
  rawMessage?: string;
  attachmentNames?: string[];
  explicitSlugs?: string[];
  onProgress?: (message: string) => void;
}): Promise<SessionSkillRouteDecision> {
  const skillDiscoveryEnabled = await getSetting('skillDiscoveryEnabled');
  if (skillDiscoveryEnabled) input.onProgress?.('正在匹配技能…');
  const userCode = await getCurrentActiveUserCode();
  const desired = (await listDesiredPackages({ userCode, agentId: input.agentId })).filter((pkg) => pkg.enabled);
  const packageHashes = new Map<string, string>();
  await Promise.all(desired.map(async (pkg) => packageHashes.set(pkg.slug, await computeSkillPackageHash(pkg))));
  const packageBySlug = new Map(desired.map((pkg) => [normalize(pkg.slug), pkg]));
  const manifestRevision = createHash('sha256')
    .update([...packageHashes]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([slug, hash]) => {
        const pkg = packageBySlug.get(normalize(slug));
        return `${slug}@${hash}\n${pkg?.name ?? ''}\n${pkg?.description ?? ''}`;
      })
      .join('\n'))
    .digest('hex');
  if (isAppDevSessionKey(input.sessionKey)) {
    // 建站会话只改当前应用源码/预览，不注入主会话业务技能（sai-cli、派费、报价等）。
    await beginSkillTurn({
      sessionKey: input.sessionKey,
      runId: input.runId,
      manifestRevision,
      query: input.query,
      selected: [],
      remoteSearched: false,
    });
    if (skillDiscoveryEnabled) {
      input.onProgress?.('未匹配到相关技能，正在直接处理…');
    }
    logger.debug('[skill-router] skip catalog routing for app-dev session', {
      sessionKey: input.sessionKey,
      engine: input.engine,
    });
    return {
      selected: [],
      skillSetHash: createHash('sha256').update('').digest('hex'),
      manifestRevision,
      remoteSearched: false,
      degraded: false,
      topicChanged: false,
    };
  }
  if (!skillDiscoveryEnabled) {
    const selected = desired.map((pkg) => ({
      slug: normalize(pkg.slug),
      sourceHash: packageHashes.get(pkg.slug) ?? '',
      sourceDir: pkg.sourceDir,
      score: 0,
      reasons: ['skill-discovery-disabled'],
    }));
    const skillSetHash = createHash('sha256')
      .update(selected.map((item) => `${item.slug}@${item.sourceHash}`).sort().join('\n'))
      .digest('hex');
    logger.debug('[skill-router] Skill discovery disabled; loading all enabled Skills', {
      sessionKey: input.sessionKey,
      engine: input.engine,
      skillCount: selected.length,
    });
    // Keep a lightweight pending turn so an on-demand load can attach and be
    // promoted even when automatic pre-turn discovery is disabled.
    await beginSkillTurn({
      sessionKey: input.sessionKey,
      runId: input.runId,
      manifestRevision,
      query: input.query,
      selected: [],
      remoteSearched: false,
    });
    return {
      selected,
      skillSetHash,
      manifestRevision,
      remoteSearched: false,
      degraded: false,
      topicChanged: false,
    };
  }
  const validSkills = new Map([...packageHashes].map(([slug, hash]) => [normalize(slug), hash]));
  await reconcileSessionSkillState(input.sessionKey, validSkills);
  const previous = await getSessionSkillState(input.sessionKey);
  const extensions = fileExtensions(input.attachmentNames ?? []);
  const markerSlugs = parseSkillTranscriptMarkers(input.rawMessage ?? '').map((item) => item.slug);
  const commandSlugs = [...(input.rawMessage ?? '').matchAll(/(?:^|\s)\/skill:([a-z0-9._-]+)/gi)].map((match) => match[1]);
  const explicitSlugs = [...new Set([...(input.explicitSlugs ?? []), ...markerSlugs, ...commandSlugs].map(normalize).filter(Boolean))];
  const builtinPinnedSlugs = getDefaultEngineSkillSlugs({ engine: input.engine, mode: input.mode })
    .map(normalize)
    .filter((slug) => validSkills.has(slug));
  const configuredPinned = desired.filter((pkg) => pkg.scope === 'agent');
  if (configuredPinned.length > PINNED_LIMIT) {
    logger.warn('[skill-router] agent pinned Skill limit exceeded', {
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      configured: configuredPinned.length,
      limit: PINNED_LIMIT,
    });
  }
  const pinnedSlugs = configuredPinned.slice(0, PINNED_LIMIT).map((pkg) => normalize(pkg.slug));
  const active = orderSessionSkillLeases(previous.skills).filter((lease) => validSkills.has(lease.slug));
  const reusableActive = active.filter((lease) => !lease.reasons.includes('builtin-pinned'));
  const topicChangedByText = TOPIC_CHANGE_RE.test(input.query);
  const confirmedFollowUp = FOLLOW_UP_RE.test(input.query) && extensions.length === 0 && explicitSlugs.length === 0;
  const manifestChanged = previous.manifestRevision !== manifestRevision;
  const catalogKey = `${userCode ?? ''}:${input.agentId}`;
  if (syncedCatalogRevisions.get(catalogKey) !== manifestRevision) {
    try {
      for (let index = 0; index < desired.length; index += ROUTING_CARD_SYNC_BATCH_SIZE) {
        const batch = desired.slice(index, index + ROUTING_CARD_SYNC_BATCH_SIZE).map((pkg) => ({
          slug: normalize(pkg.slug),
          sourceHash: packageHashes.get(pkg.slug) ?? '',
          name: pkg.name,
          description: pkg.description,
          engines: ['claude', 'pi'] as Array<'claude' | 'pi'>,
          modes: ['interactive', 'scheduled'] as Array<'interactive' | 'scheduled'>,
          agentIds: pkg.scope === 'agent' ? [input.agentId] : [],
          enabled: pkg.enabled,
        }));
        await skillRoutingRemoteService.upsertCards(batch);
      }
      syncedCatalogRevisions.set(catalogKey, manifestRevision);
    } catch (error) {
      logger.warn('[skill-router] routing-card sync unavailable; continuing with local catalog', {
        sessionKey: input.sessionKey,
        agentId: input.agentId,
        error: String(error),
      });
    }
  }
  const refreshDue = previous.lastRemoteRouteTurn === undefined
    || previous.turnNo + 1 - previous.lastRemoteRouteTurn >= ROUTE_REFRESH_TURNS;
  const explicitIsNew = explicitSlugs.some((slug) => !active.some((lease) => lease.slug === slug));
  const shouldSearchRemote = previous.turnNo === 0
    || reusableActive.length === 0
    || manifestChanged
    || refreshDue
    || explicitIsNew
    || topicChangedByText
    || !confirmedFollowUp;

  let remoteItems: Array<{ slug: string; score: number; sourceHash?: string; reasons?: string[] }> = [];
  let degraded = false;
  let remoteSearchFailed = false;
  if (shouldSearchRemote) {
    try {
      const response = await skillRoutingRemoteService.search({
        query: input.query,
        engine: input.engine,
        agentId: input.agentId,
        mode: input.mode,
        candidateK: 30,
        topK: 15,
      });
      remoteItems = response.items ?? [];
      logger.debug('[skill-router] remote search results', remoteItems);
      degraded = Boolean(response.degraded);
    } catch (error) {
      degraded = true;
      remoteSearchFailed = true;
      logger.warn('[skill-router] remote search unavailable; using local candidates', {
        sessionKey: input.sessionKey,
        engine: input.engine,
        error: String(error),
      });
    }
  }

  const previousActiveSlugs = new Set(active.filter((lease) => lease.state !== 'pinned').map((lease) => lease.slug));
  const recalledSlugs = new Set(remoteItems.map((item) => normalize(item.slug)).filter((slug) => validSkills.has(slug)));
  const topicChangedByRecall = shouldSearchRemote
    && previousActiveSlugs.size > 0
    && recalledSlugs.size > 0
    && [...recalledSlugs].every((slug) => !previousActiveSlugs.has(slug));
  const topicChanged = topicChangedByText || topicChangedByRecall;
  const selectedBySlug = new Map<string, SelectedSkillInput>();
  const add = (slugValue: string, state: SelectedSkillInput['state'], score: number, reasons: string[]) => {
    const slug = normalize(slugValue);
    const hash = validSkills.get(slug);
    if (!hash || !packageBySlug.has(slug)) return;
    const existing = selectedBySlug.get(slug);
    if (existing && (existing.score ?? 0) >= score) {
      selectedBySlug.set(slug, {
        ...existing,
        state: existing.state === 'pinned' || state === 'pinned' ? 'pinned' : existing.state,
        reasons: [...new Set([...(existing.reasons ?? []), ...reasons])],
      });
      return;
    }
    selectedBySlug.set(slug, {
      slug,
      sourceHash: hash,
      state: existing?.state === 'pinned' || state === 'pinned' ? 'pinned' : state,
      score,
      reasons: [...new Set([...(existing?.reasons ?? []), ...reasons])],
    });
  };
  explicitSlugs.forEach((slug, index) => add(slug, 'selected', 5_000_000 - index, ['explicit']));
  builtinPinnedSlugs.forEach((slug, index) => add(slug, 'pinned', 4_500_000 - index, ['builtin-pinned']));
  pinnedSlugs.forEach((slug, index) => add(slug, 'pinned', 4_000_000 - index, ['agent-pinned']));
  if (!topicChanged) {
    active.filter((lease) => lease.state === 'used').forEach((lease) => add(
      lease.slug,
      'used',
      3_000_000 + (lease.lastUsedTurn ?? 0) * 100 + Math.min(Math.max(lease.score % 100, 0), 99),
      ['recently-used'],
    ));
  }
  remoteItems.forEach((item) => add(item.slug, 'selected', 2_000_000 + item.score * 1_000, item.reasons ?? ['remote-hybrid']));
  if (remoteSearchFailed) {
    desired
      .map((pkg) => ({ pkg, score: localScore(input.query, pkg, extensions) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .forEach(({ pkg, score }) => add(pkg.slug, 'selected', 1_000_000 + score, ['local-match']));
  }
  if (!topicChanged) {
    active.filter((lease) => lease.state === 'selected').forEach((lease) => add(
      lease.slug,
      'selected',
      100_000 + Math.min(Math.max(lease.score % 100_000, 0), 99_999),
      ['sticky-selected'],
    ));
  }

  const ordered = [...selectedBySlug.values()].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const limit = input.mode === 'scheduled' ? SCHEDULED_LIMIT : INTERACTIVE_LIMIT;
  if (explicitSlugs.length + pinnedSlugs.length > limit) {
    logger.warn('[skill-router] explicit and pinned Skills exceed active-set limit', {
      sessionKey: input.sessionKey,
      explicitCount: explicitSlugs.length,
      pinnedCount: pinnedSlugs.length,
      limit,
    });
  }
  let selectedInputs = ordered.slice(0, limit);
  if (topicChanged) {
    selectedInputs = selectedInputs.filter((item) => item.reasons?.some((reason) => (
      reason === 'explicit'
      || reason === 'builtin-pinned'
      || reason === 'agent-pinned'
      || reason === 'remote-hybrid'
      || reason === 'local-match'
    )));
  }
  const fingerprint = taskFingerprint(input.query, extensions);
  await beginSkillTurn({
    sessionKey: input.sessionKey,
    runId: input.runId,
    manifestRevision,
    query: input.query,
    taskFingerprint: fingerprint,
    selected: selectedInputs,
    remoteSearched: shouldSearchRemote && !degraded,
    topicChanged,
  });

  const selected = selectedInputs.flatMap((item) => {
    const pkg = packageBySlug.get(item.slug);
    return pkg ? [{
      slug: item.slug,
      sourceHash: item.sourceHash,
      sourceDir: pkg.sourceDir,
      score: item.score ?? 0,
      reasons: item.reasons ?? [],
    }] : [];
  });
  const skillSetHash = createHash('sha256')
    .update(selected.map((item) => `${item.slug}@${item.sourceHash}`).sort().join('\n'))
    .digest('hex');
  const matchedNames = selected.map((item) => packageBySlug.get(item.slug)?.name?.trim() || item.slug);
  input.onProgress?.(matchedNames.length > 0
    ? `已匹配技能：${matchedNames.join('、')}`
    : '未匹配到相关技能，正在直接处理…');
  return {
    selected,
    skillSetHash,
    manifestRevision,
    remoteSearched: shouldSearchRemote && !degraded,
    degraded,
    topicChanged,
  };
}
