import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyAppThemeOverrides,
  readAppDesignTokens,
  putAppArtifacts,
  listAppArtifacts,
} from '../../electron/services/app-dev-service';

describe('app-dev theme / artifacts service (T06/T09)', () => {
  it('reads degraded defaults when contract missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-theme-'));
    const contract = await readAppDesignTokens(root);
    expect(contract.degraded).toBe(true);
    expect(contract.tokens.length).toBeGreaterThan(0);
  });

  it('applies theme.css variable overrides by line replace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-theme-'));
    await mkdir(join(root, 'src', 'theme'), { recursive: true });
    await writeFile(
      join(root, 'src', 'theme', 'theme.css'),
      `:root {\n  --sto-color-primary: #ff6700;\n  --sto-radius-lg: 8px;\n}\n`,
      'utf8',
    );
    const result = await applyAppThemeOverrides(root, {
      '--sto-color-primary': 'oklch(0.7 0.18 50)',
      '--sto-radius-lg': '0.75rem',
    });
    expect(result.updated).toEqual(expect.arrayContaining([
      '--sto-color-primary',
      '--sto-radius-lg',
    ]));
    const css = await readFile(join(root, 'src', 'theme', 'theme.css'), 'utf8');
    expect(css).toContain('--sto-color-primary: oklch(0.7 0.18 50);');
    expect(css).toContain('--sto-radius-lg: 0.75rem;');
  });

  it('persists artifacts json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-art-'));
    const items = await putAppArtifacts(root, [{
      id: 'a1',
      turnKey: 't1',
      title: '做一个登录页',
      createdAt: new Date().toISOString(),
      favorite: false,
      suggestions: [{ label: '移动端', prompt: '检查移动端' }],
    }]);
    expect(items).toHaveLength(1);
    const listed = await listAppArtifacts(root);
    expect(listed[0]?.title).toBe('做一个登录页');
  });
});
