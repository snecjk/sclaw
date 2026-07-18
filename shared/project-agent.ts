/**
 * Shared project-scoped agent ID utilities.
 *
 * OpenClaw's workspace is per-agent, so each project maps to a dedicated
 * "project agent" whose workspace points at the project rootPath. These
 * helpers generate and parse such agent IDs on both main and renderer sides.
 */

export const PROJECT_AGENT_PREFIX = 'proj';

/** Workspace IDs are UUIDs; project agent IDs embed them after the `proj-` prefix. */
const PROJECT_ID_UUID_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

/**
 * Build the project agent ID for a given project + base agent.
 * OpenClaw agent IDs are limited to 64 characters and must match
 * /^[a-z0-9][a-z0-9_-]{0,63}$/i after normalization.
 */
export function resolveProjectAgentId(projectId: string, baseAgentId: string): string {
  const pid = (projectId ?? '').trim().toLowerCase();
  const base = normalizeAgentId(baseAgentId);
  if (!pid) throw new Error('projectId is required');

  const prefix = `${PROJECT_AGENT_PREFIX}-${pid}-`;
  const maxBaseLen = Math.max(1, 64 - prefix.length);
  const truncatedBase = base.slice(0, maxBaseLen);
  if (!truncatedBase) throw new Error(`baseAgentId too long to form project agent ID: ${baseAgentId}`);

  return `${prefix}${truncatedBase}`;
}

function parseWithKnownBaseAgentIds(
  inner: string,
  knownBaseAgentIds: readonly string[],
): { projectId: string; baseAgentId: string } | null {
  const sorted = [...knownBaseAgentIds]
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const baseAgentId of sorted) {
    const suffix = `-${baseAgentId}`;
    if (!inner.endsWith(suffix)) continue;
    const projectId = inner.slice(0, -suffix.length);
    if (projectId) {
      return { projectId, baseAgentId };
    }
  }

  return null;
}

export function parseProjectAgentId(
  agentId: string,
  knownBaseAgentIds?: readonly string[],
): { projectId: string; baseAgentId: string } | null {
  const trimmed = (agentId ?? '').trim().toLowerCase();
  const prefix = `${PROJECT_AGENT_PREFIX}-`;
  if (!trimmed.startsWith(prefix)) return null;

  const inner = trimmed.slice(prefix.length);
  if (!inner) return null;

  const uuidMatch = inner.match(PROJECT_ID_UUID_PATTERN);
  if (uuidMatch) {
    return { projectId: uuidMatch[1], baseAgentId: uuidMatch[2] };
  }

  if (knownBaseAgentIds?.length) {
    const knownMatch = parseWithKnownBaseAgentIds(inner, knownBaseAgentIds);
    if (knownMatch) return knownMatch;
  }

  const lastDash = inner.lastIndexOf('-');
  if (lastDash <= 0) return null;

  const projectId = inner.slice(0, lastDash);
  const baseAgentId = inner.slice(lastDash + 1);
  if (!projectId || !baseAgentId) return null;

  return { projectId, baseAgentId };
}

export function isProjectAgentId(agentId: string): boolean {
  return parseProjectAgentId(agentId) !== null;
}

export function getBaseAgentIdFromProjectAgentId(agentId: string): string | null {
  return parseProjectAgentId(agentId)?.baseAgentId ?? null;
}

export function getProjectIdFromProjectAgentId(agentId: string): string | null {
  return parseProjectAgentId(agentId)?.projectId ?? null;
}
