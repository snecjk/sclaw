import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_SKILL_RULES,
  getDefaultEngineSkillSlugs,
} from '../../electron/services/skills/default-engine-skills';

describe('default engine Skills', () => {
  it('keeps reviewed baseline Skills in both engine start-of-turn sets', () => {
    expect(DEFAULT_ENGINE_SKILL_RULES).toContainEqual({
      slug: 'sai-cli',
      engines: ['claude', 'pi'],
    });
    expect(getDefaultEngineSkillSlugs({ engine: 'claude', mode: 'interactive' })).toContain('sai-cli');
    expect(getDefaultEngineSkillSlugs({ engine: 'pi', mode: 'scheduled' })).toContain('sai-cli');
  });
});
