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

  async getPlazaSkills(params: SkillPlazaListParams): Promise<PlazaListResult> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category_code', params.category);
    if (params.source) qs.set('source', params.source);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.pageSize !== undefined) qs.set('page_size', String(params.pageSize));

    const query = qs.toString();
    const endpoint = query ? `/agent/v1/skills/plaza?${query}` : '/agent/v1/skills/plaza';
    const raw = await this.request<Record<string, unknown>>('GET', endpoint);
    return convertPlazaListResponse(raw);
  }

  async getMySkills(params: SkillPlazaListParams = {}): Promise<PlazaListResult> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category_code', params.category);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.pageSize !== undefined) qs.set('page_size', String(params.pageSize));

    const query = qs.toString();
    const endpoint = query ? `/agent/v1/skills/plaza/mine?${query}` : '/agent/v1/skills/plaza/mine';
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

function readLockJsonSkills(configDir: string): Set<string> {
  const lockFile = path.join(configDir, '.clawhub', 'lock.json');
  try {
    if (fs.existsSync(lockFile)) {
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      const skills = data?.skills || {};
      return new Set(Object.keys(skills));
    }
  } catch (err) {
    logger.warn('[SkillPlazaService] Failed to read lock.json:', err);
  }
  return new Set();
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
    const fromLock = readLockJsonSkills(this.configDir);
    // 自建 = 本地存在 且 不是从 plaza 安装的（lock.json 中无记录）
    const isLocalOnly = installedSlugs.has(skill.slug) && !fromLock.has(skill.slug);
    return {
      ...skill,
      installed: installedSlugs.has(skill.slug),
      enabled: installedSlugs.has(skill.slug) ? enabledSlugs.has(skill.slug) : undefined,
      source: isLocalOnly ? 'mine' : (skill.source || 'official'),
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

    return categories;
  }

  async getPlazaSkills(params: SkillPlazaListParams): Promise<PlazaListResult> {
    const isOfficeFilter = params.category === OFFICE_CATEGORY_SLUG;
    const hasCategoryFilter = Boolean(params.category && params.category !== '');
    const localOfficeSkills = this.getOfficeSkillsFromLocal(params.q);

    if (isOfficeFilter) {
      // API doesn't know about "办公" category; return local office skills only
      const categoryCounts: Record<string, number> = {};
      categoryCounts[OFFICE_CATEGORY_SLUG] = localOfficeSkills.length;
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

    // Normal request: fetch from API and merge local office skills
    const result = await this.client.getPlazaSkills(params);
    let skills = result.skills.map((s) => this.overlayLocalState(s)).map((s) => {
      if (OFFICE_SKILL_SLUGS.has(s.slug)) {
        return { ...s, category: OFFICE_CATEGORY_LABEL, categoryCode: OFFICE_CATEGORY_SLUG };
      }
      return s;
    });

    // Merge local office skills when not filtering by another category
    if (!hasCategoryFilter) {
      const existingSlugs = new Set(skills.map((s) => s.slug));
      const newLocalSkills = localOfficeSkills.filter((s) => !existingSlugs.has(s.slug));
      if (newLocalSkills.length > 0) {
        skills = [...skills, ...newLocalSkills];
        result.categoryCounts[OFFICE_CATEGORY_SLUG] = (result.categoryCounts[OFFICE_CATEGORY_SLUG] || 0) + newLocalSkills.length;
        result.categoryCounts[''] = (result.categoryCounts[''] || 0) + newLocalSkills.length;
      }
    }

    return {
      ...result,
      skills,
    };
  }

  async getMySkills(params?: SkillPlazaListParams): Promise<PlazaListResult> {
    const isOfficeFilter = params?.category === OFFICE_CATEGORY_SLUG;
    const hasCategoryFilter = Boolean(params?.category && params.category !== '');
    const localOfficeSkills = this.getOfficeSkillsFromLocal(params?.q);

    if (isOfficeFilter) {
      // API doesn't know about "办公" category; return local office skills only
      const categoryCounts: Record<string, number> = {};
      categoryCounts[OFFICE_CATEGORY_SLUG] = localOfficeSkills.length;
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

    // Normal request: fetch from API and merge local office skills
    const result = await this.client.getMySkills(params);
    let skills = result.skills.map((s) => this.overlayLocalState(s)).map((s) => {
      if (OFFICE_SKILL_SLUGS.has(s.slug)) {
        return { ...s, category: OFFICE_CATEGORY_LABEL, categoryCode: OFFICE_CATEGORY_SLUG };
      }
      return s;
    });

    // Merge local office skills when not filtering by another category
    if (!hasCategoryFilter) {
      const existingSlugs = new Set(skills.map((s) => s.slug));
      const newLocalSkills = localOfficeSkills.filter((s) => !existingSlugs.has(s.slug));
      if (newLocalSkills.length > 0) {
        skills = [...skills, ...newLocalSkills];
        result.categoryCounts[OFFICE_CATEGORY_SLUG] = (result.categoryCounts[OFFICE_CATEGORY_SLUG] || 0) + newLocalSkills.length;
        result.categoryCounts[''] = (result.categoryCounts[''] || 0) + newLocalSkills.length;
      }
    }

    return {
      ...result,
      skills,
    };
  }

  async getLocalSkills(): Promise<PlazaListResult> {
    const activeSlugs = readSkillsDirSlugs(this.skillsDir);
    const disabledSlugs = readDisabledDirSlugs(this.getDisabledDir());
    const allSlugs = new Set([...activeSlugs, ...disabledSlugs]);
    const fromLock = readLockJsonSkills(this.configDir);

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
    } catch (err) {
      logger.warn('[SkillPlazaService] Failed to fetch plaza skills for categorization:', err);
    }

    // SKILL.md 里的 category 可能是中文标签，映射到前端 slug
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
    const categoryCounts: Record<string, number> = {};

    for (const slug of allSlugs) {
      const isEnabled = activeSlugs.has(slug);
      const skillDir = isEnabled ? this.skillsDir : this.getDisabledDir();
      const summary = readLocalSkillSummary(skillDir, slug);
      if (summary) {
        const isOfficial = fromLock.has(slug);
        const source = isOfficial ? 'official' : 'mine';

        // 本地没有 category 时，从 plaza 列表匹配
        let rawCategory = summary.category || '';
        if (!rawCategory && isOfficial) {
          const plazaSkill = plazaSkillMap.get(slug);
          rawCategory = plazaSkill?.categoryCode || plazaSkill?.category || '';
        }
        const categorySlug = categoryLabelToSlug[rawCategory] || rawCategory;

        // 强制将特定办公技能归类到"办公"分类
        const isOfficeSkill = OFFICE_SKILL_SLUGS.has(slug);
        const finalCategory = isOfficeSkill ? OFFICE_CATEGORY_LABEL : (rawCategory || summary.category || null);
        const finalCategoryCode = isOfficeSkill ? OFFICE_CATEGORY_SLUG : (categorySlug || null);

        skills.push({
          slug: summary.slug || slug,
          title: summary.title || slug,
          description: summary.description || '',
          category: finalCategory,
          categoryCode: finalCategoryCode,
          source,
          installed: true,
          enabled: isEnabled,
          installCount: 0,
          useCount: 0,
          points: summary.points ?? 8,
          icon: summary.icon,
          defaultPrompt: summary.defaultPrompt || summary.title || slug,
          updatedAt: undefined,
        });

        if (source === 'official') {
          categoryCounts[finalCategoryCode || 'qita'] = (categoryCounts[finalCategoryCode || 'qita'] || 0) + 1;
        } else {
          categoryCounts['mine'] = (categoryCounts['mine'] || 0) + 1;
        }
      }
    }

    categoryCounts[''] = skills.length;

    return {
      skills,
      categoryCounts,
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
      throw new Error(`Failed to move skill directory: ${err}`);
    }
    await setSkillsEnabled([slug], enabled);
  }
}
