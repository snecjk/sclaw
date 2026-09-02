import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoClawHomeDir } from '../utils/paths';

export interface OpenClawPendingTurnMetadata {
  sessionKey: string;
  idempotencyKey: string;
  selectedSkillSlugs: string[];
  createdAt: string;
}

function metadataDirectory(): string {
  return join(getStoClawHomeDir(), 'openclaw', 'runtime', 'model-turn-metadata');
}

function metadataPath(sessionKey: string): string {
  const key = createHash('sha256').update(sessionKey).digest('hex');
  return join(metadataDirectory(), `${key}.json`);
}

export async function setOpenClawPendingTurnMetadata(
  metadata: OpenClawPendingTurnMetadata,
): Promise<void> {
  const directory = metadataDirectory();
  await mkdir(directory, { recursive: true });
  const target = metadataPath(metadata.sessionKey);
  const temporary = join(directory, `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(metadata), 'utf8');
  await rename(temporary, target);
}

export async function clearOpenClawPendingTurnMetadata(
  sessionKey: string,
  idempotencyKey: string,
): Promise<void> {
  const target = metadataPath(sessionKey);
  // A later send may already have replaced this session's metadata. The adapter
  // serializes sends per session today, but keep cleanup conservative.
  const { readFile } = await import('node:fs/promises');
  try {
    const current = JSON.parse(await readFile(target, 'utf8')) as { idempotencyKey?: unknown };
    if (current.idempotencyKey !== idempotencyKey) return;
    await rm(target, { force: true });
  } catch {
    // Missing or malformed pending metadata is safe to ignore during cleanup.
  }
}
