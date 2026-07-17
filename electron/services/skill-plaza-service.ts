/**
 * Skill Plaza Service
 * Aggregates Python backend API calls with local filesystem state (installed / enabled)
 * to provide a unified data layer for the Skill Plaza UI.
 */
import fs from 'fs';
import path from 'path';
import { getOpenClawConfigDir, getOpenClawSkillsDir, getOpenClawUserSkillsDir, getOpenClawUserDisabledDir } from '../utils/paths';
import { getCurrentActiveUserCode } from './user-skill-workspace';
import { setSkillsEnabled, readPreinstalledManifestSlugs } from '../utils/skill-config';
import { getStoToken, getAuthState, isSiteUser } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import { fetchApolloConfigValue } from './sto-apollo-config-service';
import {
  isRemoteVersionNewer,
  resolveInstalledVersionForCompare,
} from '../utils/skill-version';
import { PREINSTALLED_MARKER_NAME, USER_UPLOAD_MARKER_NAME } from './sto-skill-service';
import { parseSkillFrontmatter, readSkillMdFrontmatter } from '../utils/skill-frontmatter';
import { pickNavCategoryFromApiSkill } from '../../shared/skill-plaza-category-resolve';
import { KeyedTtlCache, mapWithConcurrency } from './skill-plaza-cache';

// ---------------------------------------------------------------------------
// Auth-not-ready sentinel
// ---------------------------------------------------------------------------

/** Structured code surfaced to the renderer when the STO token is not ready. */
export const SKILL_PLAZA_AUTH_NOT_READY_CODE = 'AUTH_NOT_READY';

/**
 * Thrown when a plaza read is attempted before the STO token is available
 * (cold start / token still loading). The renderer treats this as a transient
 * "loading" state and retries, rather than rendering an unfiltered fallback.
 */
export class SkillPlazaAuthNotReadyError extends Error {
  readonly code = SKILL_PLAZA_AUTH_NOT_READY_CODE;
  constructor(message = 'STO token not ready') {
    super(message);
    this.name = 'SkillPlazaAuthNotReadyError';
  }
}

export function isSkillPlazaAuthNotReadyError(err: unknown): err is SkillPlazaAuthNotReadyError {
  return (
    err instanceof SkillPlazaAuthNotReadyError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === SKILL_PLAZA_AUTH_NOT_READY_CODE)
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillSummary {
  slug: string;
  title: string;
  description: string;
  category: string | null;
  categoryCode: string | null;
  categoryCodes?: string[];
  categoryNames?: string[];
  source: 'official' | 'mine';
  installed: boolean;
  enabled?: boolean;
  installCount?: number;
  useCount?: number;
  points: number | null;
  icon?: string;
  defaultPrompt: string;
  updatedAt?: string;
  version?: string;
  installedVersion?: string;
  updateAvailable?: boolean;
}

export interface SkillDetail extends SkillSummary {
  detail: {
    intro: string;
  };
}

export interface CategoryDef {
  slug: string;
  label: string;
  count?: number;
}

export interface PlazaListResult {
  skills: SkillSummary[];
  categoryCounts: Record<string, number>;
  hasMore: boolean;
  page: number;
  pageSize: number;
  total?: number;
}

export interface SkillPlazaListParams {
  q?: string;
  category?: string;
  source?: 'official' | 'mine';
  sort?: 'hot' | 'recent';
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Office category override constants
// ---------------------------------------------------------------------------

const OFFICE_SKILL_SLUGS = new Set(['pdf', 'xlsx', 'docx', 'pptx']);
const OFFICE_CATEGORY_SLUG = 'bangong';
const OFFICE_CATEGORY_LABEL = '办公';

// ---------------------------------------------------------------------------
// Request tuning
// ---------------------------------------------------------------------------

/** Timeout for list/category STO requests. */
const PLAZA_REQUEST_TIMEOUT_MS = 5000;
/** Timeout for per-skill detail requests (used in enrichment fallback). */
const DETAIL_REQUEST_TIMEOUT_MS = 3000;
/** Max concurrent detail requests when enriching local skills. */
const DETAIL_FILL_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Cache TTLs
// ---------------------------------------------------------------------------

const APOLLO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CATEGORIES_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ENRICHMENT_INDEX_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * A one-shot snapshot of local skill install state, read once per request and
 * reused across every skill so we do not re-scan the skills directory and
 * re-parse lock.json for each entry.
 */
interface LocalStateSnapshot {
  installedSlugs: Set<string>;
  enabledSlugs: Set<string>;
  disabledSlugs: Set<string>;
  lockEntries: Map<string, { version?: string; source?: string; versionSource?: string }>;
}

// ---------------------------------------------------------------------------
// Python API Client
// ---------------------------------------------------------------------------

class PythonApiClient {
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getStoToken();
    if (!token) {
      throw new Error('未登录或 stoToken 已过期，请重新登录');
    }
    return {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    timeoutMs: number = PLAZA_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const baseUrl = await resolveStoBaseUrl();
    const headers = await this.getAuthHeaders();
    const url = `${baseUrl}${endpoint}`;
    // Abort the underlying fetch on timeout so a slow STO backend cannot hang
    // the whole request chain up to the outer 15s IPC timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const options: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Python API 请求超时 (${timeoutMs}ms): ${method} ${endpoint}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Python API 请求失败 (${res.status}): ${text}`);
    }

    const json = await res.json() as { data?: T; success?: boolean; error?: string };
    if (json.success === false) {
      throw new Error(json.error || 'Python API 返回业务错误');
    }
    return (json.data ?? json) as T;
  }

  async getCategories(codesParam?: string): Promise<{ categories: CategoryDef[] }> {
    const endpoint = codesParam
      ? `/agent/v1/skills/plaza/categories?codes=${encodeURIComponent(codesParam)}`
      : '/agent/v1/skills/plaza/categories';
    return this.request<{ categories: CategoryDef[] }>('GET', endpoint);
  }

  async getPlazaSkills(params: SkillPlazaListParams, categorys?: string): Promise<PlazaListResult> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category_code', params.category);
    if (params.source) qs.set('source', params.source);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.pageSize !== undefined) qs.set('page_size', String(params.pageSize));
    if (categorys) qs.set('categorys', categorys);

    const query = qs.toString();
    const endpoint = query ? `/agent/v1/skills/plaza?${query}` : '/agent/v1/skills/plaza';
    const raw = await this.request<Record<string, unknown>>('GET', endpoint);
    return convertPlazaListResponse(raw);
  }

  async getSkillDetail(slug: string): Promise<SkillDetail> {
    const raw = await this.request<Record<string, unknown>>(
      'GET',
      `/agent/v1/skills/plaza/${encodeURIComponent(slug)}`,
      undefined,
      DETAIL_REQUEST_TIMEOUT_MS,
    );
    return convertSkillDetail(raw);
  }

  async recordUse(slug: string): Promise<void> {
    await this.request<unknown>('POST', `/agent/v1/skills/plaza/${encodeURIComponent(slug)}/use`);
  }

  async recordInstall(slug: string): Promise<void> {
    await this.request<unknown>('POST', `/agent/v1/skills/plaza/${encodeURIComponent(slug)}/install`);
  }

  async recordUninstall(slug: string): Promise<void> {
    await this.request<unknown>('POST', `/agent/v1/skills/plaza/${encodeURIComponent(slug)}/uninstall`);
  }
}

