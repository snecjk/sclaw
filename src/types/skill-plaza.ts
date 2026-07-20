/**
 * Skill Plaza Type Definitions
 * Types for the skill marketplace / plaza feature
 */

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
  forceUpdate?: boolean;
  isBuiltin?: boolean;
  /** False for official preinstall whitelist skills — UI hides delete. */
  canUninstall?: boolean;
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

export interface PlazaSkillMeta {
  title: string;
  description?: string;
  category: string | null;
  categoryCode: string | null;
  categoryCodes?: string[];
  categoryNames?: string[];
  installCount?: number;
  useCount?: number;
}

export interface PlazaListResult {
  skills: SkillSummary[];
  categoryCounts: Record<string, number>;
  hasMore: boolean;
  page: number;
  pageSize: number;
  total?: number;
}

export type SkillPlazaTab = 'all' | 'mine';
export type SkillPlazaSort = 'hot' | 'recent';
export type SkillPlazaView = 'grid' | 'list';
