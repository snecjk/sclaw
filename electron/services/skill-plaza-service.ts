/**
 * Skill Plaza Service
 * Aggregates Python backend API calls with local filesystem state (installed / enabled)
 * to provide a unified data layer for the Skill Plaza UI.
 */
import fs from 'fs';
import path from 'path';
import { getOpenClawConfigDir, getOpenClawSkillsDir } from '../utils/paths';
import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';

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

  async getCategories(): Promise<{ categories: CategoryDef[] }> {
    return this.request<{ categories: CategoryDef[] }>('GET', '/agent/v1/skills/plaza/categories');
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

function readOpenClawEnabledSkills(configDir: string): Set<string> {
  const configPath = path.join(configDir, 'openclaw.json');
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const entries = data?.skills?.entries || {};
      const enabled = new Set<string>();
      for (const [slug, entry] of Object.entries(entries)) {
        if (typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).enabled === true) {
          enabled.add(slug);
        }
      }
      return enabled;
    }
  } catch (err) {
    logger.warn('[SkillPlazaService] Failed to read openclaw.json:', err);
  }
  return new Set();
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

  private getInstalledSlugs(): Set<string> {
    const fromLock = readLockJsonSkills(this.configDir);
    const fromDir = readSkillsDirSlugs(this.skillsDir);
    return new Set([...fromLock, ...fromDir]);
  }

  private getEnabledSlugs(): Set<string> {
    return readOpenClawEnabledSkills(this.configDir);
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

  // ---- Public API ----

  async getCategories(): Promise<CategoryDef[]> {
    const res = await this.client.getCategories();
    return res.categories || [];
  }

  async getPlazaSkills(params: SkillPlazaListParams): Promise<PlazaListResult> {
    const result = await this.client.getPlazaSkills(params);
    return {
      ...result,
      skills: result.skills.map((s) => this.overlayLocalState(s)),
    };
  }

  async getMySkills(params?: SkillPlazaListParams): Promise<PlazaListResult> {
    const result = await this.client.getMySkills(params);
    return {
      ...result,
      skills: result.skills.map((s) => this.overlayLocalState(s)),
    };
  }

  async getLocalSkills(): Promise<PlazaListResult> {
    const slugs = readSkillsDirSlugs(this.skillsDir);
    const fromLock = readLockJsonSkills(this.configDir);
    const enabledSlugs = this.getEnabledSlugs();

    const skills: SkillSummary[] = [];
    for (const slug of slugs) {
      const summary = readLocalSkillSummary(this.skillsDir, slug);
      if (summary) {
        const isOfficial = fromLock.has(slug);
        skills.push({
          slug: summary.slug || slug,
          title: summary.title || slug,
          description: summary.description || '',
          category: summary.category || null,
          categoryCode: summary.categoryCode || null,
          source: isOfficial ? 'official' : 'mine',
          installed: true,
          enabled: enabledSlugs.has(slug),
          installCount: 0,
          useCount: 0,
          points: summary.points ?? 8,
          icon: summary.icon,
          defaultPrompt: summary.defaultPrompt || summary.title || slug,
          updatedAt: undefined,
        });
      }
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
    return this.overlayLocalState(detail);
  }

  async recordUse(slug: string): Promise<void> {
    await this.client.recordUse(slug);
  }
}
