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
import { ensureWorkspaceArtifactOutputDir } from '../utils/paths';
import { resolveProjectAgentWorkspacePath } from '../../shared/workspace-paths';
import type { GatewayManager } from '../gateway/manager';
import {
  deleteAllProjectAgentsForProject,
  ensureProjectAgent,
  listProjectAgentIds,
} from './project-agent-service';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  isProjectAgentId,
} from '../../shared/project-agent';

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
      provider: entry.provider,
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

export async function createWorkspace(
  input: { name: string; rootPath: string },
  _gatewayManager?: GatewayManager | null,
) {
  await ensureSessionCatalogBootstrapped();
  // Do not create a project agent here — defer until the user starts a chat in
  // this project (sidebar「新建对话」), so creating a project does not reload the gateway.
  ensureWorkspaceArtifactOutputDir(resolveProjectAgentWorkspacePath(input.rootPath));
  return getWorkspaceRepository().create({
    name: input.name,
    rootPath: input.rootPath,
  });
}

/**
 * Ensure the OpenClaw project agent for a workspace exists and points at
 * `<rootPath>/.sclaw`. Called when the user starts a new chat in the project.
 */
export async function ensureWorkspaceProjectAgent(
  workspaceId: string,
  baseAgentId: string = 'main',
  gatewayManager?: GatewayManager | null,
): Promise<{ agentId: string; created: boolean; workspaceUpdated: boolean }> {
  await ensureSessionCatalogBootstrapped();
  const trimmedId = workspaceId.trim();
  if (!trimmedId || trimmedId === DEFAULT_WORKSPACE_ID) {
    throw new Error('A project workspace id is required');
  }
  const workspace = await getWorkspaceRepository().getById(trimmedId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${trimmedId}`);
  }
  const resolvedBase = getBaseAgentIdFromProjectAgentId(baseAgentId) || baseAgentId.trim() || 'main';
  const result = await ensureProjectAgent(trimmedId, resolvedBase, workspace.rootPath);
  if (result.created || result.workspaceUpdated) {
    // Project new-chat readiness waits for this call. A scheduled/debounced reload
    // can run after chat.send and leave the newly-created agent temporarily unroutable.
    await gatewayManager?.reload({ force: true });
  }
  return result;
}

export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; rootPath?: string },
  gatewayManager?: GatewayManager | null,
) {
  await ensureSessionCatalogBootstrapped();
  const workspace = await getWorkspaceRepository().update(workspaceId, input);
  if (input.rootPath != null) {
    const sessions = await getCatalogSessionRepository().list({ workspaceId });
    try {
      // Empty projects stay agent-less. Existing project agents and agents required
      // by real catalog sessions are both synchronized, healing partial state without
      // creating a main project agent merely because the path was edited.
      const baseAgentIds = new Set<string>();
      for (const session of sessions) {
        const rawAgentId = getAgentIdFromSessionKey(session.sessionKey);
        baseAgentIds.add(
          isProjectAgentId(rawAgentId)
            ? (getBaseAgentIdFromProjectAgentId(rawAgentId) ?? 'main')
            : rawAgentId,
        );
      }
      const existingProjectAgents = (await listProjectAgentIds()).filter((agentId) => (
        getProjectIdFromProjectAgentId(agentId) === workspaceId.trim().toLowerCase()
      ));
      for (const agentId of existingProjectAgents) {
        baseAgentIds.add(getBaseAgentIdFromProjectAgentId(agentId) || 'main');
      }

      const results = await Promise.all([...baseAgentIds].map((baseAgentId) => (
        ensureProjectAgent(workspaceId, baseAgentId, input.rootPath!)
      )));
      await Promise.all(sessions.map((session) => syncSessionEngineBindingCwd(session.sessionKey)));
      if (results.some((result) => result.created || result.workspaceUpdated)) {
        await gatewayManager?.reload({ force: true });
      }
    } catch (error) {
      logger.warn('[session-catalog] failed to sync project agents on workspace path change', {
        workspaceId,
        error: String(error),
      });
      throw error;
    }
  }
  return workspace;
}

export async function deleteWorkspace(
  workspaceId: string,
  gatewayManager?: GatewayManager | null,
): Promise<{ deletedSessionCount: number }> {
  await ensureSessionCatalogBootstrapped();
  const catalogRepo = getCatalogSessionRepository();
  const bindingRepo = getSessionEngineBindingRepository();
  const sessions = await catalogRepo.list({ workspaceId });
  for (const session of sessions) {
    await catalogRepo.softDelete(workspaceId, session.sessionKey);
    await bindingRepo.softDelete(session.sessionKey);
  }
  await getWorkspaceRepository().softDelete(workspaceId);
  try {
    const removed = await deleteAllProjectAgentsForProject(workspaceId);
    if (removed.length > 0) {
      gatewayManager?.debouncedReload();
    }
  } catch (error) {
    logger.warn('[session-catalog] failed to delete project agents for workspace', { workspaceId, error });
  }
  return { deletedSessionCount: sessions.length };
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
    provider: binding.provider ?? undefined,
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
  sessionType?: import('../db/models/domain/session-catalog').CatalogSession['sessionType'] | null;
  taskId?: string | null;
  appId?: string | null;
  channelType?: string | null;
  channelId?: string | null;
  title?: string | null;
  pinRank?: number | null;
  sortKey?: string | null;
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

export async function bindSessionToWorkspace(
  sessionKey: string,
  workspaceId: string,
  gatewayManager?: GatewayManager | null,
): Promise<void> {
  await ensureSessionCatalogBootstrapped();
  await getCatalogSessionRepository().moveToWorkspace(sessionKey, workspaceId);
  await syncSessionEngineBindingCwd(sessionKey);
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    const workspace = await getWorkspaceRepository().getById(workspaceId).catch(() => null);
    if (workspace) {
      const rawAgentId = getAgentIdFromSessionKey(sessionKey);
      const baseAgentId = isProjectAgentId(rawAgentId)
        ? (getBaseAgentIdFromProjectAgentId(rawAgentId) ?? 'main')
        : rawAgentId;
      try {
        const result = await ensureProjectAgent(workspaceId, baseAgentId, workspace.rootPath);
        if (result.created || result.workspaceUpdated) {
          // Session readiness waits for this API call. Awaiting reload here ensures
          // the newly-created project agent is routable before the first send.
          await gatewayManager?.reload({ force: true });
        }
      } catch (error) {
        logger.warn('[session-catalog] failed to ensure project agent on bind', {
          workspaceId,
          sessionKey,
          error: String(error),
        });
        throw error;
      }
    }
  }
}

export async function moveSessionToWorkspace(
  sessionKey: string,
  workspaceId: string,
  gatewayManager?: GatewayManager | null,
): Promise<CatalogSession> {
  await ensureSessionCatalogBootstrapped();
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    throw new Error('Moving sessions out of a project is not supported');
  }
  const session = await getCatalogSessionRepository().moveToWorkspace(sessionKey, workspaceId);
  await syncSessionEngineBindingCwd(sessionKey);
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    const workspace = await getWorkspaceRepository().getById(workspaceId).catch(() => null);
    if (workspace) {
      const rawAgentId = getAgentIdFromSessionKey(sessionKey);
      const baseAgentId = isProjectAgentId(rawAgentId)
        ? (getBaseAgentIdFromProjectAgentId(rawAgentId) ?? 'main')
        : rawAgentId;
      try {
        const result = await ensureProjectAgent(workspaceId, baseAgentId, workspace.rootPath);
        if (result.created || result.workspaceUpdated) {
          gatewayManager?.debouncedReload();
        }
      } catch (error) {
        logger.warn('[session-catalog] failed to ensure project agent on move', {
          workspaceId,
          sessionKey,
          error: String(error),
        });
      }
    }
  }
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
    if (root) {
      const agentWorkspace = resolveProjectAgentWorkspacePath(root);
      ensureWorkspaceArtifactOutputDir(agentWorkspace);
      return agentWorkspace;
    }
  }
  const resolvedAgentId = agentId?.trim() || getAgentIdFromSessionKey(sessionKey);
  const workspace = await getAgentWorkspacePath(resolvedAgentId);
  ensureWorkspaceArtifactOutputDir(workspace);
  return workspace;
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
    provider: entry.provider,
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

function toIsoOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : NaN);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
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
    // Re-runs must be idempotent: group id may already exist from a prior migrate.
    const existing = await groupRepo.getById(group.id);
    if (existing) {
      idMap.set(group.id, existing.id);
      continue;
    }
    try {
      const created = await groupRepo.create({
        id: group.id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: group.name,
        sortOrder: index,
      });
      idMap.set(group.id, created.id);
    } catch (error) {
      logger.warn(`[session-catalog] skip legacy group ${group.id}:`, error);
      idMap.set(group.id, group.id);
    }
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
      lastActivityAt: toIsoOrUndefined(entry?.updatedAt),
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
