import { fetchSkillDetail } from '@/lib/skill-plaza-api';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillSummary } from '@/types/skill-plaza';

export interface ResolvedSkillPrompt {
  slug: string;
  title: string;
  defaultPrompt: string;
}

function toResolvedPrompt(skill: SkillSummary): ResolvedSkillPrompt {
  const title = skill.title?.trim() || skill.slug;
  const fromSkill = skill.defaultPrompt?.trim() || '';
  return {
    slug: skill.slug,
    title,
    // 有真实指令用指令；否则仅在 title≠slug 时用标题。禁止用裸 slug 当 prompt（会污染气泡）。
    defaultPrompt: fromSkill || (title !== skill.slug ? title : ''),
  };
}

function lookupCachedSkill(slug: string): SkillSummary | undefined {
  const state = useSkillPlazaStore.getState();
  return [...state.plazaSkills, ...state.mySkills].find((s) => s.slug === slug)
    ?? state.getCachedSkillDetail(slug);
}

/** Resolve skill title / defaultPrompt from plaza store caches (sync). */
export function resolveSkillFromPlaza(slug: string): ResolvedSkillPrompt {
  const skill = lookupCachedSkill(slug);
  if (!skill) {
    // 禁止用 slug 冒充 defaultPrompt——会写进 gateway 再回显成气泡脏前缀（如单独一行 `html`）。
    return { slug, title: slug, defaultPrompt: '' };
  }
  return toResolvedPrompt(skill);
}

/**
 * Plaza caches are only filled by the plaza page and the composer skill picker.
 * Entry points such as the home recommend cards leave them empty, where the sync
 * lookup degrades to the slug — sending that as the prompt means the model never
 * receives the skill instructions. Fetch the detail once so those entries work too.
 */
export async function resolveSkillPrompt(slug: string): Promise<ResolvedSkillPrompt> {
  const cached = lookupCachedSkill(slug);
  if (cached) return toResolvedPrompt(cached);

  try {
    const detail = await fetchSkillDetail(slug);
    useSkillPlazaStore.getState().setSkillDetailCache(slug, detail);
    return toResolvedPrompt(detail);
  } catch {
    // 与 sync fallback 一致：宁可缺 prompt，也不要把 slug 当指令/UI 前缀发出去。
    return { slug, title: slug, defaultPrompt: '' };
  }
}
