import { describe, expect, it } from 'vitest';
import { buildAppDevFileTree } from '@/lib/app-dev-file-tree';

describe('buildAppDevFileTree', () => {
  it('nests directories and sorts dirs before files', () => {
    const tree = buildAppDevFileTree([
      'frontend/src/App.tsx',
      'frontend/src/main.tsx',
      'frontend/package.json',
      'README.md',
    ]);

    expect(tree.map((n) => n.name)).toEqual(['frontend', 'README.md']);
    const frontend = tree[0]!;
    expect(frontend.kind).toBe('dir');
    expect(frontend.children?.map((n) => n.name)).toEqual(['src', 'package.json']);
    const src = frontend.children?.[0];
    expect(src?.kind).toBe('dir');
    expect(src?.children?.map((n) => n.name)).toEqual(['App.tsx', 'main.tsx']);
  });
});
