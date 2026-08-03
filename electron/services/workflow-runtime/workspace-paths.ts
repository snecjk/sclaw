import path from 'node:path';
import { getStoClawHomeDir } from '../../utils/paths';

/**
 * Workflow execution files are user-owned runtime data rather than Electron
 * application data, so keep them below ~/.stoclaw across all platforms.
 */
export function workflowRuntimeWorkspacePath(): string {
  return path.join(getStoClawHomeDir(), 'workflow-runtime', 'workspaces');
}

export function workspacePath(runId: string, nodeId: string): string {
  return path.join(workflowRuntimeWorkspacePath(), runId, nodeId);
}

export function runWorkspacePath(runId: string): string {
  return path.join(workflowRuntimeWorkspacePath(), runId);
}
