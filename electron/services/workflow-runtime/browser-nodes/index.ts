import type { RunCtx, NodeResult } from '../types';
import { isBrowserAutomationEnabled } from '../../../../shared/browser-automation/feature-flag';
import { isBrowserWorkflowNodeType } from '../../../../shared/browser-automation/workflow-output';
import { executeBrowserValidateNode, executeBrowserHumanGateNode } from './browser-validate';
import { executeBrowserTaskNode } from './browser-task';
import type { InvokeAgentFn } from '../agent-retry';

export interface BrowserNodeDeps {
  invokeAgent: InvokeAgentFn;
  quota?: () => Promise<boolean>;
  execEngine?: 'claude' | 'openclaw';
  versionId?: unknown;
}

export async function executeBrowserNode(
  ctx: RunCtx,
  node: any,
  nodeInput: unknown,
  deps: BrowserNodeDeps,
): Promise<NodeResult> {
  if (!isBrowserAutomationEnabled()) {
    throw new Error('Browser automation is disabled. Set STOCLAW_BROWSER_AUTOMATION=true to enable workflow browser nodes.');
  }

  const nodeType = String(node?.type ?? '');
  if (!isBrowserWorkflowNodeType(nodeType)) {
    throw new Error(`Unsupported browser workflow node type: ${nodeType}`);
  }

  switch (nodeType) {
    case 'browser_validate':
      return executeBrowserValidateNode(ctx, node, nodeInput);
    case 'browser_human_gate':
      return executeBrowserHumanGateNode(ctx, node, nodeInput);
    case 'browser_task':
      return executeBrowserTaskNode(ctx, node, nodeInput, deps);
    default:
      throw new Error(`Unsupported browser workflow node type: ${nodeType}`);
  }
}

export { extractBrowserPayload, resolveBrowserSession } from './session-resolver';
export { compileBrowserAgentSpec } from './compile-browser-spec';
