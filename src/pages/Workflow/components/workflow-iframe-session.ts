import {
  WORKFLOW_HOST_INIT,
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  isWorkflowBackRequest,
  isWorkflowEditorReady,
  isWorkflowLocalRunHistoryRequest,
  isWorkflowPerformanceMetric,
  isWorkflowTryRunRequest,
  type WorkflowHostInitMessage,
} from '@/lib/workflow-iframe-bridge';

export interface WorkflowIframeSessionIdentity {
  workflowId: string;
  nonce: string;
  handshakeRequestId: string;
}

interface WorkflowIframeEventIdentity {
  expectedOrigin: string;
  expectedSource: MessageEventSource | null;
  workflowId: string;
  nonce: string;
  requestId?: string;
}

interface WorkflowIframeSessionResetActions {
  invalidateHostSession?: () => void;
  disposePersistedRequests: () => void;
  disposeLegacyRequests: () => void;
  resetCapabilities: () => void;
}

/** Keep this order synchronous: Host guards must advance before manager disposal rejects promises. */
export function resetWorkflowIframeSessionResources({
  invalidateHostSession,
  disposePersistedRequests,
  disposeLegacyRequests,
  resetCapabilities,
}: WorkflowIframeSessionResetActions): void {
  invalidateHostSession?.();
  disposePersistedRequests();
  disposeLegacyRequests();
  resetCapabilities();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createWorkflowHostInitMessage(
  identity: WorkflowIframeSessionIdentity,
): WorkflowHostInitMessage {
  return {
    protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
    type: WORKFLOW_HOST_INIT,
    workflowId: identity.workflowId,
    nonce: identity.nonce,
    requestId: identity.handshakeRequestId,
    capabilities: ['localTrialRun', 'hostBack', 'localRunHistory'],
  };
}

export function isAuthenticatedWorkflowIframeEvent(
  event: MessageEvent<unknown>,
  identity: WorkflowIframeEventIdentity,
): boolean {
  if (
    identity.expectedSource === null ||
    event.origin !== identity.expectedOrigin ||
    event.source !== identity.expectedSource ||
    !isRecord(event.data)
  ) return false;

  return (
    event.data.protocol === WORKFLOW_IFRAME_BRIDGE_PROTOCOL &&
    event.data.workflowId === identity.workflowId &&
    event.data.nonce === identity.nonce &&
    (identity.requestId === undefined || event.data.requestId === identity.requestId)
  );
}

export function isReadyWorkflowIframeEvent(
  event: MessageEvent<unknown>,
  identity: WorkflowIframeEventIdentity & { handshakeRequestId: string },
): boolean {
  if (!isWorkflowEditorReady(event.data)) return false;
  if (!isAuthenticatedWorkflowIframeEvent(event, {
    ...identity,
    requestId: identity.handshakeRequestId,
  })) return false;
  return (
    event.data.capabilities.includes('ownsHeader') &&
    event.data.capabilities.includes('persistBeforeTrialRun')
  );
}

export function shouldResendWorkflowHostInit(
  event: MessageEvent<unknown>,
  identity: WorkflowIframeEventIdentity,
  editorReady: boolean,
): boolean {
  return (
    !editorReady &&
    isWorkflowPerformanceMetric(event.data) &&
    event.data.stage === 'designer_mounted' &&
    isAuthenticatedWorkflowIframeEvent(event, identity)
  );
}

export function dispatchReadyWorkflowIframeIntent(
  event: MessageEvent<unknown>,
  identity: WorkflowIframeEventIdentity,
  editorReady: boolean,
  callbacks: {
    onTryRunRequest?: (requestId: string) => void;
    onBackRequest?: () => void;
    onLocalRunHistoryRequest?: () => void;
  },
): boolean {
  if (!editorReady || !isAuthenticatedWorkflowIframeEvent(event, identity)) return false;
  if (isWorkflowTryRunRequest(event.data)) {
    callbacks.onTryRunRequest?.(event.data.requestId);
    return true;
  }
  if (isWorkflowBackRequest(event.data)) {
    callbacks.onBackRequest?.();
    return true;
  }
  if (isWorkflowLocalRunHistoryRequest(event.data)) {
    callbacks.onLocalRunHistoryRequest?.();
    return true;
  }
  return false;
}

export function shouldMaskWorkflowIframe({
  iframeLoading,
  editorReady,
  handshakeFallback,
}: {
  iframeLoading: boolean;
  editorReady: boolean;
  handshakeFallback: boolean;
}): boolean {
  return iframeLoading || (!editorReady && !handshakeFallback);
}
