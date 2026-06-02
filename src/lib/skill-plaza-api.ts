/**
 * Skill Plaza API Client
 * Frontend API methods for the skill marketplace
 */
import { hostApiFetch } from './host-api';
import type { PlazaListResult, SkillDetail, CategoryDef } from '@/types/skill-plaza';

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
  const res = await hostApiFetch<{ success: boolean; data?: { categories: CategoryDef[] }; error?: string }>(
    '/api/skill-plaza/categories',
  );
  if (!res.success) throw new Error(res.error || 'Failed to fetch categories');
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

  const res = await hostApiFetch<{ success: boolean; data?: PlazaListResult; error?: string }>(
    `/api/skill-plaza/list?${qs.toString()}`,
  );
  if (!res.success) throw new Error(res.error || 'Failed to fetch plaza list');
  return res.data || { skills: [], categoryCounts: {}, hasMore: false, page: 1, pageSize: 20 };
}

// GET /api/skill-plaza/local-skills (scan local skills dir, no remote request)
export async function fetchLocalSkills(): Promise<PlazaListResult> {
  const res = await hostApiFetch<{ success: boolean; data?: PlazaListResult; error?: string }>(
    '/api/skill-plaza/local-skills',
  );
  if (!res.success) throw new Error(res.error || 'Failed to fetch local skills');
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

// POST /api/skill-plaza/install
export async function installPlazaSkill(slug: string): Promise<void> {
  const res = await hostApiFetch<{ success: boolean; error?: string }>('/api/skill-plaza/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
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