// ---------------------------------------------------------------------------
// Snake_case → camelCase converter
// ---------------------------------------------------------------------------

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeysToCamelCase<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeysToCamelCase<unknown>(item)) as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = toCamelCase(key);
      result[camelKey] = convertKeysToCamelCase<unknown>(value);
    }
    return result as T;
  }
  return obj as T;
}

// ---------------------------------------------------------------------------
// Response converters
// ---------------------------------------------------------------------------

function convertPlazaListResponse(raw: Record<string, unknown>): PlazaListResult {
  const converted = convertKeysToCamelCase<PlazaListResult>(raw);
  return {
    skills: (converted.skills || []).map((s) => normalizeSkillSummary(s)),
    categoryCounts: converted.categoryCounts || {},
    hasMore: converted.hasMore ?? false,
    page: converted.page ?? 1,
    pageSize: converted.pageSize ?? 20,
    total: converted.total,
  };
}

function convertSkillDetail(raw: Record<string, unknown>): SkillDetail {
  const payload =
    raw.skill && typeof raw.skill === 'object'
      ? (convertKeysToCamelCase<Record<string, unknown>>(raw.skill))
      : convertKeysToCamelCase<SkillDetail>(raw);
  return normalizeSkillDetail(payload as Partial<SkillDetail>);
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeSkillSummary(skill: Partial<SkillSummary>): SkillSummary {
  return {
    slug: skill.slug || '',
    title: skill.title || '',
    description: skill.description || '',
    category: skill.category ?? null,
    categoryCode: skill.categoryCode ?? null,
    categoryCodes: Array.isArray(skill.categoryCodes) ? skill.categoryCodes : undefined,
    categoryNames: Array.isArray(skill.categoryNames) ? skill.categoryNames : undefined,
    source: skill.source === 'mine' ? 'mine' : 'official',
    installed: skill.installed ?? false,
    enabled: skill.enabled,
    installCount: skill.installCount ?? 0,
    useCount: skill.useCount ?? 0,
    points: skill.points ?? 8,
    icon: skill.icon,
    defaultPrompt: skill.defaultPrompt || skill.title || '',
    updatedAt: skill.updatedAt,
    version: skill.version,
    installedVersion: skill.installedVersion,
    updateAvailable: skill.updateAvailable ?? false,
  };
}

function normalizeSkillDetail(skill: Partial<SkillDetail>): SkillDetail {
  const summary = normalizeSkillSummary(skill);
  return {
    ...summary,
    detail: {
      intro: skill.detail?.intro || '',
    },
  };
}

/** Resolve category slug from categoryCode or Chinese category label. */
function resolveSkillCategoryCode(
  skill: SkillSummary,
  labelToSlug: Map<string, string>,
): string | null {
  if (skill.categoryCode) return skill.categoryCode;
  if (skill.category) return labelToSlug.get(skill.category) ?? null;
  return null;
}

/** Apply local preinstalled skill deltas onto remote category_counts. */
function applyLocalPreinstalledCountDelta(
  counts: Record<string, number>,
  newLocalOffice: SkillSummary[],
  newLocalOthers: SkillSummary[],
): Record<string, number> {
  const officeDelta = newLocalOffice.length;
  const othersDelta = newLocalOthers.length;
  const totalDelta = officeDelta + othersDelta;
  if (totalDelta === 0) return counts;

  return {
    ...counts,
    '': (counts[''] || 0) + totalDelta,
    [OFFICE_CATEGORY_SLUG]: (counts[OFFICE_CATEGORY_SLUG] || 0) + officeDelta,
    qita: (counts['qita'] || 0) + othersDelta,
  };
}

// ---------------------------------------------------------------------------
// Local state helpers
// ---------------------------------------------------------------------------

function readLockJsonSkillEntries(configDir: string): Map<string, {
  version?: string;
  source?: string;
  versionSource?: string;
}> {
  const lockFile = path.join(configDir, '.clawhub', 'lock.json');
  const entries = new Map<string, {
    version?: string;
    source?: string;
    versionSource?: string;
  }>();
  try {
    if (fs.existsSync(lockFile)) {
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      const skills = data?.skills || {};
      for (const [slug, info] of Object.entries(skills)) {
        if (info && typeof info === 'object') {
          const record = info as {
            version?: string;
            source?: string;
            versionSource?: string;
          };
          entries.set(slug, record);
        }
      }
    }
  } catch (err) {
    logger.warn('[SkillPlazaService] Failed to read lock.json:', err);
  }
  return entries;
}

function readSkillsDirSlugs(skillsDir: string): Set<string> {
  const slugs = new Set<string>();
  try {
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            slugs.add(entry.name);
          }
        }
      }
    }
  } catch (err) {
    logger.warn('[SkillPlazaService] Failed to read skills dir:', err);
  }
  return slugs;
}

