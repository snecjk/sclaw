import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSkillMarkdown, readSkillMdFrontmatter } from '../../electron/utils/skill-frontmatter';
import { ensureSkillFrontmatter } from '../../electron/services/skills/skill-package';

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const dirs: string[] = [];
function fixture(content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-bom-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Windows skill markdown encoding', () => {
  it.each(['\n', '\r\n'])('reads Chinese metadata with and without BOM (%j)', (eol) => {
    for (const bom of ['', '\uFEFF']) {
      const dir = fixture(bom + ['---', 'name: demo', 'title: 中文技能', 'description: 技能说明', '---', '# 正文'].join(eol));
      expect(readSkillMdFrontmatter(dir)).toMatchObject({ name: 'demo', title: '中文技能', description: '技能说明' });
    }
  });

  it('only removes the leading BOM and preserves body whitespace', () => {
    expect(normalizeSkillMarkdown('\uFEFF---\r\n  正文\uFEFF  \r\n'))
      .toBe('---\n  正文\uFEFF  \n');
  });

  it('removes BOM on install even when metadata needs no changes', () => {
    const content = '---\nname: demo\ntitle: 中文技能\ndescription: 说明\n---\n\n正文\n';
    const dir = fixture('\uFEFF' + content.replace(/\n/g, '\r\n'));
    ensureSkillFrontmatter(dir, 'demo', {});
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe(content);
    expect(readSkillMdFrontmatter(dir)?.title).toBe('中文技能');
  });

  it('does not fabricate metadata for a document without frontmatter', () => {
    expect(readSkillMdFrontmatter(fixture('\uFEFF# 正文'))).toBeNull();
  });

  it('renames an existing display title while preserving the slug and body', () => {
    const dir = fixture('---\nname: weather\ntitle: Old name\ndescription: demo\n---\n\n# Body\n');
    ensureSkillFrontmatter(dir, 'weather', { name: '上海天气: 今日' });
    expect(readSkillMdFrontmatter(dir)).toMatchObject({ name: 'weather', title: '上海天气: 今日', description: 'demo' });
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toContain('\n---\n\n# Body\n');
  });
});
