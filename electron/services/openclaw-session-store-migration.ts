/**
 * OpenClaw sessions.json → SQLite migration.
 *
 * OpenClaw stores per-session metadata (modelOverride, providerOverride, etc.)
 * in agents/<agentId>/sessions/sessions.json. The session catalog bootstrap
 * already imports the legacy engine-sessions.json registry, but it does not
 * backfill metadata from the OpenClaw session store. This module runs on
 * startup, copies missing metadata into SQLite, and marks each entry as synced.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import { getAgentIdFromSessionKey } from '../engines/session-engine';
import { DEFAULT_WORKSPACE_ID } from '../db/models/domain/session-catalog';
import { getCatalogSessionRepository } from '../db/repositories/catalog-session-repository';
import { getSessionEngineBindingRepository } from '../db/repositories/session-engine-binding-repository';
import { logger } from '../utils/logger';
import { isWorkflowOpenClawSessionKey } from '../../shared/workflow-openclaw-session';

const SYNCED_FLAG = 'syncedToSQLite';

interface OpenClawSessionStoreEntry {
  sessionId?: string;
  updatedAt?: number;
  providerOverride?: string;
  modelOverride?: string;
  label?: string;
  sessionFile?: string;
  file?: string;
  fileName?: string;
  path?: string;
  spawnedBy?: string;
  chatType?: string;
  [SYNCED_FLAG]?: boolean;
  [key: string]: unknown;
}

interface OpenClawSessionStore {
  sessions?: unknown[];
  [key: string]: unknown;
}

function toIsoString(value: number | string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

interface ParsedEntry extends OpenClawSessionStoreEntry {
  key: string;
  rawRecord: Record<string, unknown>;
}

function parseEntry(raw: unknown): ParsedEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const key = typeof record.key === 'string'
    ? record.key
    : typeof record.sessionKey === 'string'
      ? record.sessionKey
      : '';
  if (!key) return null;

  return {
    key,
    rawRecord: record,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : undefined,
    providerOverride: typeof record.providerOverride === 'string' ? record.providerOverride : undefined,
    modelOverride: typeof record.modelOverride === 'string' ? record.modelOverride : undefined,
    label: typeof record.label === 'string' ? record.label : undefined,
    sessionFile: typeof record.sessionFile === 'string' ? record.sessionFile : undefined,
    file: typeof record.file === 'string' ? record.file : undefined,
    fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
    path: typeof record.path === 'string' ? record.path : undefined,
    spawnedBy: typeof record.spawnedBy === 'string' ? record.spawnedBy : undefined,
    chatType: typeof record.chatType === 'string' ? record.chatType : undefined,
    [SYNCED_FLAG]: record[SYNCED_FLAG] === true,
  };
}

async function migrateAgentSessionStore(agentId: string): Promise<number> {
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const storePath = join(sessionsDir, 'sessions.json');
  logger.info(`[openclaw-session-migration] [agent=${agentId}] Reading ${storePath}`);

  let store: OpenClawSessionStore;
  try {
    const raw = await readFile(storePath, 'utf8');
    store = JSON.parse(raw) as OpenClawSessionStore;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[openclaw-session-migration] [agent=${agentId}] Failed to read ${storePath}: ${message}`);
    return 0;
  }

  const candidates: ParsedEntry[] = [];

  if (Array.isArray(store.sessions)) {
    for (const item of store.sessions) {
      const parsed = parseEntry(item);
      if (parsed) candidates.push(parsed);
    }
  }

  for (const [key, value] of Object.entries(store)) {
    if (key === 'sessions' || !key) continue;
    const parsed = parseEntry({ ...(value as Record<string, unknown>), key });
    if (parsed) {
      candidates.push({ ...parsed, key });
    }
  }

  const alreadySynced = candidates.filter((e) => e[SYNCED_FLAG]).length;
  const pending = candidates.filter((e) => !e[SYNCED_FLAG]).length;
  logger.info(
    `[openclaw-session-migration] [agent=${agentId}] Candidates: ${candidates.length}, `
    + `alreadySynced: ${alreadySynced}, pending: ${pending}`,
  );

  if (pending === 0) {
    logger.info(`[openclaw-session-migration] [agent=${agentId}] Nothing to sync`);
    return 0;
  }

  const bindingRepo = getSessionEngineBindingRepository();
  const catalogRepo = getCatalogSessionRepository();
  let syncedCount = 0;
  let modified = false;

  for (const entry of candidates) {
    if (entry[SYNCED_FLAG]) continue;

    const sessionKey = entry.key;
    // Workflow node executions are audit records, not user conversations.
    // They are removed after each run; skip any stale residue defensively.
    if (isWorkflowOpenClawSessionKey(sessionKey)) continue;
    const agentIdFromKey = getAgentIdFromSessionKey(sessionKey);
    const resolvedAgentId = agentIdFromKey || agentId;
    const updatedAtIso = toIsoString(entry.updatedAt);
    const title = entry.label?.trim() || null;

    try {
      logger.info(
        `[openclaw-session-migration] [agent=${agentId}] Syncing ${sessionKey}: `
        + `model=${entry.modelOverride ?? '(none)'}, provider=${entry.providerOverride ?? '(none)'}, `
        + `sessionId=${entry.sessionId ?? '(none)'}, title=${title ?? '(none)'}`,
      );

      await bindingRepo.upsert({
        sessionKey,
        engineType: 'openclaw',
        agentId: resolvedAgentId,
        sessionId: entry.sessionId,
        model: entry.modelOverride,
        provider: entry.providerOverride,
        accountId: entry.providerOverride,
        updatedAt: entry.updatedAt,
        title: title ?? undefined,
      });

      const existingCatalog = await catalogRepo.findBySessionKey(sessionKey, { includeDeleted: true });
      const targetWorkspaceId = existingCatalog?.workspaceId ?? DEFAULT_WORKSPACE_ID;
      await catalogRepo.upsert({
        workspaceId: targetWorkspaceId,
        sessionKey,
        title: title ?? existingCatalog?.title ?? null,
        lastActivityAt: updatedAtIso ?? existingCatalog?.lastActivityAt ?? undefined,
      });

      logger.info(
        `[openclaw-session-migration] [agent=${agentId}] ${sessionKey} upserted `
        + `(workspace=${targetWorkspaceId})`,
      );

      // Mark the entry as synced in the in-memory store object.
      entry.rawRecord[SYNCED_FLAG] = true;
      modified = true;

      syncedCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[openclaw-session-migration] [agent=${agentId}] Failed to sync ${sessionKey}: ${message}`);
    }
  }

  if (modified) {
    try {
      await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
      logger.info(`[openclaw-session-migration] [agent=${agentId}] Wrote ${syncedCount} synced marker(s) to ${storePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[openclaw-session-migration] [agent=${agentId}] Failed to write ${storePath}: ${message}`);
    }
  }

  return syncedCount;
}

export async function importOpenClawSessionStoreIfNeeded(): Promise<void> {
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  logger.info(`[openclaw-session-migration] Starting scan: ${agentsDir}`);

  let agentIds: string[];
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    agentIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[openclaw-session-migration] Failed to list agents dir: ${message}`);
    return;
  }

  if (agentIds.length === 0) {
    logger.info('[openclaw-session-migration] No agent directories found');
    return;
  }

  logger.info(`[openclaw-session-migration] Found ${agentIds.length} agent(s): ${agentIds.join(', ')}`);

  let totalSynced = 0;
  for (const agentId of agentIds) {
    totalSynced += await migrateAgentSessionStore(agentId);
  }

  if (totalSynced > 0) {
    logger.info(`[openclaw-session-migration] Finished. Migrated ${totalSynced} OpenClaw session(s) to SQLite`);
  } else {
    logger.info('[openclaw-session-migration] Finished. No OpenClaw sessions needed migration');
  }
}