function isPreinstalledSkill(skillDir: string): boolean {
  const markerPath = path.join(skillDir, PREINSTALLED_MARKER_NAME);
  try {
    return fs.existsSync(markerPath);
  } catch {
    return false;
  }
}

function isUserUploadedSkill(skillDir: string): boolean {
  const markerPath = path.join(skillDir, USER_UPLOAD_MARKER_NAME);
  try {
    return fs.existsSync(markerPath);
  } catch {
    return false;
  }
}

function readSkillMdVersion(skillDir: string): string | null {
  const fm = readSkillMdFrontmatter(skillDir);
  return fm?.version ?? null;
}

function resolveSkillDirForSlug(skillsDir: string, disabledDir: string, slug: string): string | null {
  const activeDir = path.join(skillsDir, slug);
  if (fs.existsSync(path.join(activeDir, 'SKILL.md'))) return activeDir;
  const disabledSkillDir = path.join(disabledDir, slug);
  if (fs.existsSync(path.join(disabledSkillDir, 'SKILL.md'))) return disabledSkillDir;
  return null;
}

function readDisabledDirSlugs(disabledDir: string): Set<string> {
  const slugs = new Set<string>();
  try {
    if (fs.existsSync(disabledDir)) {
      const entries = fs.readdirSync(disabledDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMdPath = path.join(disabledDir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            slugs.add(entry.name);
          }
        }
      }
    }
  } catch (err) {
    logger.warn('[SkillPlazaService] Failed to read disabled skills dir:', err);
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// Read local skill summary from skills directory
// ---------------------------------------------------------------------------

function readLocalSkillSummary(skillsDir: string, slug: string): Partial<SkillSummary> | null {
  const skillDir = path.join(skillsDir, slug);

  // Try openclaw.json inside skill dir
  const openclawPath = path.join(skillDir, 'openclaw.json');
  if (fs.existsSync(openclawPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(openclawPath, 'utf8'));
      return {
        slug,
        title: data.name || data.title || slug,
        description: data.description || '',
        category: data.category || null,
        categoryCode: data.category || null,
        points: typeof data.points === 'number' ? data.points : 8,
        icon: data.icon,
        defaultPrompt: data.defaultPrompt || data.name || data.title || slug,
      };
    } catch (err) {
      logger.warn(`[SkillPlazaService] Failed to parse openclaw.json for ${slug}:`, err);
    }
  }

  // Try SKILL.md front matter
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    try {
      const content = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (frontMatterMatch) {
        const meta = parseSkillFrontmatter(frontMatterMatch[1]);
        // front matter 里优先取 title，没有 title 再取 name
        let title = meta.title || meta.name || '';
        if (!title) {
          const bodyStart = content.indexOf('---\n', 3) + 4;
          const body = content.slice(bodyStart);
          const firstLine = body.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim();
          title = firstLine || slug;
        }
        return {
          slug,
          title,
          description: meta.description || '',
          category: meta.category || null,
          categoryCode: meta.category || null,
          points: meta.points ? Number(meta.points) : 8,
          defaultPrompt: meta.defaultPrompt || title || slug,
        };
      }
      // No front matter, use first non-empty line as title
      const firstLine = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim();
      return {
        slug,
        title: firstLine || slug,
        description: content.slice(0, 200),
        defaultPrompt: firstLine || slug,
      };
    } catch (err) {
      logger.warn(`[SkillPlazaService] Failed to read SKILL.md for ${slug}:`, err);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SkillPlazaService {
  private client = new PythonApiClient();
  private configDir: string;
  private skillsDir: string;

  // Shared caches (stale-while-revalidate + in-flight dedup). Apollo config and
  // category defs change rarely; the enrichment index backs local-skill
  // categorization. Mutations invalidate the relevant caches.
  private apolloCache = new KeyedTtlCache<string>(APOLLO_CACHE_TTL_MS);
  // Keyed by the resolved Apollo "categorys" filter so a role/account switch
  // (which changes that filter) transparently uses a separate cache entry.
  private categoriesCache = new KeyedTtlCache<CategoryDef[]>(CATEGORIES_CACHE_TTL_MS);
  private enrichmentIndexCache = new KeyedTtlCache<Map<string, SkillSummary>>(ENRICHMENT_INDEX_TTL_MS);

  constructor() {
    this.configDir = getOpenClawConfigDir();
    this.skillsDir = getOpenClawSkillsDir();
  }

  /** Invalidate caches that depend on installed/enabled skill state. */
  private invalidateLocalCaches(): void {
    this.enrichmentIndexCache.invalidate();
  }

  /**
   * Guard plaza reads on STO token availability. Without a token the backend
   * cannot apply the Apollo category filter and would return an unfiltered set,
   * so we throw a typed error the renderer maps to a loading + retry state.
   */
  private async assertAuthReady(): Promise<void> {
    const token = await getStoToken();
    if (!token) {
      throw new SkillPlazaAuthNotReadyError();
    }
  }

  // ---- Local state readers ----

  private getDisabledDir(): string {
    return path.join(this.configDir, 'skills-disabled');
  }

  /** Read install/enable/lock state once for reuse across a whole request. */
  private buildLocalStateSnapshot(): LocalStateSnapshot {
    const lockEntries = readLockJsonSkillEntries(this.configDir);
    const fromDir = readSkillsDirSlugs(this.skillsDir);
    const fromDisabled = readDisabledDirSlugs(this.getDisabledDir());
    return {
      installedSlugs: new Set([...lockEntries.keys(), ...fromDir, ...fromDisabled]),
      enabledSlugs: fromDir,
      disabledSlugs: fromDisabled,
      lockEntries,
    };
  }

  private overlayLocalState<T extends SkillSummary>(skill: T, snapshot?: LocalStateSnapshot): T {
    const snap = snapshot ?? this.buildLocalStateSnapshot();
    const installedSlugs = snap.installedSlugs;
    const enabledSlugs = snap.enabledSlugs;
    const lockEntries = snap.lockEntries;
    const installed = installedSlugs.has(skill.slug);
    // overlayLocalState 仅处理 plaza API 项，不应因 lock 缺失把市场安装误判为「纯本地自建」
    const source: 'official' | 'mine' = skill.source === 'mine' ? 'mine' : 'official';

    let installedVersion: string | undefined;
    let updateAvailable = false;

    const lockInfo = lockEntries.get(skill.slug);
    const isStoMarketplaceInstall = lockInfo?.source === 'sto-marketplace';

    if (installed && skill.version) {
      const skillDir = resolveSkillDirForSlug(this.skillsDir, this.getDisabledDir(), skill.slug);
      const lockVersion = isStoMarketplaceInstall ? lockInfo?.version : undefined;
      const skillMdVersion = skillDir && !isPreinstalledSkill(skillDir)
        ? readSkillMdVersion(skillDir)
        : null;

      if (skillDir && !isPreinstalledSkill(skillDir)) {
        installedVersion = resolveInstalledVersionForCompare(lockVersion, skillMdVersion);
        updateAvailable = isRemoteVersionNewer(skill.version, installedVersion);
      }
    }

    return {
      ...skill,
      installed,
      enabled: installed ? enabledSlugs.has(skill.slug) : undefined,
      source,
      installedVersion,
      updateAvailable,
    };
  }

  private normalizeRemotePlazaSkills(
    skills: SkillSummary[],
    labelToSlug: Map<string, string>,
    snapshot?: LocalStateSnapshot,
  ): SkillSummary[] {
    const snap = snapshot ?? this.buildLocalStateSnapshot();
    return skills.map((s) => this.overlayLocalState(s, snap)).map((s) => {
      if (OFFICE_SKILL_SLUGS.has(s.slug)) {
        return { ...s, category: OFFICE_CATEGORY_LABEL, categoryCode: OFFICE_CATEGORY_SLUG };
      }
      const code = resolveSkillCategoryCode(s, labelToSlug);
      if (code && code !== s.categoryCode) {
        return { ...s, categoryCode: code };
      }
      return s;
    });
  }

  private mergeLocalPreinstalledSkills(
    skills: SkillSummary[],
    localOfficeSkills: SkillSummary[],
    localPreinstalledOthers: SkillSummary[],
    hasCategoryFilter: boolean,
    isQitaFilter: boolean,
  ): SkillSummary[] {
    const existingSlugs = new Set(skills.map((s) => s.slug));
    const newLocalOffice = localOfficeSkills.filter((s) => !existingSlugs.has(s.slug));
    const newLocalOthers = localPreinstalledOthers.filter((s) => !existingSlugs.has(s.slug));

    let merged = skills;
    if (!hasCategoryFilter) {
      if (newLocalOffice.length > 0) {
        merged = [...merged, ...newLocalOffice];
      }
      if (newLocalOthers.length > 0) {
        merged = [...merged, ...newLocalOthers];
      }
    } else if (isQitaFilter && newLocalOthers.length > 0) {
      merged = [...merged, ...newLocalOthers];
    }
    return merged;
  }

  /**
   * Fetch category_counts from remote API (no category_code filter).
   * Also returns first-page remote slugs for local preinstall dedupe.
   */
  private async fetchRemoteCategoryCounts(
    params: SkillPlazaListParams,
    categorys: string,
  ): Promise<{ categoryCounts: Record<string, number>; remoteSlugs: Set<string> }> {
    const result = await this.client.getPlazaSkills(
      { ...params, category: undefined, page: 1, pageSize: 50 },
      categorys || undefined,
    );
    return {
      categoryCounts: { ...(result.categoryCounts || {}) },
      remoteSlugs: new Set(result.skills.map((s) => s.slug)),
    };
  }

  private resolveLocalPreinstallCountDelta(
    localOfficeSkills: SkillSummary[],
    localPreinstalledOthers: SkillSummary[],
    remoteSlugs: Set<string>,
  ): { newLocalOffice: SkillSummary[]; newLocalOthers: SkillSummary[] } {
    return {
      newLocalOffice: localOfficeSkills.filter((s) => !remoteSlugs.has(s.slug)),
      newLocalOthers: localPreinstalledOthers.filter((s) => !remoteSlugs.has(s.slug)),
    };
  }

  private filterUncategorizedPlazaSkills(skills: SkillSummary[]): SkillSummary[] {
    return skills.filter((s) => Boolean(s.categoryCode));
  }

  /**
   * Resolve the Apollo "categorys" filter for the current user role.
   * Cached (10 min) and de-duplicated so a single load cycle resolves it once.
   */
  private async resolveCategorysFilter(): Promise<string> {
    try {
      const authState = await getAuthState();
      const categoryCode = authState.user?.categoryCode;
      const apolloKey = isSiteUser(categoryCode)
        ? 'claw.site.skill.category'
        : 'claw.prov_head.skill.category';
      // Only cache a successful (non-null) Apollo response. A null result means
      // the token/base was not ready (cold start) or the request failed; caching
      // it would lock in an *unfiltered* category set for the whole TTL, so we
      // throw to skip caching and let the next call retry once auth is ready.
      // A legitimate empty-string value ("" = no filter) is still cached.
      return await this.apolloCache.get(apolloKey, async () => {
        const value = await fetchApolloConfigValue(apolloKey);
        if (value === null) {
          throw new Error(`Apollo config "${apolloKey}" unavailable`);
        }
        return value;
      });
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to resolve categorys filter:', err);
      return '';
    }
  }

  /**
   * Build (or reuse a cached) slug → plaza-skill index for local-skill category
   * enrichment. A single unfiltered paginated pull replaces the previous
   * "全量 + 每分类" N+1 serial download; per-slug category gaps are filled on
   * demand via {@link getSkillDetail} in getLocalSkills.
   */
  private async fetchPlazaEnrichmentIndex(
    labelToSlug: Map<string, string>,
    snapshot: LocalStateSnapshot,
  ): Promise<Map<string, SkillSummary>> {
    const categorys = await this.resolveCategorysFilter();
    return this.enrichmentIndexCache.get(categorys, async () => {
      const map = new Map<string, SkillSummary>();
      let page = 1;
      while (true) {
        const result = await this.client.getPlazaSkills(
          { page, pageSize: 1000 },
          categorys || undefined,
        );
        const normalized = this.normalizeRemotePlazaSkills(result.skills, labelToSlug, snapshot);
        for (const skill of normalized) {
          if (!skill.slug) continue;
          const existing = map.get(skill.slug);
          if (!existing || (!existing.categoryCode && skill.categoryCode)) {
            map.set(skill.slug, skill);
          }
        }
        if (!result.hasMore || result.skills.length === 0) break;
        page++;
        if (page > 50) break;
      }
      return map;
    });
  }

  /**
   * For installed official skills whose category could not be resolved from the
   * enrichment index, fetch skill detail with bounded concurrency to recover
   * the nav category. Preinstalled / user-uploaded / office skills are handled
   * separately and never reach here.
   */
  private async fillMissingCategoriesFromDetail(
    allSlugs: Set<string>,
    snapshot: LocalStateSnapshot,
    plazaSkillMap: Map<string, SkillSummary>,
    manifestSlugs: Set<string>,
    categoryDefs: CategoryDef[],
  ): Promise<Map<string, { code: string | null; label: string | null }>> {
    const needDetail: string[] = [];
    for (const slug of allSlugs) {
      if (OFFICE_SKILL_SLUGS.has(slug)) continue;

      const isEnabled = snapshot.enabledSlugs.has(slug);
      const skillDirPath = isEnabled
        ? path.join(this.skillsDir, slug)
        : path.join(this.getDisabledDir(), slug);
      if (isPreinstalledSkill(skillDirPath) || isUserUploadedSkill(skillDirPath)) continue;

      const plazaSkill = plazaSkillMap.get(slug);
      const isOfficial =
        snapshot.lockEntries.has(slug) ||
        plazaSkill?.source === 'official' ||
        manifestSlugs.has(slug);
      if (!isOfficial) continue;

      if (plazaSkill && pickNavCategoryFromApiSkill(plazaSkill, categoryDefs).code) continue;
      needDetail.push(slug);
    }

    const result = new Map<string, { code: string | null; label: string | null }>();
    if (needDetail.length === 0) return result;

    await mapWithConcurrency(needDetail, DETAIL_FILL_CONCURRENCY, async (slug) => {
      try {
        const detail = await this.getSkillDetail(slug);
        const picked = pickNavCategoryFromApiSkill(detail, categoryDefs);
        result.set(slug, { code: picked.code, label: picked.label });
      } catch (err) {
        logger.warn(`[getLocalSkills] getSkillDetail failed for ${slug}:`, err);
      }
    });
    return result;
  }

  // ---- Office skills from local filesystem ----

  private getOfficeSkillsFromLocal(q?: string): SkillSummary[] {
    const activeSlugs = readSkillsDirSlugs(this.skillsDir);
    const disabledSlugs = readDisabledDirSlugs(this.getDisabledDir());
    const skills: SkillSummary[] = [];

    for (const slug of OFFICE_SKILL_SLUGS) {
      const isEnabled = activeSlugs.has(slug);
      const isDisabled = disabledSlugs.has(slug);
      if (!isEnabled && !isDisabled) continue;

      const skillRootDir = isEnabled ? this.skillsDir : this.getDisabledDir();
      const summary = readLocalSkillSummary(skillRootDir, slug);
      if (!summary) continue;

      // Apply search filter if provided
      if (q) {
        const lowerQ = q.toLowerCase();
        const title = (summary.title || slug).toLowerCase();
        const desc = (summary.description || '').toLowerCase();
        if (!title.includes(lowerQ) && !desc.includes(lowerQ)) continue;
      }

      skills.push({
        slug: summary.slug || slug,
        title: summary.title || slug,
        description: summary.description || '',
        category: OFFICE_CATEGORY_LABEL,
        categoryCode: OFFICE_CATEGORY_SLUG,
        source: 'official',
        installed: true,
        enabled: isEnabled,
        installCount: 0,
        useCount: 0,
        points: summary.points ?? 8,
        icon: summary.icon,
        defaultPrompt: summary.defaultPrompt || summary.title || slug,
        updatedAt: undefined,
      });
    }

    return skills;
  }

  // ---- Preinstalled non-office skills from local filesystem ----

  private getPreinstalledNonOfficeSkillsFromLocal(q?: string): SkillSummary[] {
    const activeSlugs = readSkillsDirSlugs(this.skillsDir);
    const disabledSlugs = readDisabledDirSlugs(this.getDisabledDir());
    const allSlugs = new Set([...activeSlugs, ...disabledSlugs]);
    const skills: SkillSummary[] = [];

    for (const slug of allSlugs) {
      if (OFFICE_SKILL_SLUGS.has(slug)) continue;

      const isEnabled = activeSlugs.has(slug);
      const skillRootDir = isEnabled ? this.skillsDir : this.getDisabledDir();
      const skillDirPath = path.join(skillRootDir, slug);

      if (!isPreinstalledSkill(skillDirPath)) continue;

      const summary = readLocalSkillSummary(skillRootDir, slug);
      if (!summary) continue;

      // Apply search filter if provided
      if (q) {
        const lowerQ = q.toLowerCase();
        const title = (summary.title || slug).toLowerCase();
        const desc = (summary.description || '').toLowerCase();
        if (!title.includes(lowerQ) && !desc.includes(lowerQ)) continue;
      }

      skills.push({
        slug: summary.slug || slug,
        title: summary.title || slug,
        description: summary.description || '',
        category: '其他',
        categoryCode: 'qita',
        source: 'official',
        installed: true,
        enabled: isEnabled,
        installCount: 0,
        useCount: 0,
        points: summary.points ?? 8,
        icon: summary.icon,
        defaultPrompt: summary.defaultPrompt || summary.title || slug,
        updatedAt: undefined,
      });
    }

    return skills;
  }

  // ---- Public API ----

  async getCategories(): Promise<CategoryDef[]> {
    await this.assertAuthReady();
    // Determine user role → Apollo category filter (cached + deduped), then
    // cache the resolved category defs keyed by that filter.
    const queryParams = await this.resolveCategorysFilter();
    return this.categoriesCache.get(queryParams, async () => {
      const res = await this.client.getCategories(queryParams || undefined);
      const categories = [...(res.categories || [])];

      // Inject "办公" category if not already present
      if (!categories.some((c) => c.slug === OFFICE_CATEGORY_SLUG)) {
        categories.push({ slug: OFFICE_CATEGORY_SLUG, label: OFFICE_CATEGORY_LABEL });
      }

      // Inject "其他" category if not already present
      if (!categories.some((c) => c.slug === 'qita')) {
        categories.push({ slug: 'qita', label: '其他' });
      }

      return categories;
    });
  }

  async getPlazaSkills(params: SkillPlazaListParams): Promise<PlazaListResult> {
    await this.assertAuthReady();
    // Resolve categorys filter from Apollo config (cached + deduped).
    const categorys = await this.resolveCategorysFilter();

    const isOfficeFilter = params.category === OFFICE_CATEGORY_SLUG;
    const isQitaFilter = params.category === 'qita';
    const hasCategoryFilter = Boolean(params.category && params.category !== '');
    const localOfficeSkills = this.getOfficeSkillsFromLocal(params.q);
    const localPreinstalledOthers = this.getPreinstalledNonOfficeSkillsFromLocal(params.q);
    // Read local install state once and reuse it while normalizing every skill.
    const snapshot = this.buildLocalStateSnapshot();

    let labelToSlug = new Map<string, string>();
    try {
      const categories = await this.getCategories();
      labelToSlug = new Map(categories.map((c) => [c.label, c.slug]));
    } catch (err) {
      if (isSkillPlazaAuthNotReadyError(err)) throw err;
      logger.warn('[SkillPlazaService] Failed to load categories for skill normalization:', err);
    }

    if (isOfficeFilter) {
      const { categoryCounts: remoteCounts, remoteSlugs } = await this.fetchRemoteCategoryCounts(
        params,
        categorys,
      );
      const { newLocalOffice, newLocalOthers } = this.resolveLocalPreinstallCountDelta(
        localOfficeSkills,
        localPreinstalledOthers,
        remoteSlugs,
      );
      const categoryCounts = applyLocalPreinstalledCountDelta(
        remoteCounts,
        newLocalOffice,
        newLocalOthers,
      );

      return {
        skills: localOfficeSkills,
        categoryCounts,
        hasMore: false,
        page: 1,
        pageSize: params.pageSize ?? 20,
        total: localOfficeSkills.length,
      };
    }

    // List: remote API with category_code filter so cards match backend management platform.
    const result = await this.client.getPlazaSkills(params, categorys || undefined);
    let skills = this.mergeLocalPreinstalledSkills(
      this.normalizeRemotePlazaSkills(result.skills, labelToSlug, snapshot),
      localOfficeSkills,
      localPreinstalledOthers,
      hasCategoryFilter,
      isQitaFilter,
    );

    // Remote category_counts[''] excludes uncategorized skills; align list on "全部" view.
    if (!hasCategoryFilter) {
      skills = this.filterUncategorizedPlazaSkills(skills);
    }

    // Nav counts always reflect the full category panorama (incl. local
    // preinstall). When no category filter is applied the main response is
    // already the unfiltered panorama, so reuse it instead of firing a second
    // identical request. Only category-filtered views need the extra
    // unfiltered count fetch.
    let remoteCounts: Record<string, number>;
    let remoteSlugs: Set<string>;
    if (!hasCategoryFilter) {
      remoteCounts = { ...(result.categoryCounts || {}) };
      remoteSlugs = new Set(result.skills.map((s) => s.slug));
    } else {
      const counts = await this.fetchRemoteCategoryCounts(params, categorys);
      remoteCounts = counts.categoryCounts;
      remoteSlugs = counts.remoteSlugs;
    }
    const { newLocalOffice, newLocalOthers } = this.resolveLocalPreinstallCountDelta(
      localOfficeSkills,
      localPreinstalledOthers,
      remoteSlugs,
    );
    const categoryCounts = applyLocalPreinstalledCountDelta(
      remoteCounts,
      newLocalOffice,
      newLocalOthers,
    );

    const listNewLocalOthers = isQitaFilter ? newLocalOthers : [];

    let total = result.total ?? skills.length;
    if (!hasCategoryFilter) {
      total = categoryCounts[''] ?? skills.length;
    } else if (isQitaFilter) {
      total = (result.total || 0) + listNewLocalOthers.length;
    }

    return {
      ...result,
      skills,
      categoryCounts,
      total,
    };
  }

  async getLocalSkills(): Promise<PlazaListResult> {
    await this.assertAuthReady();
    // Read install/enable/lock state once for the whole request.
    const snapshot = this.buildLocalStateSnapshot();
    const activeSlugs = snapshot.enabledSlugs;
    const disabledSlugs = snapshot.disabledSlugs;
    const allSlugs = new Set([...activeSlugs, ...disabledSlugs]);
    const fromLock = new Set(snapshot.lockEntries.keys());
    const manifestSlugs = readPreinstalledManifestSlugs();

    // 获取 plaza 分类列表，建立 label → slug 映射（权威来源）
    let labelToSlug = new Map<string, string>();
    let categoryDefs: CategoryDef[] = [];
    try {
      categoryDefs = await this.getCategories();
      labelToSlug = new Map(categoryDefs.map((c) => [c.label, c.slug]));    } catch (err) {
      if (isSkillPlazaAuthNotReadyError(err)) throw err;
      logger.warn('[SkillPlazaService] Failed to fetch categories for local skills:', err);
    }

    // Build (or reuse cached) slug → plaza-skill index from a single unfiltered
    // pull, used to enrich official skills' title/description/category.
    let plazaSkillMap = new Map<string, SkillSummary>();
    try {
      plazaSkillMap = await this.fetchPlazaEnrichmentIndex(labelToSlug, snapshot);    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to fetch plaza skills for categorization:', err);
    }

    // Determine which official skills still lack a category after the index
    // lookup, and fill them via detail requests with bounded concurrency
    // (replaces the previous per-skill serial awaits).
    const detailCategoryMap = await this.fillMissingCategoriesFromDetail(
      allSlugs,
      snapshot,
      plazaSkillMap,
      manifestSlugs,
      categoryDefs,
    );

    // SKILL.md 里的 category 可能是中文标签，映射到前端 slug（仅当 plaza 完全不可用时兜底）
    const categoryLabelToSlug: Record<string, string> = {
      '技术': 'jishu',
      '产品': 'chanpin',
      '设计': 'sheji',
      '行政': 'xingzheng',
      '财务': 'caiwu',
      'HR': 'hr',
      '通用': 'tongyong',
      '模板': 'moban',
      '网络': 'wangluo',
      '政策': 'zhengce',
      '运营': 'yunying',
      '客服': 'kefu',
      '办公': 'bangong',
      '其他': 'qita',
    };

    const skills: SkillSummary[] = [];

    for (const slug of allSlugs) {
      const isEnabled = activeSlugs.has(slug);
      const skillDir = isEnabled ? this.skillsDir : this.getDisabledDir();
      const summary = readLocalSkillSummary(skillDir, slug);
      if (summary) {
        const plazaSkill = plazaSkillMap.get(slug);
        const skillDirPath = isEnabled ? path.join(this.skillsDir, slug) : path.join(this.getDisabledDir(), slug);
        const isPreinstalled = isPreinstalledSkill(skillDirPath);
        const isOfficial = fromLock.has(slug) || plazaSkill?.source === 'official' || manifestSlugs.has(slug);
        const source: 'official' | 'mine' = isOfficial ? 'official' : 'mine';
        const isUserUploaded = isUserUploadedSkill(skillDirPath);
        const isOfficeSkill = OFFICE_SKILL_SLUGS.has(slug);

        // 分类优先级：办公技能 > 预安装技能（其他）> 按 plaza 权威数据 / 本地元数据
        let finalCategory: string | null;
        let finalCategoryCode: string | null;
        if (isOfficeSkill) {
          finalCategory = OFFICE_CATEGORY_LABEL;
          finalCategoryCode = OFFICE_CATEGORY_SLUG;
        } else if (isPreinstalled) {
          finalCategory = '其他';
          finalCategoryCode = 'qita';
        } else if (isUserUploaded) {
          finalCategory = '其他';
          finalCategoryCode = 'qita';
        } else {
          // 优先使用 plaza 权威数据（categoryCode + category）
          let resolvedCode: string | null = null;
          let resolvedLabel: string | null = null;

          if (isOfficial) {
            const plazaSkill = plazaSkillMap.get(slug);
            if (plazaSkill) {
              const picked = pickNavCategoryFromApiSkill(plazaSkill, categoryDefs);
              resolvedCode = picked.code;
              resolvedLabel = picked.label;
            }

            if (!resolvedCode) {
              const fromDetail = detailCategoryMap.get(slug);
              if (fromDetail) {
                resolvedCode = fromDetail.code;
                resolvedLabel = fromDetail.label;
              }
            }
          }

          // plaza 不可用时 fallback 到本地元数据
          if (!resolvedCode && !resolvedLabel) {
            resolvedLabel = summary.category || null;
            if (resolvedLabel) {
              resolvedCode = labelToSlug.get(resolvedLabel) || categoryLabelToSlug[resolvedLabel] || resolvedLabel;
            }
          }

          finalCategory = resolvedLabel;
          finalCategoryCode = resolvedCode;        }

        // 技能广场目录中存在该 slug 时，展示 title/description 以 plaza 为准（与技能广场 tab 一致）
        const displayTitle = plazaSkill?.title ? plazaSkill.title : summary.title || slug;
        const displayDescription = plazaSkill?.description
          ? plazaSkill.description
          : summary.description || '';

        const baseSkill: SkillSummary = {
          slug: summary.slug || slug,
          title: displayTitle,
          description: displayDescription,
          category: finalCategory,
          categoryCode: finalCategoryCode,
          source,
          installed: true,
          enabled: isEnabled,
          installCount: plazaSkill?.installCount ?? 0,
          useCount: plazaSkill?.useCount ?? 0,
          points: summary.points ?? plazaSkill?.points ?? 8,
          icon: summary.icon ?? plazaSkill?.icon,
          defaultPrompt: summary.defaultPrompt || displayTitle || slug,
          updatedAt: plazaSkill?.updatedAt,
          version: plazaSkill?.version,
        };
        skills.push(this.overlayLocalState(baseSkill, snapshot));
      }
    }

    // 基于实际返回的 skills 数组计算分类计数，确保 categoryCounts 与 skills 严格一致
    // 未分类（categoryCode 为 null）只在「全部」中计数；「其他」兜底仅在前端 enrich 阶段处理
    const finalCategoryCounts: Record<string, number> = {};
    for (const skill of skills) {
      const code = skill.categoryCode;
      if (code) {
        finalCategoryCounts[code] = (finalCategoryCounts[code] || 0) + 1;
      }
    }
    finalCategoryCounts[''] = skills.length;

    return {
      skills,
      categoryCounts: finalCategoryCounts,
      hasMore: false,
      page: 1,
      pageSize: skills.length,
      total: skills.length,
    };
  }

  async getSkillDetail(slug: string): Promise<SkillDetail> {
    const detail = await this.client.getSkillDetail(slug);
    const withLocalState = this.overlayLocalState(detail);
    if (OFFICE_SKILL_SLUGS.has(slug)) {
      return { ...withLocalState, category: OFFICE_CATEGORY_LABEL, categoryCode: OFFICE_CATEGORY_SLUG };
    }
    return withLocalState;
  }

  async recordUse(slug: string): Promise<void> {
    await this.client.recordUse(slug);
  }

  async recordInstall(slug: string): Promise<void> {
    // Install changed local state; drop caches that overlay it.
    this.invalidateLocalCaches();
    await this.client.recordInstall(slug);
  }

  async recordUninstall(slug: string): Promise<void> {
    this.invalidateLocalCaches();
    await this.client.recordUninstall(slug);
  }

  async toggleSkillEnabled(slug: string, enabled: boolean): Promise<void> {
    // Enable/disable moves the skill dir, changing overlay state.
    this.invalidateLocalCaches();
    const disabledDir = this.getDisabledDir();
    const activeDir = this.skillsDir;
    const srcDir = enabled ? path.join(disabledDir, slug) : path.join(activeDir, slug);
    const destDir = enabled ? path.join(activeDir, slug) : path.join(disabledDir, slug);

    if (!fs.existsSync(srcDir)) {
      // 源目录不存在，可能只是 openclaw.json 里的标记，同步一下即可
      await setSkillsEnabled([slug], enabled);
      return;
    }

    if (!fs.existsSync(disabledDir)) {
      fs.mkdirSync(disabledDir, { recursive: true });
    }

    try {
      fs.renameSync(srcDir, destDir);
    } catch (err) {
      logger.error(`[SkillPlazaService] Failed to rename ${srcDir} -> ${destDir}:`, err);
    }

    // Also toggle in user workspace if applicable
    const userCode = await getCurrentActiveUserCode();
    if (userCode) {
      const userActiveDir = getOpenClawUserSkillsDir(userCode);
      const userDisabledDir = getOpenClawUserDisabledDir(userCode);
      const userSrcDir = enabled ? path.join(userDisabledDir, slug) : path.join(userActiveDir, slug);
      const userDestDir = enabled ? path.join(userActiveDir, slug) : path.join(userDisabledDir, slug);

      if (fs.existsSync(userSrcDir)) {
        if (!fs.existsSync(userDisabledDir)) {
          fs.mkdirSync(userDisabledDir, { recursive: true });
        }
        try {
          fs.renameSync(userSrcDir, userDestDir);
        } catch (err) {
          logger.error(`[SkillPlazaService] Failed to rename user workspace ${userSrcDir} -> ${userDestDir}:`, err);
        }
      }
    }

    await setSkillsEnabled([slug], enabled);
  }
}
