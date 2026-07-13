import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dialog, BrowserWindow } from 'electron';
import { mkdir } from 'node:fs/promises';
import { getClawXConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import {
  DEFAULT_WORKSPACE_ID,
  type CatalogSession,
} from '../db/models/domain/session-catalog';
import {
  getCatalogSessionRepository,
} from '../db/repositories/catalog-session-repository';
import {
  getSessionEngineBindingRepository,
} from '../db/repositories/session-engine-binding-repository';
import { bindingToRegistryEntry } from '../engines/session-binding-map';
import {
  getSessionGroupRepository,
} from '../db/repositories/session-group-repository';
import {
  getWorkspaceRepository,
} from '../db/repositories/workspace-repository';
import { getAgentIdFromSessionKey } from '../engines/session-engine';
import type { EngineSessionRegistryEntry } from '../engines/session-registry-types';
import type { AgentEngineType } from '../engines/types';
import { getAgentWorkspacePath } from '../utils/agent-config';

const ENGINE_SESSION_REGISTRY_FILE = join(getClawXConfigDir(), 'engine-sessions.json');

interface EngineSessionRegistryDocument {
  entries?: EngineSessionRegistryEntry[];
}

interface LegacySidebarGroup {
  id: string;
  name: string;
  createdAt: number;
  collapsed?: boolean;
}

interface LegacySidebarGroupsState {
  groups?: LegacySidebarGroup[];
  assignments?: Record<string, string>;
}

interface LegacySessionLabelEntry {
  label?: string;
  updatedAt?: number;
}

let catalogBootstrapPromise: Promise<void> | null = null;

export async function ensureSessionCatalogBootstrapped(): Promise<void> {
  if (!catalogBootstrapPromise) {
    catalogBootstrapPromise = bootstrapSessionCatalog().catch((error) => {
      catalogBootstrapPromise = null;
      throw error;
    });
  }
  await catalogBootstrapPromise;
}

async function bootstrapSessionCatalog(): Promise<void> {
  await getWorkspaceRepository().getDefaultWorkspace();
  await importEngineSessionsJsonIfNeeded();
  logger.info('[session-catalog] bootstrap complete');
}

async function importEngineSessionsJsonIfNeeded(): Promise<void> {
  const bindingRepo = getSessionEngineBindingRepository();
  const activeCount = await bindingRepo.countActive();
  if (activeCount > 0) {
    return;
  }

  let doc: EngineSessionRegistryDocument;
  try {
    const raw = await readFile(ENGINE_SESSION_REGISTRY_FILE, 'utf8');
    doc = JSON.parse(raw) as EngineSessionRegistryDocument;
  } catch {
    return;
  }

  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  if (entries.length === 0) {
    return;
  }

  const catalogRepo = getCatalogSessionRepository();
  for (const entry of entries) {
    if (!entry?.sessionKey) continue;
    await bindingRepo.upsert({
      sessionKey: entry.sessionKey,
      engineType: entry.engineType,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      updatedAt: entry.updatedAt,
      title: entry.title,
      model: entry.model,
      accountId: entry.accountId,
      archivedClaudeSessionIds: entry.archivedClaudeSessionIds,
      pendingHistoryBridge: entry.pendingHistoryBridge,
    });
    await catalogRepo.upsert({
      workspaceId: DEFAULT_WORKSPACE_ID,
      sessionKey: entry.sessionKey,
      title: entry.title ?? null,
      lastActivityAt: entry.updatedAt != null
        ? new Date(entry.updatedAt).toISOString()
        : undefined,
    });
  }
  logger.info(`[session-catalog] imported ${entries.length} engine registry entries`);
}

export async function pickWorkspaceFolder(parentWindow?: BrowserWindow | null): Promise<string | null> {
  const parent = parentWindow && !parentWindow.isDestroyed()
    ? parentWindow
    : BrowserWindow.getFocusedWindow();
  const result = parent
    ? await dialog.showOpenDialog(parent, {
      properties: ['openDirectory', 'createDirectory'],
    })
    : await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
}

export async function createBlankWorkspaceFolder(
  parentPath: string,
  folderName: string,
): Promise<string> {
  const trimmedParent = parentPath.trim();
  const trimmedName = folderName.trim();
  if (!trimmedParent || !trimmedName) {
    throw new Error('Parent path and folder name are required');
  }
  const target = join(trimmedParent, trimmedName);
  await mkdir(target, { recursive: false });
  return target;
}

export async function listUserWorkspaces() {
  await ensureSessionCatalogBootstrapped();
  return getWorkspaceRepository().list({ includeDefault: false });
}

export async function createWorkspace(input: { name: string; rootPath: string }) {
  await ensureSessionCatalogBootstrapped();
  return getWorkspaceRepository().create({
    name: input.name,
    rootPath: input.rootPath,
  });
}

export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; rootPath?: string },
) {
  await ensureSessionCatalogBootstrapped();
  const workspace = await getWorkspaceRepository().update(workspaceId, input);
  if (input.rootPath != null) {
    const sessions = await getCatalogSessionRepository().list({ workspaceId });
    await Promise.all(sessions.map((session) => syncSessionEngineBindingCwd(session.sessionKey)));
  }
  return workspace;
}

