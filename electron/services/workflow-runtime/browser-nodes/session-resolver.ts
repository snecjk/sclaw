import type { BrowserAutomationValidatorSpec } from '../../../../shared/browser-automation/types';
import type { BrowserWorkflowPayload } from '../../../../shared/browser-automation/workflow-output';
import { resolvePath } from '../input-resolver';
import { browserAutomationService } from '../../browser-automation/service';
import { buildEmbedSessionId } from '../../browser-automation/session-manager';
import type { RunCtx } from '../types';
import { createFailurePacket, createWorkflowPacket } from '../workflow-packet';
import type { WorkflowPacket } from '../workflow-packet';

function unwrapPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  if (record.protocolVersion === 'workflow-packet/v1' && 'payload' in record) {
    const inner = record.payload;
    return inner && typeof inner === 'object' && !Array.isArray(inner)
      ? inner as Record<string, unknown>
      : { payload: inner };
  }
  return record;
}

export function extractBrowserPayload(input: unknown): BrowserWorkflowPayload | null {
  const root = unwrapPayload(input);
  const direct = root.browser;
  if (direct && typeof direct === 'object' && typeof (direct as BrowserWorkflowPayload).sessionId === 'string') {
    return direct as BrowserWorkflowPayload;
  }
  if (typeof root.sessionId === 'string') {
    return root as unknown as BrowserWorkflowPayload;
  }
  for (const value of Object.values(root)) {
    if (!value || typeof value !== 'object') continue;
    const nested = extractBrowserPayload(value);
    if (nested?.sessionId) return nested;
  }
  return null;
}

export async function resolveBrowserSession(input: {
  node: any;
  nodeInput: unknown;
  runId: string;
}): Promise<{ sessionId: string; payload: BrowserWorkflowPayload }> {
  const config = input.node?.config ?? {};
  const inherited = extractBrowserPayload(input.nodeInput);

  if (typeof config.sessionId === 'string' && config.sessionId.trim()) {
    const sessionId = config.sessionId.trim();
    const existing = browserAutomationService.getSession(sessionId);
    if (!existing) {
      throw new Error(`Browser session not found or expired: ${sessionId}`);
    }
    return {
      sessionId,
      payload: {
        ...(inherited ?? { status: 'succeeded', sessionId }),
        sessionId,
        url: existing.url,
        title: existing.title,
        source: existing.source,
        embedRuntimeId: existing.embedRuntimeId,
      },
    };
  }

  if (typeof config.sessionFrom === 'string' && config.sessionFrom.trim()) {
    const resolved = resolvePath(unwrapPayload(input.nodeInput), config.sessionFrom.trim());
    const fromPath = extractBrowserPayload(resolved)
      ?? (typeof resolved === 'string' ? { sessionId: resolved, status: 'succeeded' as const } : null);
    if (fromPath?.sessionId) {
      return { sessionId: fromPath.sessionId, payload: fromPath };
    }
  }

  if (inherited?.sessionId) {
    const existing = browserAutomationService.getSession(inherited.sessionId);
    if (existing) {
      return { sessionId: inherited.sessionId, payload: inherited };
    }
  }

  if (typeof config.embedRuntimeId === 'string' && config.embedRuntimeId.trim()) {
    const session = await browserAutomationService.createSession({ embedRuntimeId: config.embedRuntimeId.trim() });
    return {
      sessionId: session.sessionId,
      payload: {
        sessionId: session.sessionId,
        source: 'embed',
        embedRuntimeId: config.embedRuntimeId.trim(),
        url: session.url,
        title: session.title,
        status: 'succeeded',
      },
    };
  }

  if (typeof config.url === 'string' && config.url.trim()) {
    const session = await browserAutomationService.createSession({
      url: config.url.trim(),
      showManaged: config.showManaged === true,
    });
    return {
      sessionId: session.sessionId,
      payload: {
        sessionId: session.sessionId,
        source: 'managed',
        url: session.url,
        title: session.title,
        status: 'succeeded',
      },
    };
  }

  throw new Error(
    `浏览器节点 ${input.node?.id ?? 'unknown'} 缺少 sessionId / sessionFrom / embedRuntimeId / url 配置，且上游未提供 browser.sessionId`,
  );
}

export function buildBrowserSuccessPacket(
  ctx: RunCtx,
  node: any,
  payload: BrowserWorkflowPayload,
  extra?: Record<string, unknown>,
): WorkflowPacket {
  return createWorkflowPacket({
    runId: ctx.runId,
    nodeId: node.id,
    nodeType: node.type,
    payload: {
      browser: payload,
      ...extra,
    },
  });
}

export function buildBrowserFailurePacket(
  ctx: RunCtx,
  node: any,
  message: string,
  attempt = 0,
): WorkflowPacket {
  return createFailurePacket({
    runId: ctx.runId,
    nodeId: node.id,
    nodeType: node.type,
    attempt,
    code: 'BROWSER_NODE_FAILED',
    category: 'browser_automation',
    message,
    retryable: false,
  });
}

export function readValidators(node: any): BrowserAutomationValidatorSpec[] {
  const config = node?.config ?? {};
  if (Array.isArray(config.validators)) {
    return config.validators as BrowserAutomationValidatorSpec[];
  }
  if (config.validator && typeof config.validator === 'object') {
    return [config.validator as BrowserAutomationValidatorSpec];
  }
  return [];
}

export function defaultEmbedSessionId(embedRuntimeId: string): string {
  return buildEmbedSessionId(embedRuntimeId);
}
