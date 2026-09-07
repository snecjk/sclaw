import { describe, expect, it } from 'vitest';
import {
  extractClaudeSkillSlugs,
  extractPiReadPaths,
  resolvePiReadSkillSlug,
} from '../../electron/services/skills/session-skill-usage';

describe('session skill usage attribution', () => {
  it('attributes only completed Claude Skill tool calls', () => {
    expect(extractClaudeSkillSlugs([
      { type: 'tool_use', name: 'Skill', input: { skill: 'Spreadsheets' } },
      { type: 'tool_use', name: 'Read', input: { path: '/tmp/SKILL.md' } },
      { type: 'text', text: 'using pdf' },
    ])).toEqual(['spreadsheets']);
  });

  it('extracts PI read calls without treating normal tools as skill use', () => {
    expect(extractPiReadPaths({ content: [
      { type: 'toolCall', name: 'read', arguments: { path: 'C:\\skills\\pdf\\SKILL.md' } },
      { type: 'toolCall', name: 'bash', arguments: { command: 'type SKILL.md' } },
    ] })).toEqual(['C:\\skills\\pdf\\SKILL.md']);
  });

  it('maps only absolute paths inside an active Skill directory', () => {
    const selected = [{ slug: 'pdf', sourceDir: 'C:\\skills\\pdf' }];
    expect(resolvePiReadSkillSlug(selected, 'C:\\skills\\pdf\\SKILL.md')).toBe('pdf');
    expect(resolvePiReadSkillSlug(selected, 'C:\\skills\\pdf\\references\\api.md')).toBe('pdf');
    expect(resolvePiReadSkillSlug(selected, 'C:\\skills\\pdf\\scripts\\convert.js')).toBeUndefined();
    expect(resolvePiReadSkillSlug(selected, 'C:\\skills\\pdf-tools\\SKILL.md')).toBeUndefined();
    expect(resolvePiReadSkillSlug(selected, 'references\\api.md')).toBeUndefined();
  });
});
