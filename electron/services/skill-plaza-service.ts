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

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const baseUrl = await resolveStoBaseUrl();
    const headers = await this.getAuthHeaders();
    const url = `${baseUrl}${endpoint}`;

    logger.info(`[PythonApiClient] ${method} ${url}`);

    const options: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
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
    const raw = await this.request<Record<string, unknown>>('GET', `/agent/v1/skills/plaza/${encodeURIComponent(slug)}`);
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

function readLockJsonSkills(configDir: string): Set<string> {
  return new Set(readLockJsonSkillEntries(configDir).keys());
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

  constructor() {
    this.configDir = getOpenClawConfigDir();
    this.skillsDir = getOpenClawSkillsDir();
  }

  // ---- Local state readers ----

  private getDisabledDir(): string {
    return path.join(this.configDir, 'skills-disabled');
  }

  private getInstalledSlugs(): Set<string> {
    const fromLock = readLockJsonSkills(this.configDir);
    const fromDir = readSkillsDirSlugs(this.skillsDir);
    const fromDisabled = readDisabledDirSlugs(this.getDisabledDir());
    return new Set([...fromLock, ...fromDir, ...fromDisabled]);
  }

  private getEnabledSlugs(): Set<string> {
    // 技能在 skills/ 目录下 = 启用；在 skills-disabled/ 下 = 禁用
    return readSkillsDirSlugs(this.skillsDir);
  }

  private overlayLocalState<T extends SkillSummary>(skill: T): T {
    const installedSlugs = this.getInstalledSlugs();
    const enabledSlugs = this.getEnabledSlugs();
    const lockEntries = readLockJsonSkillEntries(this.configDir);
    const installed = installedSlugs.has(skill.slug);
    // overlayLocalState 仅处理 plaza API 项，不应因 lock 缺失把市场安装误判为「纯本地自建」
    const source: 'official' | 'mine' = skill.source === 'mine' ? 'mine' : 'official';

    let installedVersion: string | undefined;
    let updateAvailable = false;

    const lockInfo = lockEntries.get(skill.slug);
    const isStoMarketplaceInstall = lockInfo?.source === 'sto-marketplace';

    if (installed) {
      const skillDir = resolveSkillDirForSlug(this.skillsDir, this.getDisabledDir(), skill.slug);
      const lockVersion = isStoMarketplaceInstall ? lockInfo?.version : undefined;
      const skillMdVersion = skillDir && !isPreinstalledSkill(skillDir)
        ? readSkillMdVersion(skillDir)
        : null;

      const cmpInstalledVersion = resolveInstalledVersionForCompare(lockVersion, skillMdVersion);
      if (cmpInstalledVersion) {
        installedVersion = cmpInstalledVersion;
        if (skill.version) {
          updateAvailable = isRemoteVersionNewer(skill.version, installedVersion);
        }
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
  ): SkillSummary[] {
    return skills.map((s) => this.overlayLocalState(s)).map((s) => {
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

  private async resolvePlazaCategorysFilter(): Promise<string> {
    try {
      const authState = await getAuthState();
      const categoryCode = authState.user?.categoryCode;
      const apolloKey = isSiteUser(categoryCode)
        ? 'claw.site.skill.category'
        : 'claw.prov_head.skill.category';
      const configValue = await fetchApolloConfigValue(apolloKey);
      return configValue || '';
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to resolve categorys filter for enrichment:', err);
      return '';
    }
  }

  /** Raw remote plaza list for local skill category enrichment (no uncategorized filter). */
  private async fetchPlazaSkillMapForLocalEnrichment(
    labelToSlug: Map<string, string>,
    categoryDefs: CategoryDef[],
  ): Promise<{
    skills: Map<string, SkillSummary>;
    navBuckets: Map<string, { slug: string; label: string }>;
  }> {
    const categorys = await this.resolvePlazaCategorysFilter();
    const map = new Map<string, SkillSummary>();
    const navBuckets = new Map<string, { slug: string; label: string }>();

    const ingest = (skills: SkillSummary[], implied?: { slug: string; label: string }) => {
      const normalized = this.normalizeRemotePlazaSkills(skills, labelToSlug).map((s) => {
        const overlaid = this.overlayLocalState(s);
        if (implied) {
          if (overlaid.slug) {
            navBuckets.set(overlaid.slug, implied);
          }
          // Skills listed under a nav tab use that tab's bucket (Apollo-visible categories).
          return {
            ...overlaid,
            categoryCode: implied.slug,
            category: implied.label,
          };
        }
        return overlaid;
      });
      for (const skill of normalized) {
        if (!skill.slug) continue;
        const existing = map.get(skill.slug);
        if (!existing || (!existing.categoryCode && skill.categoryCode)) {
          map.set(skill.slug, skill);
        }
      }
    };

    const fetchPages = async (
      params: SkillPlazaListParams,
      implied?: { slug: string; label: string },
    ) => {
      let page = 1;
      while (true) {
        const result = await this.client.getPlazaSkills(
          { ...params, page, pageSize: 1000 },
          categorys || undefined,
        );
        ingest(result.skills, implied);
        if (!result.hasMore || result.skills.length === 0) break;
        page++;
        if (page > 50) break;
      }
    };

    await fetchPages({ page: 1, pageSize: 1000 });
    for (const cat of categoryDefs) {
      if (!cat.slug) continue;
      await fetchPages({ page: 1, pageSize: 1000, category: cat.slug }, cat);
    }

    return { skills: map, navBuckets };
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
    // Determine user role and fetch the appropriate Apollo config for category filtering
    let queryParams = '';
    try {
      const authState = await getAuthState();
      const categoryCode = authState.user?.categoryCode;
      const apolloKey = isSiteUser(categoryCode)
        ? 'claw.site.skill.category'
        : 'claw.prov_head.skill.category';
      const configValue = await fetchApolloConfigValue(apolloKey);
      if (configValue) {
        queryParams = configValue;
        logger.info(`[SkillPlazaService] getCategories using Apollo config "${apolloKey}": ${configValue}`);
      }
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to resolve category filter config:', err);
    }

    const res = await this.client.getCategories(queryParams || undefined);
    const categories = res.categories || [];

    // Inject "办公" category if not already present
    if (!categories.some((c) => c.slug === OFFICE_CATEGORY_SLUG)) {
      categories.push({ slug: OFFICE_CATEGORY_SLUG, label: OFFICE_CATEGORY_LABEL });
    }

    // Inject "其他" category if not already present
    if (!categories.some((c) => c.slug === 'qita')) {
      categories.push({ slug: 'qita', label: '其他' });
    }

    return categories;
  }

  async getPlazaSkills(params: SkillPlazaListParams): Promise<PlazaListResult> {
    // Resolve categorys filter from Apollo config based on user role
    let categorys = '';
    try {
      const authState = await getAuthState();
      const categoryCode = authState.user?.categoryCode;
      const apolloKey = isSiteUser(categoryCode)
        ? 'claw.site.skill.category'
        : 'claw.prov_head.skill.category';
      const configValue = await fetchApolloConfigValue(apolloKey);
      if (configValue) {
        categorys = configValue;
        logger.info(`[SkillPlazaService] getPlazaSkills using Apollo config "${apolloKey}": ${configValue}`);
      }
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to resolve categorys filter config:', err);
    }

    const isOfficeFilter = params.category === OFFICE_CATEGORY_SLUG;
    const isQitaFilter = params.category === 'qita';
    const hasCategoryFilter = Boolean(params.category && params.category !== '');
    const localOfficeSkills = this.getOfficeSkillsFromLocal(params.q);
    const localPreinstalledOthers = this.getPreinstalledNonOfficeSkillsFromLocal(params.q);

    let labelToSlug = new Map<string, string>();
    try {
      const categories = await this.getCategories();
      labelToSlug = new Map(categories.map((c) => [c.label, c.slug]));
    } catch (err) {
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
      this.normalizeRemotePlazaSkills(result.skills, labelToSlug),
      localOfficeSkills,
      localPreinstalledOthers,
      hasCategoryFilter,
      isQitaFilter,
    );

    // Remote category_counts[''] excludes uncategorized skills; align list on "全部" view.
    if (!hasCategoryFilter) {
      skills = this.filterUncategorizedPlazaSkills(skills);
    }

    // Nav counts always reflect full category panorama (incl. local preinstall),
    // regardless of which category is selected for the card list.
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
    const activeSlugs = readSkillsDirSlugs(this.skillsDir);
    const disabledSlugs = readDisabledDirSlugs(this.getDisabledDir());
    const allSlugs = new Set([...activeSlugs, ...disabledSlugs]);
    const fromLock = readLockJsonSkills(this.configDir);
    const manifestSlugs = readPreinstalledManifestSlugs();

    // 获取 plaza 分类列表，建立 label → slug 映射（权威来源）
    let labelToSlug = new Map<string, string>();
    let categoryDefs: CategoryDef[] = [];
    try {
      categoryDefs = await this.getCategories();
      labelToSlug = new Map(categoryDefs.map((c) => [c.label, c.slug]));
      logger.info(`[getLocalSkills] categories loaded: ${categoryDefs.map((c) => `${c.label}=${c.slug}`).join(', ')}`);
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to fetch categories for local skills:', err);
    }

    // 先拉 plaza 列表，用于补全官方技能的分类信息（含按分类分页拉取）
    let plazaSkillMap = new Map<string, SkillSummary>();
    let navBuckets = new Map<string, { slug: string; label: string }>();
    try {
      const enriched = await this.fetchPlazaSkillMapForLocalEnrichment(labelToSlug, categoryDefs);
      plazaSkillMap = enriched.skills;
      navBuckets = enriched.navBuckets;
      logger.info(`[getLocalSkills] loaded ${plazaSkillMap.size} plaza skills, ${navBuckets.size} nav buckets for categorization`);
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to fetch plaza skills for categorization:', err);
    }

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
              try {
                const detail = await this.getSkillDetail(slug);
                const picked = pickNavCategoryFromApiSkill(detail, categoryDefs);
                resolvedCode = picked.code;
                resolvedLabel = picked.label;
                logger.info(
                  `[getLocalSkills] detail category_codes pick for ${slug}: categoryCode=${resolvedCode}, category=${resolvedLabel}, codes=${JSON.stringify(detail.categoryCodes)}`,
                );
              } catch (detailErr) {
                logger.warn(`[getLocalSkills] getSkillDetail failed for ${slug}:`, detailErr);
              }
            }

            if (!resolvedCode) {
              const navBucket = navBuckets.get(slug);
              if (navBucket) {
                resolvedCode = navBucket.slug;
                resolvedLabel = navBucket.label;
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
          finalCategoryCode = resolvedCode;
          logger.info(`[getLocalSkills] resolved for ${slug}: isOfficial=${isOfficial}, finalCategoryCode=${finalCategoryCode}, finalCategory=${finalCategory}, summary.category=${summary.category}, plazaHas=${plazaSkillMap.has(slug)}`);
        }

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
        skills.push(this.overlayLocalState(baseSkill));
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

  /**
   * 轻量路径：按给定 slug 集合读取本地 install/版本状态，**不**做 category enrichment、
   * **不**调远端（getCategories / fetchPlazaSkillMapForLocalEnrichment / getSkillDetail 全部跳过）。
   * 供首页推荐位等「只需 installed / installedVersion / updateAvailable、不用分类」的场景使用。
   * 未安装的 slug 不返回（消费方靠缺省判定 installed=false）。
   */
  async getLocalSkillsBySlugs(slugs: string[]): Promise<PlazaListResult> {
    const installedSlugs = this.getInstalledSlugs();
    const enabledSlugs = this.getEnabledSlugs();
    const lockEntries = readLockJsonSkillEntries(this.configDir);
    const disabledDir = this.getDisabledDir();

    const skills: SkillSummary[] = [];

    for (const slug of slugs) {
      if (!slug || !installedSlugs.has(slug)) continue;

      const isEnabled = enabledSlugs.has(slug);
      const baseDir = isEnabled ? this.skillsDir : disabledDir;
      const skillDirPath = path.join(baseDir, slug);
      const lockInfo = lockEntries.get(slug);
      const isStoMarketplaceInstall = lockInfo?.source === 'sto-marketplace';
      const lockVersion = isStoMarketplaceInstall ? lockInfo?.version : undefined;
      const skillMdVersion =
        !isPreinstalledSkill(skillDirPath) ? readSkillMdVersion(skillDirPath) : null;
      const installedVersion = resolveInstalledVersionForCompare(lockVersion, skillMdVersion) || undefined;

      const summary = readLocalSkillSummary(baseDir, slug);

      skills.push({
        slug,
        title: summary?.title || slug,
        description: summary?.description || '',
        category: null,
        categoryCode: null,
        source: 'official',
        installed: true,
        enabled: isEnabled,
        points: summary?.points ?? 8,
        icon: summary?.icon,
        defaultPrompt: summary?.defaultPrompt || slug,
        installedVersion,
        // 远端版本由消费方（首页 hook）自行拉云端对比，此处不填
        version: undefined,
        updateAvailable: false,
      });
    }

    return {
      skills,
      categoryCounts: {},
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
    await this.client.recordInstall(slug);
  }

  async recordUninstall(slug: string): Promise<void> {
    await this.client.recordUninstall(slug);
  }

  async toggleSkillEnabled(slug: string, enabled: boolean): Promise<void> {
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
