import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface TemplateImportLocalState {
  schemaVersion: 1;
  sourcePath: string;
  sourceFingerprint: string;
  importedAt: string;
  files: Record<string, string>;
}

export function templateImportStatePath(templateRoot: string): string {
  return join(templateRoot, '.sclaw', 'local', 'template-source-import.json');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === 'string'),
  );
}

export async function readTemplateImportState(
  templateRoot: string,
): Promise<TemplateImportLocalState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(templateImportStatePath(templateRoot), 'utf8'),
    ) as Partial<TemplateImportLocalState>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.sourcePath !== 'string'
      || typeof parsed.sourceFingerprint !== 'string'
      || typeof parsed.importedAt !== 'string'
      || !isStringRecord(parsed.files)
    ) {
      return null;
    }
    return parsed as TemplateImportLocalState;
  } catch {
    return null;
  }
}

export async function writeTemplateImportState(
  templateRoot: string,
  state: TemplateImportLocalState,
): Promise<void> {
  const target = templateImportStatePath(templateRoot);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
