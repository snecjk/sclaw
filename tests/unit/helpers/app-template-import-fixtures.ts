import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { TemplateImportPreview } from '../../../shared/app-template-source-import';

const roots: string[] = [];

export async function createImportFixtureTree(
  prefix: string,
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  return root;
}

export async function cleanupImportFixtureTrees(): Promise<void> {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export function createTemplateImportPreview(
  overrides: Partial<TemplateImportPreview> = {},
): TemplateImportPreview {
  return {
    importToken: 'token-1',
    sourceName: 'demo',
    detectedStack: 'react-vite',
    pageType: 'site',
    changes: [],
    ignoredPaths: [],
    packageChanges: [],
    issues: [],
    expiresAt: '2026-08-28T00:10:00.000Z',
    ...overrides,
  };
}
