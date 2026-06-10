/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type { Skill, MarketplaceSkill } from '../types/skill';

type GatewaySkillStatus = {
  skillKey: string;
  slug?: string;
  name?: string;
  title?: string;
  description?: string;
  disabled?: boolean;
  emoji?: string;
  version?: string;
  author?: string;
  config?: Record<string, unknown>;
  bundled?: boolean;
  always?: boolean;
  source?: string;
  baseDir?: string;
  filePath?: string;
};

type GatewaySkillsStatusResult = {
  skills?: GatewaySkillStatus[];
};

type ClawHubListResult = {
  slug: string;
  version?: string;
  source?: string;
  baseDir?: string;
};

type StoListResult = {
  slug: string;
  name?: string;
  title?: string;
  description?: string;
  author?: string;
  version?: string;
  source?: string;
  baseDir?: string;
};

function mapErrorCodeToSkillErrorKey(
  code: AppError['code'],
  operation: 'fetch' | 'search' | 'install',
): string {
  if (code === 'TIMEOUT') {
    return operation === 'search'
      ? 'searchTimeoutError'
      : operation === 'install'
        ? 'installTimeoutError'
        : 'fetchTimeoutError';
  }
  if (code === 'RATE_LIMIT') {
    return operation === 'search'
      ? 'searchRateLimitError'
      : operation === 'install'
        ? 'installRateLimitError'
        : 'fetchRateLimitError';
  }
  return 'rateLimitError';
}

interface SkillsState {
  skills: Skill[];
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;

  // STO skill plaza state
  stoSearchResults: MarketplaceSkill[];
  stoSearching: boolean;
  stoSearchError: string | null;
  stoInstalling: Record<string, boolean>;

  // Actions
  fetchSkills: () => Promise<void>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;

  // STO actions
  searchStoSkills: (query: string) => Promise<void>;
  installStoSkill: (slug: string, version?: string, meta?: { name?: string; description?: string; author?: string }, agentId?: string) => Promise<void>;
  uninstallStoSkill: (slug: string, agentId?: string) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,

  // STO state
  stoSearchResults: [],
  stoSearching: false,
  stoSearchError: null,
  stoInstalling: {},

