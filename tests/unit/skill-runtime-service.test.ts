import { describe, expect, it } from 'vitest';
import {
  isPathInsideSkillRoot,
  scoreRuntimeSkill,
} from '../../electron/services/skills/skill-runtime-service';

describe('skill runtime service', () => {
  it('scores exact and descriptive catalog matches', () => {
    const pkg = {
      slug: 'spreadsheets',
      sourceDir: 'D:/skills/spreadsheets',
      version: '1',
      enabled: true,
      scope: 'global' as const,
      source: 'test',
      name: 'Spreadsheets',
      description: 'Create and edit Excel workbooks',
    };
    expect(scoreRuntimeSkill('spreadsheets', pkg)).toBeGreaterThan(1_000);
    expect(scoreRuntimeSkill('please create an Excel workbook', pkg)).toBeGreaterThan(0);
    expect(scoreRuntimeSkill('compose music', pkg)).toBe(0);
  });

  it('rejects resolved paths outside the real skill root', () => {
    if (process.platform === 'win32') {
      expect(isPathInsideSkillRoot('C:\\skills\\docs', 'C:\\skills\\docs\\references\\guide.md')).toBe(true);
      expect(isPathInsideSkillRoot('C:\\skills\\docs', 'C:\\skills\\other\\secret.md')).toBe(false);
    } else {
      expect(isPathInsideSkillRoot('/skills/docs', '/skills/docs/references/guide.md')).toBe(true);
      expect(isPathInsideSkillRoot('/skills/docs', '/skills/other/secret.md')).toBe(false);
    }
  });
});
