/**
 * Skill Plaza Service
 * Aggregates Python backend API calls with local filesystem state (installed / enabled)
 * to provide a unified data layer for the Skill Plaza UI.
 */
import fs from 'fs';
import path from 'path';
import { getOpenClawConfigDir, getOpenClawSkillsDir } from '../utils/paths';
import { setSkillsEnabled } from '../utils/skill-config';
import { getStoToken, getAuthState, isSiteUser } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import { fetchApolloConfigValue } from './sto-apollo-config-service';
import {
  isRemoteVersionNewer,
  resolveInstalledVersionForCompare,
} from '../utils/skill-version';
import { PREINSTALLED_MARKER_NAME } from './sto-skill-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillSummary {
  slug: string;
  title: string;
  description: string;
  category: string | null;
  categoryCode: string | null;
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
  const converted = convertKeysToCamelCase<SkillDetail>(raw);
  return normalizeSkillDetail(converted);
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

// ---------------------------------------------------------------------------
// Local state helpers
// ---------------------------------------------------------------------------

function readLockJsonSkillEntries(configDir: string): Map<string, {
  version?: string;
  source?: string;
  versionSource?: string;
}> {
  const lockFile = path.join(configDir, '.clawhub', 'lock.json');
  const entries = new Map<string, { version?: string; source?: string; versionSource?: string }>();
  try {
    if (fs.existsSync(lockFile)) {
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      const skills = data?.skills || {};
      for (const [slug, info] of Object.entries(skills)) {
        if (info && typeof info === 'object') {
          const record = info as { version?: string; source?: string; versionSource?: string };
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

function readSkillMdVersion(skillDir: string): string | null {
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) return null;
    const raw = fs.readFileSync(skillMdPath, 'utf8');
    const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;
    const versionMatch = frontmatterMatch[1].match(/^\s*version\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (!versionMatch) return null;
    return versionMatch[1].trim() || null;
  } catch {
    return null;
  }
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
      const content = fs.readFileSync(skillMdPath, 'utf8');
      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (frontMatterMatch) {
        const frontMatter = frontMatterMatch[1];
        const lines = frontMatter.split('\n');
        const meta: Record<string, string> = {};
        for (const line of lines) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
            meta[key] = value;
          }
        }
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
    const isLocalOnly = false;
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

    if (isOfficeFilter) {
      // API doesn't know about "办公" category; return local office skills only
      const categoryCounts: Record<string, number> = {};
      categoryCounts[OFFICE_CATEGORY_SLUG] = localOfficeSkills.length;
      categoryCounts['qita'] = localPreinstalledOthers.length;
      categoryCounts[''] = localOfficeSkills.length;

      return {
        skills: localOfficeSkills,
        categoryCounts,
        hasMore: false,
        page: 1,
        pageSize: localOfficeSkills.length,
        total: localOfficeSkills.length,
      };
    }

    // Normal request: fetch from API and merge local preinstalled skills
    const result = await this.client.getPlazaSkills(params, categorys || undefined);
    let skills = result.skills.map((s) => this.overlayLocalState(s)).map((s) => {
      if (OFFICE_SKILL_SLUGS.has(s.slug)) {
        return { ...s, category: OFFICE_CATEGORY_LABEL, categoryCode: OFFICE_CATEGORY_SLUG };
      }
      return s;
    });

    // Merge local preinstalled skills
    const existingSlugs = new Set(skills.map((s) => s.slug));
    const newLocalOffice = localOfficeSkills.filter((s) => !existingSlugs.has(s.slug));
    const newLocalOthers = localPreinstalledOthers.filter((s) => !existingSlugs.has(s.slug));

    if (!hasCategoryFilter) {
      if (newLocalOffice.length > 0) {
        skills = [...skills, ...newLocalOffice];
      }
      if (newLocalOthers.length > 0) {
        skills = [...skills, ...newLocalOthers];
      }
    } else if (isQitaFilter) {
      if (newLocalOthers.length > 0) {
        skills = [...skills, ...newLocalOthers];
      }
    }

    // Update category counts: only add *new* local skills (deduped against remote)
    const newLocalCount = newLocalOffice.length + newLocalOthers.length;
    result.categoryCounts[''] = (result.categoryCounts[''] || 0) + newLocalCount;
    result.categoryCounts[OFFICE_CATEGORY_SLUG] = (result.categoryCounts[OFFICE_CATEGORY_SLUG] || 0) + newLocalOffice.length;
    result.categoryCounts['qita'] = (result.categoryCounts['qita'] || 0) + newLocalOthers.length;

    return {
      ...result,
      skills,
      total: (result.total || 0) + newLocalOffice.length + newLocalOthers.length,
    };
  }

  async getLocalSkills(): Promise<PlazaListResult> {
    const activeSlugs = readSkillsDirSlugs(this.skillsDir);
    const disabledSlugs = readDisabledDirSlugs(this.getDisabledDir());
    const allSlugs = new Set([...activeSlugs, ...disabledSlugs]);
    const fromLock = readLockJsonSkills(this.configDir);

    // 获取 plaza 分类列表，建立 label → slug 映射（权威来源）
    let labelToSlug = new Map<string, string>();
    try {
      const categories = await this.getCategories();
      labelToSlug = new Map(categories.map((c) => [c.label, c.slug]));
      logger.info(`[getLocalSkills] categories loaded: ${categories.map((c) => `${c.label}=${c.slug}`).join(', ')}`);
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to fetch categories for local skills:', err);
    }

    // 先拉 plaza 列表，用于补全官方技能的分类信息（循环拉取全部）
    let plazaSkillMap = new Map<string, SkillSummary>();
    try {
      const allPlazaSkills: SkillSummary[] = [];
      let page = 1;
      while (true) {
        const result = await this.getPlazaSkills({ page, pageSize: 100 });
        allPlazaSkills.push(...result.skills);
        if (!result.hasMore || result.skills.length === 0) break;
        page++;
        if (page > 50) break; // safety limit
      }
      plazaSkillMap = new Map(allPlazaSkills.map((s) => [s.slug, s]));
      logger.info(`[getLocalSkills] loaded ${allPlazaSkills.length} plaza skills for categorization`);
      // 打印 plaza 技能的分类信息样本（用于排查）
      for (const [s, skill] of plazaSkillMap.entries()) {
        logger.info(`[getLocalSkills] plaza skill sample: slug=${s}, category=${skill.category}, categoryCode=${skill.categoryCode}`);
      }
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
        const isOfficial = fromLock.has(slug) || plazaSkill?.source === 'official';
        const source: 'official' | 'mine' = isOfficial ? 'official' : 'mine';

        // 判断是否为预安装技能（通过 .stoclaw-preinstalled.json marker 文件）
        const skillDirPath = isEnabled ? path.join(this.skillsDir, slug) : path.join(this.getDisabledDir(), slug);
        const isPreinstalled = isPreinstalledSkill(skillDirPath);
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
        } else {
          // 优先使用 plaza 权威数据（categoryCode + category）
          let resolvedCode: string | null = null;
          let resolvedLabel: string | null = null;

          if (isOfficial) {
            const plazaSkill = plazaSkillMap.get(slug);
            if (plazaSkill) {
              // 部分 plaza 接口 categoryCode 可能为空字符串，但 category（中文 label）可靠
              resolvedCode = plazaSkill.categoryCode || null;
              resolvedLabel = plazaSkill.category || null;

              // 若 categoryCode 缺失但 label 存在，通过分类列表反查 slug
              if (!resolvedCode && resolvedLabel) {
                resolvedCode = labelToSlug.get(resolvedLabel) || null;
              }

              // 若 plaza 列表中既无 categoryCode 也无 category，尝试调详情接口补全
              if (!resolvedCode && !resolvedLabel) {
                try {
                  const detail = await this.getSkillDetail(slug);
                  resolvedCode = detail.categoryCode || null;
                  resolvedLabel = detail.category || null;
                  if (!resolvedCode && resolvedLabel) {
                    resolvedCode = labelToSlug.get(resolvedLabel) || null;
                  }
                  logger.info(`[getLocalSkills] detail fallback for ${slug}: categoryCode=${resolvedCode}, category=${resolvedLabel}`);
                } catch (detailErr) {
                  logger.warn(`[getLocalSkills] getSkillDetail failed for ${slug}:`, detailErr);
                }
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

        const baseSkill: SkillSummary = {
          slug: summary.slug || slug,
          title: summary.title || slug,
          description: summary.description || '',
          category: finalCategory,
          categoryCode: finalCategoryCode,
          source,
          installed: true,
          enabled: isEnabled,
          installCount: plazaSkill?.installCount ?? 0,
          useCount: plazaSkill?.useCount ?? 0,
          points: summary.points ?? plazaSkill?.points ?? 8,
          icon: summary.icon ?? plazaSkill?.icon,
          defaultPrompt: summary.defaultPrompt || summary.title || slug,
          updatedAt: plazaSkill?.updatedAt,
          version: plazaSkill?.version,
        };
        skills.push(this.overlayLocalState(baseSkill));
      }
    }

    // 基于实际返回的 skills 数组计算分类计数，确保 categoryCounts 与 skills 严格一致
    // 规则：所有技能（官方/预安装/自建）都按实际 categoryCode 归类；
    //       未分类技能（categoryCode 为 null）只在"全部"（''）中计数，不计入任何具体分类
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
    await this.client.recordInstall(slug);
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
    await setSkillsEnabled([slug], enabled);
  }
}