export async function deleteWorkspace(workspaceId: string): Promise<{ movedSessionCount: number }> {
  await ensureSessionCatalogBootstrapped();
  const catalogRepo = getCatalogSessionRepository();
  const sessions = await catalogRepo.list({ workspaceId });
  for (const session of sessions) {
    await catalogRepo.moveToWorkspace(session.sessionKey, DEFAULT_WORKSPACE_ID);
    await syncSessionEngineBindingCwd(session.sessionKey);
  }
  await getWorkspaceRepository().softDelete(workspaceId);
  return { movedSessionCount: sessions.length };
}

export async function syncSessionEngineBindingCwd(sessionKey: string): Promise<void> {
  await ensureSessionCatalogBootstrapped();
  const bindingRepo = getSessionEngineBindingRepository();
  const binding = await bindingRepo.getBySessionKey(sessionKey);
  if (!binding) return;

  const agentId = binding.agentId || getAgentIdFromSessionKey(sessionKey);
  const resolvedCwd = await resolveSessionToolCwd(sessionKey, agentId);
  if (!resolvedCwd || resolvedCwd === binding.cwd) return;

  const extra = binding.extra ?? {};
  await bindingRepo.upsert({
    sessionKey,
    engineType: binding.engineType,
    agentId: binding.agentId,
    sessionId: binding.engineSessionId ?? undefined,
    cwd: resolvedCwd,
    model: binding.model ?? undefined,
    accountId: binding.accountId ?? undefined,
    title: typeof extra.title === 'string' ? extra.title : undefined,
    archivedClaudeSessionIds: Array.isArray(extra.archivedClaudeSessionIds)
      ? extra.archivedClaudeSessionIds.map(String)
      : undefined,
    pendingHistoryBridge: extra.pendingHistoryBridge === true ? true : undefined,
    updatedAt: Date.now(),
  });
}

export async function listWorkspaceGroups(workspaceId: string) {
  await ensureSessionCatalogBootstrapped();
  return getSessionGroupRepository().listByWorkspace(workspaceId);
}

export async function createWorkspaceGroup(workspaceId: string, name: string, id?: string) {
  await ensureSessionCatalogBootstrapped();
  return getSessionGroupRepository().create({ workspaceId, name, id });
}

export async function listCatalogSessions(workspaceId: string) {
  await ensureSessionCatalogBootstrapped();
  return getCatalogSessionRepository().list({ workspaceId });
}

export async function upsertCatalogSession(input: {
  workspaceId: string;
  sessionKey: string;
  groupId?: string | null;
  title?: string | null;
  pinRank?: number | null;
  lastActivityAt?: string | null;
}) {
  await ensureSessionCatalogBootstrapped();
  return getCatalogSessionRepository().upsert(input);
}

export async function softDeleteCatalogSession(workspaceId: string, sessionKey: string) {
  await ensureSessionCatalogBootstrapped();
  return getCatalogSessionRepository().softDelete(workspaceId, sessionKey);
}

export async function listEngineBindings(engineType?: AgentEngineType) {
  await ensureSessionCatalogBootstrapped();
  const bindings = await getSessionEngineBindingRepository().list({ engineType });
  return bindings.map(bindingToRegistryEntry);
}

export async function getEngineBinding(sessionKey: string) {
  await ensureSessionCatalogBootstrapped();
  const binding = await getSessionEngineBindingRepository().getBySessionKey(sessionKey);
  return binding ? bindingToRegistryEntry(binding) : null;
}

export async function getSessionWorkspaceId(sessionKey: string): Promise<string> {
  await ensureSessionCatalogBootstrapped();
  const row = await getCatalogSessionRepository().findBySessionKey(sessionKey);
  return row?.workspaceId ?? DEFAULT_WORKSPACE_ID;
}

export async function bindSessionToWorkspace(sessionKey: string, workspaceId: string): Promise<void> {
  await ensureSessionCatalogBootstrapped();
  await getCatalogSessionRepository().moveToWorkspace(sessionKey, workspaceId);
  await syncSessionEngineBindingCwd(sessionKey);
}

