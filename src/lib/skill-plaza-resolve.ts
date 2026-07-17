import { useSkillPlazaStore } from '@/stores/skill-plaza';

export interface ResolvedSkillPrompt {
  slug: string;
  title: string;
  defaultPrompt: string;
}

/** Resolve skill title / defaultPrompt from plaza store caches (sync). */
export function resolveSkillFromPlaza(slug: string): ResolvedSkillPrompt {
  const state = useSkillPlazaStore.getState();
  const skill = [...state.plazaSkills, ...state.mySkills].find((s) => s.slug === slug);
  if (!skill) {
    return { slug, title: slug, defaultPrompt: slug };
  }
  const title = skill.title?.trim() || slug;
  const defaultPrompt = skill.defaultPrompt?.trim() || title;
  return { slug: skill.slug, title, defaultPrompt };
}
