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

    const raw = await this.request<Record<string, unknown>>('GET', `/agent/v1/skills/plaza?${qs.toString()}`);
    return convertPlazaListResponse(raw);
  }

  async getMySkills(): Promise<PlazaListResult> {
    const raw = await this.request<Record<string, unknown>>('GET', '/agent/v1/skills/plaza/mine');
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
    return {
      ...skill,
      installed: installedSlugs.has(skill.slug),
      enabled: installedSlugs.has(skill.slug) ? enabledSlugs.has(skill.slug) : undefined,
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

  async getMySkills(): Promise<PlazaListResult> {
    const result = await this.client.getMySkills();
    return {
      ...result,
      skills: result.skills.map((s) => this.overlayLocalState(s)),
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