export async function moveSessionToWorkspace(sessionKey: string, workspaceId: string): Promise<CatalogSession> {
  await ensureSessionCatalogBootstrapped();
  const session = await getCatalogSessionRepository().moveToWorkspace(sessionKey, workspaceId);
  await syncSessionEngineBindingCwd(sessionKey);
  return session;
}

export async function listAllSessionWorkspaceBindings(): Promise<Record<string, string>> {
  await ensureSessionCatalogBootstrapped();
  const rows = await getCatalogSessionRepository().listAllBindings();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.sessionKey] = row.workspaceId;
  }
  return map;
}

export async function resolveSessionToolCwd(sessionKey: string, agentId?: string): Promise<string | null> {
  await ensureSessionCatalogBootstrapped();
  const row = await getCatalogSessionRepository().findBySessionKey(sessionKey);
  if (row && row.workspaceId !== DEFAULT_WORKSPACE_ID) {
    const root = await getWorkspaceRootPath(row.workspaceId);
    if (root) return root;
  }
  const resolvedAgentId = agentId?.trim() || getAgentIdFromSessionKey(sessionKey);
  return getAgentWorkspacePath(resolvedAgentId);
}

export async function softDeleteCatalogSessionByKey(sessionKey: string): Promise<boolean> {
  const workspaceId = await getSessionWorkspaceId(sessionKey);
  return softDeleteCatalogSession(workspaceId, sessionKey);
}

export async function upsertEngineBinding(entry: EngineSessionRegistryEntry) {
  await ensureSessionCatalogBootstrapped();
  const binding = await getSessionEngineBindingRepository().upsert({
    sessionKey: entry.sessionKey,
    engineType: entry.engineType,
    agentId: entry.agentId,
    sessionId: entry.sessionId,
    cwd: entry.cwd,
    updatedAt: entry.updatedAt,
    title: entry.title,
    model: entry.model,
    accountId: entry.accountId,
    archivedClaudeSessionIds: entry.archivedClaudeSessionIds,
    pendingHistoryBridge: entry.pendingHistoryBridge,
  });
  const catalogRepo = getCatalogSessionRepository();
  const existingCatalog = await catalogRepo.findBySessionKey(entry.sessionKey);
  const workspaceId = existingCatalog?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  await catalogRepo.upsert({
    workspaceId,
    sessionKey: entry.sessionKey,
    title: entry.title ?? existingCatalog?.title ?? null,
    groupId: existingCatalog?.groupId,
    pinRank: existingCatalog?.pinRank,
    sortKey: existingCatalog?.sortKey,
    lastActivityAt: entry.updatedAt != null
      ? new Date(entry.updatedAt).toISOString()
      : existingCatalog?.lastActivityAt ?? undefined,
  });
  return bindingToRegistryEntry(binding);
}

export async function deleteEngineBinding(sessionKey: string) {
  await ensureSessionCatalogBootstrapped();
  const removed = await getSessionEngineBindingRepository().softDelete(sessionKey);
  return removed ? bindingToRegistryEntry(removed) : null;
}

export async function importLegacySidebarGroups(raw: LegacySidebarGroupsState): Promise<void> {
  await ensureSessionCatalogBootstrapped();
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const assignments = raw.assignments ?? {};
  const groupRepo = getSessionGroupRepository();
  const catalogRepo = getCatalogSessionRepository();
  const idMap = new Map<string, string>();

  for (const [index, group] of groups.entries()) {
    if (!group?.id || !group.name) continue;
    const created = await groupRepo.create({
      id: group.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: group.name,
      sortOrder: index,
    });
    idMap.set(group.id, created.id);
  }

  for (const [sessionKey, legacyGroupId] of Object.entries(assignments)) {
    const groupId = idMap.get(legacyGroupId) ?? legacyGroupId;
    await catalogRepo.upsert({
      workspaceId: DEFAULT_WORKSPACE_ID,
      sessionKey,
      groupId,
    });
  }
}

export async function importLegacySessionLabels(
  labels: Record<string, LegacySessionLabelEntry>,
): Promise<void> {
  await ensureSessionCatalogBootstrapped();
  const catalogRepo = getCatalogSessionRepository();
  for (const [sessionKey, entry] of Object.entries(labels)) {
    if (!sessionKey) continue;
    await catalogRepo.upsert({
      workspaceId: DEFAULT_WORKSPACE_ID,
      sessionKey,
      title: entry?.label ?? null,
      lastActivityAt: entry?.updatedAt != null
        ? new Date(entry.updatedAt).toISOString()
        : undefined,
    });
  }
}

export async function getWorkspaceRootPath(workspaceId: string): Promise<string | null> {
  await ensureSessionCatalogBootstrapped();
  const workspace = await getWorkspaceRepository().getById(workspaceId);
  if (!workspace || workspace.isDefault) {
    return null;
  }
  return workspace.rootPath || null;
}
