import { cp, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { isTemplateTextFile, substituteTemplateVars } from '../utils/app-dev-info';

const EXCLUDED_TEMPLATE_ENTRIES = new Set([
  '.sclaw-template-meta.json',
  'node_modules',
]);

/** Recursively copy template source files without carrying installed dependencies into the new app. */
export async function copyTemplate(
  srcDir: string,
  destDir: string,
  vars: { appName: string; appTitle: string },
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_TEMPLATE_ENTRIES.has(entry.name)) continue;
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(src, dest, vars);
    } else if (isTemplateTextFile(entry.name)) {
      const content = await readFile(src, 'utf8');
      await writeFile(dest, substituteTemplateVars(content, vars), 'utf8');
    } else {
      await cp(src, dest);
    }
  }
}
