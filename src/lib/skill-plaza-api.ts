/**
 * Skill Plaza API Client
 * Frontend API methods for the skill marketplace
 */
import { hostApiFetch } from './host-api';
import type { PlazaListResult, SkillDetail, CategoryDef } from '@/types/skill-plaza';

/** Structured code returned by the host when the STO token is not yet ready. */
const AUTH_NOT_READY_CODE = 'AUTH_NOT_READY';

/**
 * Raised when a plaza read is attempted before the STO token is available.
 * The store treats this as a transient loading state and retries, rather than
 * surfacing an error toast.
 */
export class SkillPlazaAuthNotReadyError extends Error {
  constructor(message = 'Skill plaza auth not ready') {
    super(message);
    this.name = 'SkillPlazaAuthNotReadyError';
  }
}

export function isSkillPlazaAuthNotReadyError(err: unknown): err is SkillPlazaAuthNotReadyError {
  return err instanceof SkillPlazaAuthNotReadyError;
}

export interface FetchPlazaListParams {
  q?: string;
  category?: string;
  source?: 'official' | 'mine';
  sort?: 'hot' | 'recent';
  page?: number;
  pageSize?: number;
}

// GET /api/skill-plaza/categories
export async function fetchSkillPlazaCategories(): Promise<CategoryDef[]> {
  const res = await hostApiFetch<{ success: boolean; data?: { categories: CategoryDef[] }; error?: string; code?: string }>(
    '/api/skill-plaza/categories',
  );
  if (!res.success) {
    if (res.code === AUTH_NOT_READY_CODE) throw new SkillPlazaAuthNotReadyError();
    throw new Error(res.error || 'Failed to fetch categories');
  }
  return res.data?.categories || [];
}

// GET /api/skill-plaza/list
export async function fetchSkillPlazaList(params: FetchPlazaListParams = {}): Promise<PlazaListResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.source) qs.set('source', params.source);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));

  const res = await hostApiFetch<{ success: boolean; data?: PlazaListResult; error?: string; code?: string }>(
    `/api/skill-plaza/list?${qs.toString()}`,
  );
  if (!res.success) {
    if (res.code === AUTH_NOT_READY_CODE) throw new SkillPlazaAuthNotReadyError();
    throw new Error(res.error || 'Failed to fetch plaza list');
  }
  return res.data || { skills: [], categoryCounts: {}, hasMore: false, page: 1, pageSize: 20 };
}

// GET /api/skill-plaza/local-skills (scan local skills dir, no remote request)
export async function fetchLocalSkills(): Promise<PlazaListResult> {
  const res = await hostApiFetch<{ success: boolean; data?: PlazaListResult; error?: string; code?: string }>(
    '/api/skill-plaza/local-skills',
  );
  if (!res.success) {
    if (res.code === AUTH_NOT_READY_CODE) throw new SkillPlazaAuthNotReadyError();
    throw new Error(res.error || 'Failed to fetch local skills');
  }
  return res.data || { skills: [], categoryCounts: {}, hasMore: false, page: 1, pageSize: 20 };
}

// GET /api/skill-plaza/local-skills-by-slugs?slugs=a,b,c
// 轻量路径：只按给定 slug 读本地 install/版本状态，不做 category enrichment、不调远端。
// 供首页推荐位等只需 installed / installedVersion / updateAvailable、不用分类的场景。
export async function fetchLocalSkillsBySlugs(slugs: string[]): Promise<PlazaListResult> {
  const qs = new URLSearchParams();
  if (slugs.length) qs.set('slugs', slugs.join(','));
  const res = await hostApiFetch<{ success: boolean; data?: PlazaListResult; error?: string }>(
    `/api/skill-plaza/local-skills-by-slugs?${qs.toString()}`,
  );
  if (!res.success) throw new Error(res.error || 'Failed to fetch local skills by slugs');
  return res.data || { skills: [], categoryCounts: {}, hasMore: false, page: 1, pageSize: 20 };
}

// GET /api/skill-plaza/skill/:slug
export async function fetchSkillDetail(slug: string): Promise<SkillDetail> {
  const res = await hostApiFetch<{ success: boolean; data?: { skill: SkillDetail }; error?: string }>(
    `/api/skill-plaza/skill/${encodeURIComponent(slug)}`,
  );
  if (!res.success) throw new Error(res.error || 'Failed to fetch skill detail');
  if (!res.data?.skill) throw new Error('Skill not found');
  return res.data.skill;
}

export interface InstallPlazaSkillOptions {
  version?: string;
  force?: boolean;
  title?: string;
  description?: string;
}

// POST /api/skill-plaza/install
export async function installPlazaSkill(
  slug: string,
  options: InstallPlazaSkillOptions = {},
): Promise<void> {
  const res = await hostApiFetch<{ success: boolean; error?: string }>('/api/skill-plaza/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      version: options.version,
      force: options.force,
      name: options.title,
      description: options.description,
    }),
  });
  if (!res.success) throw new Error(res.error || 'Install failed');
}

// POST /api/skill-plaza/uninstall
export async function uninstallPlazaSkill(slug: string): Promise<void> {
  const res = await hostApiFetch<{ success: boolean; error?: string }>('/api/skill-plaza/uninstall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  if (!res.success) throw new Error(res.error || 'Uninstall failed');
}

// POST /api/skill-plaza/use
export async function recordSkillUse(slug: string): Promise<void> {
  try {
    await hostApiFetch<{ success: boolean }>('/api/skill-plaza/use', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
  } catch {
    // Fire-and-forget: don't block navigation on use-record failure
  }
}

// POST /api/skill-plaza/toggle
export async function toggleSkillEnabled(slug: string, enabled: boolean): Promise<void> {
  const res = await hostApiFetch<{ success: boolean; error?: string }>('/api/skill-plaza/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, enabled }),
  });
  if (!res.success) throw new Error(res.error || 'Toggle failed');
}

// POST /api/skill-plaza/upload
export async function uploadSkillZip(filePath: string): Promise<string> {
  const res = await hostApiFetch<{ success: boolean; slug?: string; error?: string }>(
    '/api/skill-plaza/upload',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    },
  );
  if (!res.success) throw new Error(res.error || 'Upload failed');
  if (!res.slug) throw new Error('Upload succeeded but no slug returned');
  return res.slug;
}
