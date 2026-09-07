import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expandContextIncludes } from '../utils/context-fragment';
import { getPiConfigDir, getResourcesDir } from '../utils/paths';
import { logger } from '../utils/logger';

const STOCLAW_BEGIN = '<!-- stoclaw:pi:begin -->';
const STOCLAW_END = '<!-- stoclaw:pi:end -->';

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeWithTrailingNewline(content: string): string {
  return `${content.trim()}\n`;
}

function wrapStoClawSection(content: string): string {
  return `${STOCLAW_BEGIN}\n${content.trim()}\n${STOCLAW_END}`;
}

function resolveStoClawSection(defaultContent: string): string {
  const trimmed = defaultContent.trim();
  if (trimmed.includes(STOCLAW_BEGIN) && trimmed.includes(STOCLAW_END)) {
    return trimmed;
  }
  return wrapStoClawSection(trimmed);
}

/** Keep the managed Pi context current while preserving user text outside the markers. */
export function mergePiDefaultContext(existing: string | null, defaultContent: string): string {
  const section = resolveStoClawSection(defaultContent);
  if (!existing || existing.trim() === '') {
    return normalizeWithTrailingNewline(section);
  }

  const beginIdx = existing.indexOf(STOCLAW_BEGIN);
  const endIdx = existing.indexOf(STOCLAW_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const merged = existing.slice(0, beginIdx) + section + existing.slice(endIdx + STOCLAW_END.length);
    return normalizeWithTrailingNewline(merged);
  }

  return normalizeWithTrailingNewline(`${existing.trimEnd()}\n\n${section}`);
}

/** Copy the bundled Pi context into Pi's managed agent directory. */
export async function syncPiDefaultContext(): Promise<{ updated: boolean; targetPath: string }> {
  const contextDir = join(getResourcesDir(), 'context');
  const sourcePath = join(contextDir, 'PI.md');
  const targetPath = join(getPiConfigDir(), 'AGENTS.md');

  if (!(await fileExists(sourcePath))) {
    logger.debug(`Pi default context source not found, skipping sync: ${sourcePath}`);
    return { updated: false, targetPath };
  }

  const rawDefaultContent = await readFile(sourcePath, 'utf-8');
  const defaultContent = await expandContextIncludes(rawDefaultContent, contextDir);
  const existing = await fileExists(targetPath)
    ? await readFile(targetPath, 'utf-8')
    : null;
  const merged = mergePiDefaultContext(existing, defaultContent);

  if (existing === merged) {
    return { updated: false, targetPath };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, merged, 'utf-8');
  logger.info(`Synced StoClaw Pi default context: ${targetPath}`);
  return { updated: true, targetPath };
}
