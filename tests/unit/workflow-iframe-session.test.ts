import { describe, expect, it, vi } from 'vitest';

import {
  createWorkflowHostInitMessage,
  dispatchReadyWorkflowIframeIntent,
  isAuthenticatedWorkflowIframeEvent,
  isReadyWorkflowIframeEvent,
  resetWorkflowIframeSessionResources,
  shouldMaskWorkflowIframe,
  shouldResendWorkflowHostInit,
} from '@/pages/Workflow/components/workflow-iframe-session';
import {
  WORKFLOW_EDITOR_READY,
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  WORKFLOW_LOCAL_RUN_HISTORY_REQUEST,
  WORKFLOW_TRY_RUN_REQUEST,
} from '@/lib/workflow-iframe-bridge';

const identity = {
  workflowId: 'wf_123',
  nonce: 'nonce-1',
  handshakeRequestId: 'handshake-1',
};

function eventFor(data: unknown, overrides: Partial<MessageEvent<unknown>> = {}): MessageEvent<unknown> {
  return {
    origin: 'https://mc.example.com',
    source: window,
    data,
    ...overrides,
  } as MessageEvent<unknown>;
}

describe('workflow iframe session identity', () => {
  it('invalidates Host orchestration before disposing request managers and resetting capabilities', () => {
    const order: string[] = [];

    resetWorkflowIframeSessionResources({
      invalidateHostSession: () => order.push('invalidate'),
      disposePersistedRequests: () => order.push('dispose-persisted'),
      disposeLegacyRequests: () => order.push('dispose-legacy'),
      resetCapabilities: () => order.push('capabilities-false'),
    });

    expect(order).toEqual([
      'invalidate',
      'dispose-persisted',
      'dispose-legacy',
      'capabilities-false',
    ]);
  });

  it('builds one capability init with the fixed session identity', () => {
    expect(createWorkflowHostInitMessage(identity)).toEqual({
      protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
      type: 'workflow-host-init',
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      requestId: 'handshake-1',
      capabilities: ['localTrialRun', 'hostBack', 'localRunHistory'],
    });
  });

  it('authenticates source, origin, nonce, workflow, and request id together', () => {
    const payload = {
      protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
      type: WORKFLOW_TRY_RUN_REQUEST,
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      requestId: 'req-1',
    };
    const expected = {
      expectedOrigin: 'https://mc.example.com',
      expectedSource: window,
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      requestId: 'req-1',
    };

    expect(isAuthenticatedWorkflowIframeEvent(eventFor(payload), expected)).toBe(true);
    expect(isAuthenticatedWorkflowIframeEvent(eventFor(payload, { origin: 'https://evil.example.com' }), expected)).toBe(false);
    expect(isAuthenticatedWorkflowIframeEvent(eventFor(payload, { source: null }), expected)).toBe(false);
    expect(isAuthenticatedWorkflowIframeEvent(eventFor(payload, { source: null }), {
      ...expected,
      expectedSource: null,
    })).toBe(false);
    expect(isAuthenticatedWorkflowIframeEvent(eventFor({ ...payload, nonce: 'wrong' }), expected)).toBe(false);
    expect(isAuthenticatedWorkflowIframeEvent(eventFor({ ...payload, workflowId: 'wf_other' }), expected)).toBe(false);
    expect(isAuthenticatedWorkflowIframeEvent(eventFor({ ...payload, requestId: 'req-other' }), expected)).toBe(false);
  });

  it('reports ready only for the handshake and both required editor capabilities', () => {
    const ready = {
      protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
      type: WORKFLOW_EDITOR_READY,
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      requestId: 'handshake-1',
      capabilities: ['ownsHeader', 'persistBeforeTrialRun'],
    };
    const context = {
      expectedOrigin: 'https://mc.example.com',
      expectedSource: window,
      ...identity,
    };

    expect(isReadyWorkflowIframeEvent(eventFor(ready), context)).toBe(true);
    expect(isReadyWorkflowIframeEvent(eventFor({ ...ready, requestId: 'req-other' }), context)).toBe(false);
    expect(isReadyWorkflowIframeEvent(eventFor({ ...ready, capabilities: ['ownsHeader'] }), context)).toBe(false);
    expect(isReadyWorkflowIframeEvent(eventFor({ ...ready, capabilities: ['persistBeforeTrialRun'] }), context)).toBe(false);
    expect(isReadyWorkflowIframeEvent(eventFor({ ...ready, capabilities: ['ownsHeader', 'unknown'] }), context)).toBe(false);
  });

  it('resends the same init only for an authenticated pre-ready designer mount', () => {
    const metric = {
      protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
      type: 'workflow-performance-metric',
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      stage: 'designer_mounted',
      elapsedMs: 12,
    };
    const context = {
      expectedOrigin: 'https://mc.example.com',
      expectedSource: window,
      workflowId: 'wf_123',
      nonce: 'nonce-1',
    };

    expect(shouldResendWorkflowHostInit(eventFor(metric), context, false)).toBe(true);
    expect(shouldResendWorkflowHostInit(eventFor(metric), context, true)).toBe(false);
    expect(shouldResendWorkflowHostInit(eventFor({ ...metric, nonce: 'wrong' }), context, false)).toBe(false);
    expect(shouldResendWorkflowHostInit(eventFor({ ...metric, stage: 'workflow_loaded' }), context, false)).toBe(false);
  });

  it('dispatches try-run and back only after the exact ready handshake', () => {
    const onTryRunRequest = vi.fn();
    const onBackRequest = vi.fn();
    const onLocalRunHistoryRequest = vi.fn();
    const context = {
      expectedOrigin: 'https://mc.example.com',
      expectedSource: window,
      ...identity,
    };
    const tryRun = {
      protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
      type: WORKFLOW_TRY_RUN_REQUEST,
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      requestId: 'run-1',
      preparation: { mode: 'persist-draft' },
    };
    const back = { ...tryRun, type: 'workflow-back-request', requestId: 'back-1' };
    const history = { ...tryRun, type: WORKFLOW_LOCAL_RUN_HISTORY_REQUEST, requestId: 'history-1' };
    const callbacks = { onTryRunRequest, onBackRequest, onLocalRunHistoryRequest };

    expect(dispatchReadyWorkflowIframeIntent(eventFor(tryRun), context, false, callbacks)).toBe(false);
    expect(dispatchReadyWorkflowIframeIntent(eventFor(back), context, false, callbacks)).toBe(false);
    expect(dispatchReadyWorkflowIframeIntent(eventFor(history), context, false, callbacks)).toBe(false);
    expect(onTryRunRequest).not.toHaveBeenCalled();
    expect(onBackRequest).not.toHaveBeenCalled();
    expect(onLocalRunHistoryRequest).not.toHaveBeenCalled();

    const wrongReady = {
      ...tryRun,
      type: WORKFLOW_EDITOR_READY,
      requestId: 'wrong-handshake',
      capabilities: ['ownsHeader', 'persistBeforeTrialRun'],
    };
    expect(isReadyWorkflowIframeEvent(eventFor(wrongReady), context)).toBe(false);
    expect(dispatchReadyWorkflowIframeIntent(eventFor(tryRun), context, false, callbacks)).toBe(false);

    const ready = {
      ...wrongReady,
      requestId: 'handshake-1',
    };
    expect(isReadyWorkflowIframeEvent(eventFor({ ...ready, capabilities: ['ownsHeader'] }), context)).toBe(false);
    expect(isReadyWorkflowIframeEvent(eventFor(ready), context)).toBe(true);

    expect(dispatchReadyWorkflowIframeIntent(eventFor(tryRun), context, true, callbacks)).toBe(true);
    expect(dispatchReadyWorkflowIframeIntent(eventFor(back), context, true, callbacks)).toBe(true);
    expect(dispatchReadyWorkflowIframeIntent(eventFor(history), context, true, callbacks)).toBe(true);
    expect(onTryRunRequest).toHaveBeenCalledOnce();
    expect(onTryRunRequest).toHaveBeenCalledWith('run-1', { mode: 'persist-draft' });
    expect(onBackRequest).toHaveBeenCalledOnce();
    expect(onLocalRunHistoryRequest).toHaveBeenCalledOnce();
  });

  it('defaults a legacy Web try-run request to draft persistence', () => {
    const onTryRunRequest = vi.fn();
    const context = {
      expectedOrigin: 'https://mc.example.com',
      expectedSource: window,
      ...identity,
    };
    const legacyTryRun = {
      protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
      type: WORKFLOW_TRY_RUN_REQUEST,
      workflowId: 'wf_123',
      nonce: 'nonce-1',
      requestId: 'legacy-run-1',
    };

    expect(dispatchReadyWorkflowIframeIntent(
      eventFor(legacyTryRun),
      context,
      true,
      { onTryRunRequest },
    )).toBe(true);
    expect(onTryRunRequest).toHaveBeenCalledWith(
      'legacy-run-1',
      { mode: 'persist-draft' },
    );
  });

  it('masks loaded iframe content until the header handshake succeeds or falls back', () => {
    expect(shouldMaskWorkflowIframe({ iframeLoading: true, editorReady: false, handshakeFallback: false })).toBe(true);
    expect(shouldMaskWorkflowIframe({ iframeLoading: false, editorReady: false, handshakeFallback: false })).toBe(true);
    expect(shouldMaskWorkflowIframe({ iframeLoading: false, editorReady: true, handshakeFallback: false })).toBe(false);
    expect(shouldMaskWorkflowIframe({ iframeLoading: false, editorReady: false, handshakeFallback: true })).toBe(false);
  });
});
