/**
 * Shared project-scoped agent ID utilities.
 *
 * OpenClaw's workspace is per-agent, so each project maps to a dedicated
 * "project agent" whose workspace points at the project rootPath. These
 * helpers generate and parse such agent IDs on both main and renderer sides.
 */

export const PROJECT_AGENT_PREFIX = 'proj';
const PROJECT_AGENT_SEPARATOR = '--';
const LEGACY_UUID_PROJECT_AGENT_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(.+)$/i;

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

  const prefix = `${PROJECT_AGENT_PREFIX}-${pid}${PROJECT_AGENT_SEPARATOR}`;
  const maxBaseLen = Math.max(1, 64 - prefix.length);
  const truncatedBase = base.slice(0, maxBaseLen);
  if (!truncatedBase) throw new Error(`baseAgentId too long to form project agent ID: ${baseAgentId}`);

  return `${prefix}${truncatedBase}`;
}

export function parseProjectAgentId(agentId: string): { projectId: string; baseAgentId: string } | null {
  const trimmed = (agentId ?? '').trim().toLowerCase();
  const prefix = `${PROJECT_AGENT_PREFIX}-`;
  if (!trimmed.startsWith(prefix)) return null;

  const inner = trimmed.slice(prefix.length);
  const separatorIndex = inner.lastIndexOf(PROJECT_AGENT_SEPARATOR);
  let projectId: string;
  let baseAgentId: string;
  if (separatorIndex > 0) {
    projectId = inner.slice(0, separatorIndex);
    baseAgentId = inner.slice(separatorIndex + PROJECT_AGENT_SEPARATOR.length);
  } else {
    const legacyMatch = LEGACY_UUID_PROJECT_AGENT_PATTERN.exec(inner);
    if (!legacyMatch) return null;
    projectId = legacyMatch[1];
    baseAgentId = legacyMatch[2];
  }
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
