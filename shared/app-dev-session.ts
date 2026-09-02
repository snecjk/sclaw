/**
 * App-dev session key helpers shared between Electron and the renderer.
 * Renderer UI helpers that need ChatSession types live in src/lib/app-dev-session.ts.
 */

import { getProjectRootFromAgentWorkspace } from './workspace-paths';

const APP_DEV_SESSION_SEGMENT = ':appdev:';

export function isAppDevSessionKey(sessionKey: string | null | undefined): boolean {
  const key = (sessionKey ?? '').trim();
  return key.startsWith('agent:') && key.includes(APP_DEV_SESSION_SEGMENT);
}

export function getWorkspaceIdFromAppDevSessionKey(sessionKey: string): string | null {
  if (!isAppDevSessionKey(sessionKey)) return null;
  const parts = sessionKey.split(':');
  return parts[3]?.trim() || null;
}

/** Resolve the user app source root from an agent workspace cwd (`<app>/.sclaw`). */
export function resolveAppDevSourceRoot(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) return null;
  return getProjectRootFromAgentWorkspace(trimmed);
}