  fetchSkills: async () => {
    // Only show loading state if we have no skills yet (initial load)
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    } else {
      set({ error: null });
    }
    try {
      // 1. Fetch from Gateway (running skills)
      const gatewayData = await useGatewayStore.getState().rpc<GatewaySkillsStatusResult>('skills.status');

      // 2. Fetch from ClawHub (installed on disk)
      const clawhubResult = await hostApiFetch<{ success: boolean; results?: ClawHubListResult[]; error?: string }>('/api/clawhub/list');

      // 3. Fetch configurations directly from Electron (since Gateway doesn't return them)
      const configResult = await hostApiFetch<Record<string, { apiKey?: string; env?: Record<string, string> }>>('/api/skills/configs');

      let combinedSkills: Skill[] = [];
      const currentSkills = get().skills;

      // Map gateway skills info
      if (gatewayData.skills) {
        combinedSkills = gatewayData.skills.map((s: GatewaySkillStatus) => {
          // Merge with direct config if available
          const directConfig = configResult[s.skillKey] || {};

          return {
            id: s.skillKey,
            slug: s.slug || s.skillKey,
            name: s.name || s.skillKey,
            title: s.title,
            description: s.description || '',
            enabled: !s.disabled,
            icon: s.emoji || '📦',
            version: s.version || '1.0.0',
            author: s.author,
            config: {
              ...(s.config || {}),
              ...directConfig,
            },
            isCore: s.bundled && s.always,
            isBundled: s.bundled,
            source: s.source,
            baseDir: s.baseDir,
            filePath: s.filePath,
          };
        });
      } else if (currentSkills.length > 0) {
        // ... if gateway down ...
        combinedSkills = [...currentSkills];
      }

      // Merge with ClawHub results
      if (clawhubResult.success && clawhubResult.results) {
        clawhubResult.results.forEach((cs: ClawHubListResult) => {
          const existing = combinedSkills.find(s => s.id === cs.slug);
          if (existing) {
            if (!existing.baseDir && cs.baseDir) {
              existing.baseDir = cs.baseDir;
            }
            if (!existing.source && cs.source) {
              existing.source = cs.source;
            }
            return;
          }
          const directConfig = configResult[cs.slug] || {};
          combinedSkills.push({
            id: cs.slug,
            slug: cs.slug,
            name: cs.slug,
            description: 'Recently installed, initializing...',
            enabled: false,
            icon: '⌛',
            version: cs.version || 'unknown',
            author: undefined,
            config: directConfig,
            isCore: false,
            isBundled: false,
            source: cs.source || 'openclaw-managed',
            baseDir: cs.baseDir,
          });
        });
      }

      // 4. Merge with STO disk scan (skills installed from STO marketplace)
      // This allows newly installed STO skills to appear immediately
      // without waiting for a Gateway restart.
      try {
        const stoListResult = await hostApiFetch<{ success: boolean; results?: StoListResult[] }>('/api/sto-skills/list');
        if (stoListResult.success && stoListResult.results) {
          stoListResult.results.forEach((ss: StoListResult) => {
            // Match by slug/id OR by baseDir (Gateway may use a different
            // skillKey than the directory name, e.g. reading name from SKILL.md)
            // Use case-insensitive comparison because Gateway lowercases the name.
            const existing = combinedSkills.find(s =>
              s.id.toLowerCase() === ss.slug.toLowerCase()
              || (s.slug && s.slug.toLowerCase() === ss.slug.toLowerCase())
              || (ss.baseDir && s.baseDir && s.baseDir === ss.baseDir)
            );
            if (existing) {
              if (!existing.baseDir && ss.baseDir) {
                existing.baseDir = ss.baseDir;
              }
              // Only override source for STO-marketplace skills
              if (ss.source === 'sto-marketplace') {
                existing.source = ss.source;
              }
              // Update slug to ensure correct uninstall path
              // (Gateway may return lowercase skillKey instead of original slug)
              if (ss.slug) {
                existing.slug = ss.slug;
              }
              // Update title/name from local disk metadata
              if (ss.title) {
                existing.title = ss.title;
              }
              if (ss.name && existing.name === existing.id) {
                existing.name = ss.name;
              }
              // Update description/author from lock.json metadata
              if (ss.description && (!existing.description || existing.description === '')) {
                existing.description = ss.description;
              }
              if (ss.author && !existing.author) {
                existing.author = ss.author;
              }
              return;
            }
            combinedSkills.push({
              id: ss.slug,
              slug: ss.slug,
              name: ss.name || ss.slug,
              title: ss.title,
              description: ss.description || 'STO 技能已安装，等待网关加载...',
              enabled: false,
              icon: '⌛',
              version: ss.version || 'unknown',
              author: ss.author,
              config: {},
              isCore: false,
              isBundled: false,
              source: ss.source || 'sto-marketplace',
              baseDir: ss.baseDir,
            });
          });
        }
      } catch {
        // STO list is best-effort, don't block on failure
      }

      // 5. Supplement title from local skill plaza scan (covers preinstalled skills)
      try {
        type PlazaSkill = { slug: string; title: string };
        const plazaResult = await hostApiFetch<{ success: boolean; data?: { skills: PlazaSkill[] } }>(
          '/api/skill-plaza/local-skills',
        );
        if (plazaResult.success && plazaResult.data?.skills) {
          plazaResult.data.skills.forEach((ps) => {
            const existing = combinedSkills.find(
              (s) =>
                s.id.toLowerCase() === ps.slug.toLowerCase() ||
                (s.slug && s.slug.toLowerCase() === ps.slug.toLowerCase()),
            );
            if (existing && ps.title && !existing.title) {
              existing.title = ps.title;
            }
          });
        }
      } catch {
        // Best-effort title supplement
      }

      set({ skills: combinedSkills, loading: false, error: null });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      set({ loading: false, error: mapErrorCodeToSkillErrorKey(appError.code, 'fetch') });
    }
  },

  searchSkills: async (query: string) => {
    set({ searching: true, searchError: null });
    try {
      const result = await hostApiFetch<{ success: boolean; results?: MarketplaceSkill[]; error?: string }>('/api/clawhub/search', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        throw normalizeAppError(new Error(result.error || 'Search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      set({ searchError: mapErrorCodeToSkillErrorKey(appError.code, 'search') });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/install', {
        method: 'POST',
        body: JSON.stringify({ slug, version }),
      });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        throw new Error(mapErrorCodeToSkillErrorKey(appError.code, 'install'));
      }
      // Refresh skills after install
      await get().fetchSkills();
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  uninstallSkill: async (slug: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/uninstall', {
        method: 'POST',
        body: JSON.stringify({ slug }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      // Refresh skills after uninstall
      await get().fetchSkills();
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  enableSkill: async (skillId) => {
    const { updateSkill } = get();

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: true });
      updateSkill(skillId, { enabled: true });
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    const { updateSkill, skills } = get();

    const skill = skills.find((s) => s.id === skillId);
    if (skill?.isCore) {
      throw new Error('Cannot disable core skill');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: false });
      updateSkill(skillId, { enabled: false });
    } catch (error) {
      console.error('Failed to disable skill:', error);
      throw error;
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill
      ),
    }));
  },

  // ======================== STO Skill Plaza Actions ========================

  searchStoSkills: async (query: string) => {
    set({ stoSearching: true, stoSearchError: null });
    try {
      const result = await hostApiFetch<{ success: boolean; results?: MarketplaceSkill[]; error?: string }>('/api/sto-skills/search', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      if (result.success) {
        set({ stoSearchResults: result.results || [] });
      } else {
        throw normalizeAppError(new Error(result.error || 'STO search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      set({ stoSearchError: mapErrorCodeToSkillErrorKey(appError.code, 'search') });
    } finally {
      set({ stoSearching: false });
    }
  },

  installStoSkill: async (slug: string, version?: string, meta?: { name?: string; description?: string; author?: string }, agentId?: string) => {
    set((state) => ({ stoInstalling: { ...state.stoInstalling, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/sto-skills/install', {
        method: 'POST',
        body: JSON.stringify({ slug, version, force: true, name: meta?.name, description: meta?.description, author: meta?.author, agentId }),
      });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'STO install failed'), {
          module: 'skills',
          operation: 'install',
        });
        throw new Error(mapErrorCodeToSkillErrorKey(appError.code, 'install'));
      }
      // Restart gateway so it picks up the newly installed skill
      await useGatewayStore.getState().restart();
      // Refresh skills after gateway restart
      await get().fetchSkills();
    } catch (error) {
      console.error('STO install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.stoInstalling };
        delete newInstalling[slug];
        return { stoInstalling: newInstalling };
      });
    }
  },

  uninstallStoSkill: async (slug: string, agentId?: string) => {
    set((state) => ({ stoInstalling: { ...state.stoInstalling, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/sto-skills/uninstall', {
        method: 'POST',
        body: JSON.stringify({ slug, agentId }),
      });
      if (!result.success) {
        throw new Error(result.error || 'STO uninstall failed');
      }
      await get().fetchSkills();
    } catch (error) {
      console.error('STO uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.stoInstalling };
        delete newInstalling[slug];
        return { stoInstalling: newInstalling };
      });
    }
  },
}));
