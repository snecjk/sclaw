import path from 'node:path';
import { getDataDir } from '../../utils/paths';

export function workspacePath(runId: string, nodeId: string): string {
  return path.join(getDataDir(), 'workflow-runtime', 'workspaces', runId, nodeId);
}

export function runWorkspacePath(runId: string): string {
  return path.join(getDataDir(), 'workflow-runtime', 'workspaces', runId);
}
