import type { SclawAgentEngine, SclawAgentSessionMode } from '../../../shared/agent-extensions/types';

export interface DefaultEngineSkillRule {
  slug: string;
  engines?: readonly SclawAgentEngine[];
  modes?: readonly SclawAgentSessionMode[];
}

/**
 * SClaw-owned baseline Skills. Add reviewed foundational Skills here when they
 * should be present in the engine's normal start-of-turn Skill set.
 */
export const DEFAULT_ENGINE_SKILL_RULES: readonly DefaultEngineSkillRule[] = [
  { slug: 'sai-cli', engines: ['claude', 'pi'] },
];

export function getDefaultEngineSkillSlugs(input: {
  engine: SclawAgentEngine;
  mode: SclawAgentSessionMode;
}): string[] {
  return DEFAULT_ENGINE_SKILL_RULES
    .filter((rule) => !rule.engines || rule.engines.includes(input.engine))
    .filter((rule) => !rule.modes || rule.modes.includes(input.mode))
    .map((rule) => rule.slug.trim().toLowerCase())
    .filter(Boolean);
}
