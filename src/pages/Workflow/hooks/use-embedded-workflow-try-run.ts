import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import type {
  WorkflowDraftSnapshot,
  WorkflowRunnableSnapshot,
  WorkflowSavedDraftSnapshot,
  WorkflowTryRunPreparation,
  WorkflowTryRunState,
} from '@/lib/workflow-iframe-bridge';
import type { WorkflowMcIframeEditorHandle } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import { mapWorkflowRunStatusToTryRunState } from '@/pages/Workflow/hooks/workflow-try-run-display-state';

type TryRunRequestSource = 'web' | 'host-fallback';
type TryRunRequestPhase = 'confirming' | 'preparing' | 'running';

interface ActiveTryRunRequest {
  requestId: string;
  epoch: number;
  workflowId: string;
  sessionIdentity: string;
  editor: WorkflowMcIframeEditorHandle | null;
  source: TryRunRequestSource;
  phase: TryRunRequestPhase;
  previousRunId: string | null;
  runId: string | null;
  terminalState: 'cancelled' | 'failed' | 'completed' | null;
  preparation: WorkflowTryRunPreparation | null;
}

export interface UseEmbeddedWorkflowTryRunOptions {
  workflowId: string;
  editorSessionIdentity: string | number;
  editorRef: RefObject<WorkflowMcIframeEditorHandle | null>;
  editorCapabilitiesReady: boolean;
  beginTryRun: (snapshot: WorkflowDraftSnapshot) => void;
  isRunActive: boolean;
  isRunStarting: boolean;
  runId: string | null;
  runStatus: string | null | undefined;
  launchError: string | null;
  createRequestId?: () => string;
}

export interface EmbeddedWorkflowTryRunController {
  confirmOpen: boolean;
  requestInFlight: boolean;
  requestFromWeb: (requestId: string, preparation?: WorkflowTryRunPreparation) => void;
  requestFromHostFallback: () => void;
  cancelConfirmation: () => void;
  confirmAndPrepare: () => Promise<void>;
  rerun: () => Promise<void>;
  invalidateSession: () => void;
}

function defaultRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `workflow-try-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function usesCurrentSavedSnapshot(
  preparation: WorkflowTryRunPreparation | null | undefined,
): preparation is Exclude<WorkflowTryRunPreparation, { mode: 'persist-draft' }> {
  return (
    preparation?.mode === 'use-current-published' ||
    preparation?.mode === 'use-current-draft'
  );
}

/** Convert the validated Web wire DTO into the stricter local runtime model. */
export function normalizeWorkflowSavedDraftSnapshot(
  snapshot: WorkflowSavedDraftSnapshot | WorkflowRunnableSnapshot,
): WorkflowDraftSnapshot {
  const wireSchema = snapshot.startup.schema;
  const schema = wireSchema === null
    ? null
    : {
        nodeId: wireSchema.nodeId ?? '',
        enabled: wireSchema.enabled,
        steps: wireSchema.steps.map((step, index) => ({
          ...step,
          mode: step.mode ?? 'confirm',
          order: step.order ?? index + 1,
        })),
        fields: wireSchema.fields.map((field, index) => ({
          ...field,
          order: field.order ?? index + 1,
          component: field.component ?? 'text',
          options: field.options?.map((option) => ({ ...option })),
          items: field.items?.map((item) => ({ ...item })),
        })),
      };

  return {
    workflowId: snapshot.workflowId,
    workflowVersionId: snapshot.workflowVersionId,
    schemaVersion: snapshot.schemaVersion,
    versionStatus: snapshot.versionStatus,
    startup: {
      schema,
      defaultValues: { ...snapshot.startup.defaultValues },
    },
  };
}

export function useEmbeddedWorkflowTryRun({
  workflowId,
  editorSessionIdentity,
  editorRef,
  editorCapabilitiesReady,
  beginTryRun,
  isRunActive,
  isRunStarting,
  runId,
  runStatus,
  launchError,
  createRequestId = defaultRequestId,
}: UseEmbeddedWorkflowTryRunOptions): EmbeddedWorkflowTryRunController {
  const sessionIdentity = `${workflowId}\u0000${String(editorSessionIdentity)}`;
  const [uiState, setUiState] = useState({
    sessionIdentity,
    confirmOpen: false,
    requestInFlight: false,
  });
  const activeRequestRef = useRef<ActiveTryRunRequest | null>(null);
  const inFlightRequestRef = useRef<ActiveTryRunRequest | null>(null);
  const requestInFlightRef = useRef(false);
  const disposedRef = useRef(false);
  const attemptEpochRef = useRef(0);
  const handledWebRequestIdsRef = useRef(new Set<string>());
  const sessionIdentityRef = useRef(sessionIdentity);

  const isCurrentAttempt = (request: ActiveTryRunRequest) => (
    !disposedRef.current &&
    activeRequestRef.current === request &&
    request.epoch === attemptEpochRef.current &&
    request.workflowId === workflowId &&
    request.sessionIdentity === sessionIdentityRef.current
  );

  const sendState = (
    request: ActiveTryRunRequest,
    state: WorkflowTryRunState,
    message?: string,
  ) => {
    if (message === undefined) {
      request.editor?.sendTryRunState(request.requestId, state);
    } else {
      request.editor?.sendTryRunState(request.requestId, state, message);
    }
  };

  const returnToIdle = (request: ActiveTryRunRequest) => {
    sendState(request, 'idle');
    if (activeRequestRef.current === request) activeRequestRef.current = null;
    setUiState({ sessionIdentity, confirmOpen: false, requestInFlight: false });
  };

  const reportError = (request: ActiveTryRunRequest, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '试运行准备失败');
    sendState(request, 'error', message);
    toast.error(message);
    returnToIdle(request);
  };

  const prepare = async (request: ActiveTryRunRequest) => {
    if (requestInFlightRef.current || !isCurrentAttempt(request)) return;
    if (isRunActive || isRunStarting) {
      reportError(request, '已有试运行正在进行，请稍后重试');
      return;
    }

    const editor = request.editor;
    if (!editor) {
      reportError(request, '画布尚未加载完成，请稍后重试');
      return;
    }
    if (request.source === 'web' && !editorCapabilitiesReady) {
      reportError(request, '编辑器试运行能力尚未准备完成，请稍后重试');
      return;
    }

    requestInFlightRef.current = true;
    inFlightRequestRef.current = request;
    setUiState({ sessionIdentity, confirmOpen: false, requestInFlight: true });
    try {
      let snapshot: WorkflowDraftSnapshot;
      if (request.source === 'web' && usesCurrentSavedSnapshot(request.preparation)) {
        sendState(request, 'preparing');
        snapshot = normalizeWorkflowSavedDraftSnapshot(request.preparation.snapshot);
      } else if (request.source === 'web') {
        sendState(request, 'saving');
        const saved = await editor.requestPersistedDraftSnapshot(request.requestId);
        if (!isCurrentAttempt(request)) return;
        if (saved.workflowId !== request.workflowId) {
          throw new Error('保存结果与当前工作流不匹配，请重新发起试运行');
        }
        snapshot = normalizeWorkflowSavedDraftSnapshot(saved);
        sendState(request, 'preparing');
      } else {
        snapshot = await editor.requestLegacyDraftSnapshot();
        if (!isCurrentAttempt(request)) return;
      }
      if (!isCurrentAttempt(request)) return;
      request.phase = 'preparing';
      beginTryRun(snapshot);
    } catch (error) {
      if (isCurrentAttempt(request)) reportError(request, error);
    } finally {
      if (inFlightRequestRef.current === request) {
        inFlightRequestRef.current = null;
        requestInFlightRef.current = false;
        if (!disposedRef.current && sessionIdentityRef.current === request.sessionIdentity) {
          setUiState({
            sessionIdentity: request.sessionIdentity,
            confirmOpen: false,
            requestInFlight: false,
          });
        }
      }
    }
  };

  const requestFromWeb = (
    requestId: string,
    preparation: WorkflowTryRunPreparation = { mode: 'persist-draft' },
  ) => {
    const normalizedRequestId = requestId.trim();
    if (!normalizedRequestId) {
      editorRef.current?.sendTryRunState('', 'error', '试运行请求标识无效，请重新发起');
      editorRef.current?.sendTryRunState('', 'idle');
      return;
    }
    if (handledWebRequestIdsRef.current.has(normalizedRequestId)) return;
    handledWebRequestIdsRef.current.add(normalizedRequestId);
    const current = activeRequestRef.current;
    if (current?.requestId === normalizedRequestId) return;
    if (current || requestInFlightRef.current || isRunActive || isRunStarting) {
      const rejected: ActiveTryRunRequest = {
        requestId: normalizedRequestId,
        epoch: attemptEpochRef.current,
        workflowId,
        sessionIdentity,
        editor: editorRef.current,
        source: 'web',
        phase: 'confirming',
        previousRunId: runId,
        runId: null,
        terminalState: null,
        preparation,
      };
      sendState(rejected, 'error', '已有试运行正在进行，请稍后重试');
      sendState(rejected, 'idle');
      return;
    }
    const request: ActiveTryRunRequest = {
      requestId: normalizedRequestId,
      epoch: attemptEpochRef.current,
      workflowId,
      sessionIdentity,
      editor: editorRef.current,
      source: 'web',
      phase: 'confirming',
      previousRunId: runId,
      runId: null,
      terminalState: null,
      preparation,
    };
    activeRequestRef.current = request;
    if (usesCurrentSavedSnapshot(preparation)) {
      setUiState({ sessionIdentity, confirmOpen: false, requestInFlight: false });
      void prepare(request);
    } else {
      setUiState({ sessionIdentity, confirmOpen: true, requestInFlight: false });
      sendState(request, 'confirming');
    }
  };

  const requestFromHostFallback = () => {
    if (editorCapabilitiesReady || activeRequestRef.current || requestInFlightRef.current) return;
    if (isRunActive || isRunStarting) return;
    activeRequestRef.current = {
      requestId: createRequestId(),
      epoch: attemptEpochRef.current,
      workflowId,
      sessionIdentity,
      editor: editorRef.current,
      source: 'host-fallback',
      phase: 'confirming',
      previousRunId: runId,
      runId: null,
      terminalState: null,
      preparation: null,
    };
    setUiState({ sessionIdentity, confirmOpen: true, requestInFlight: false });
  };

  const cancelConfirmation = () => {
    const request = activeRequestRef.current;
    if (!request || requestInFlightRef.current) return;
    returnToIdle(request);
  };

  const confirmAndPrepare = async () => {
    const request = activeRequestRef.current;
    if (!request || request.phase !== 'confirming') return;
    await prepare(request);
  };

  const rerun = async () => {
    if (requestInFlightRef.current || isRunActive || isRunStarting) return;
    const previous = activeRequestRef.current;
    if (previous) returnToIdle(previous);
    const request: ActiveTryRunRequest = {
      requestId: createRequestId(),
      epoch: attemptEpochRef.current,
      workflowId,
      sessionIdentity,
      editor: editorRef.current,
      source: editorCapabilitiesReady ? 'web' : 'host-fallback',
      phase: 'confirming',
      previousRunId: runId,
      runId: null,
      terminalState: null,
      preparation: editorCapabilitiesReady ? { mode: 'persist-draft' } : null,
    };
    activeRequestRef.current = request;
    await prepare(request);
  };

  const invalidateSession = () => {
    attemptEpochRef.current += 1;
    handledWebRequestIdsRef.current.clear();
    activeRequestRef.current = null;
    inFlightRequestRef.current = null;
    requestInFlightRef.current = false;
    if (!disposedRef.current) {
      setUiState({ sessionIdentity, confirmOpen: false, requestInFlight: false });
    }
  };

  useEffect(() => {
    attemptEpochRef.current += 1;
    handledWebRequestIdsRef.current.clear();
    sessionIdentityRef.current = sessionIdentity;
    activeRequestRef.current = null;
    inFlightRequestRef.current = null;
    requestInFlightRef.current = false;
  }, [sessionIdentity]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      activeRequestRef.current = null;
      inFlightRequestRef.current = null;
      requestInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    const running = isRunActive || isRunStarting;
    const displayState = mapWorkflowRunStatusToTryRunState(runStatus);
    const request = activeRequestRef.current;
    const current = Boolean(
      request &&
      !disposedRef.current &&
      activeRequestRef.current === request &&
      request.epoch === attemptEpochRef.current &&
      request.workflowId === workflowId &&
      request.sessionIdentity === sessionIdentityRef.current,
    );
    if (!request || !current) return;
    if (running && request.phase !== 'running') {
      request.phase = 'running';
      sendState(request, 'running');
    }
    if (request.phase === 'running' && runId && runId !== request.previousRunId) {
      request.runId = runId;
    }
    if (
      request.phase === 'running' &&
      request.runId &&
      request.runId === runId &&
      displayState &&
      displayState !== 'running' &&
      request.terminalState === null &&
      !launchError
    ) {
      request.terminalState = displayState;
      sendState(request, displayState);
      if (activeRequestRef.current === request) activeRequestRef.current = null;
      setUiState({ sessionIdentity, confirmOpen: false, requestInFlight: false });
    }
  }, [isRunActive, isRunStarting, launchError, runId, runStatus, sessionIdentity, workflowId]);

  useEffect(() => {
    const request = activeRequestRef.current;
    const current = Boolean(
      request &&
      !disposedRef.current &&
      activeRequestRef.current === request &&
      request.epoch === attemptEpochRef.current &&
      request.workflowId === workflowId &&
      request.sessionIdentity === sessionIdentityRef.current,
    );
    if (!launchError || !request || !current || request.phase === 'confirming') return;
    request.editor?.sendTryRunState(request.requestId, 'error', launchError);
    toast.error(launchError);
    request.editor?.sendTryRunState(request.requestId, 'idle');
    if (activeRequestRef.current === request) activeRequestRef.current = null;
    setUiState({ sessionIdentity, confirmOpen: false, requestInFlight: false });
  }, [launchError, sessionIdentity, workflowId]);

  return {
    confirmOpen: uiState.sessionIdentity === sessionIdentity && uiState.confirmOpen,
    requestInFlight: uiState.sessionIdentity === sessionIdentity && uiState.requestInFlight,
    requestFromWeb,
    requestFromHostFallback,
    cancelConfirmation,
    confirmAndPrepare,
    rerun,
    invalidateSession,
  };
}
