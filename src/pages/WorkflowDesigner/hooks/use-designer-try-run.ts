/**
 * Designer local trial-run state machine (canvas migration Task 4).
 *
 * Drives a client-local "试运行" flow independently from its canvas host:
 *   begin → (StartupRunDialog if schema has inputs) → startWorkflowLocal
 *   → workflow:status-update broadcast (sessionKey='designer-try-run')
 *   → hydrate full run via getRunViaIpc → WorkflowExecutionState → TestRunDrawer
 *
 * Replaces the web SSE/polling stack (see spec §5). All execution happens in
 * the client workflow-runtime engine; this hook only observes its broadcasts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelRun,
  getRunViaIpc,
  retryWorkflowSync,
  resumeWorkflowApproval,
  runToExecutionState,
  startWorkflowLocal,
  getWorkflowDetail,
  submitWorkflowInput,
} from '@/lib/workflow-api';
import {
  isActiveWorkflowRunStatus,
  isTerminalWorkflowRunStatus,
  normalizeWorkflowRunStatus,
} from '@/lib/workflow-run-status';
import type { WorkflowExecutionState, WorkflowRunResponse, WorkflowSchema } from '@/types/workflow';
import type { WorkflowDraftSnapshot } from '@/lib/workflow-iframe-bridge';
import { definitionFromDetail } from '@/lib/workflow-designer-adapter';

export interface RuntimeUploadNode {
  nodeId: string;
  name: string;
  acceptedExtensions?: string[];
  maxFiles?: number;
}

export const DESIGNER_TRY_RUN_SESSION_KEY = 'designer-try-run';
const EMPTY_STARTUP_DEFAULT_VALUES: Record<string, unknown> = {};

interface StatusUpdatePayload {
  runId: string;
  sessionKey: string | null;
  status: string;
}

interface RuntimeEventPayload {
  runId: string;
  sequence: number;
  type: string;
  nodeId?: string;
}

export interface UseDesignerTryRunArgs {
  workflowId: string | undefined;
  startupSchema: WorkflowSchema | null | undefined;
  startupDefaultValues?: Record<string, unknown>;
  workflowVersionId?: string | number;
  /** Caller guard for hosts that need to block launching. */
  canStart: () => boolean;
}

export interface UseDesignerTryRunResult {
  runId: string | null;
  run: WorkflowRunResponse | null;
  runWorkflowVersionId?: string | number;
  executionState: WorkflowExecutionState | null;
  isStarting: boolean;
  isCancelling: boolean;
  isSyncing: boolean;
  isStartupDialogOpen: boolean;
  isDrawerOpen: boolean;
  isRunActive: boolean;
  isDraftSnapshot: boolean;
  startupSchema: WorkflowSchema | null;
  startupDefaultValues: Record<string, unknown>;
  runtimeUploadNodes: RuntimeUploadNode[];
  launchError: string | null;
  begin: (snapshot?: WorkflowDraftSnapshot) => void;
  confirmStartup: (inputs: Record<string, unknown>) => Promise<void>;
  cancelStartupDialog: () => void;
  cancel: () => Promise<void>;
  rerun: () => void;
  closeDrawer: () => void;
  decideApproval: (approved: boolean, note?: string) => Promise<void>;
  submitInput: (values: Record<string, unknown>) => Promise<void>;
  retrySync: () => Promise<void>;
}

export function useDesignerTryRun({
  workflowId,
  startupSchema,
  startupDefaultValues = EMPTY_STARTUP_DEFAULT_VALUES,
  workflowVersionId,
  canStart,
}: UseDesignerTryRunArgs): UseDesignerTryRunResult {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<WorkflowRunResponse | null>(null);
  const [runWorkflowVersionId, setRunWorkflowVersionId] = useState<string | number | undefined>();
  const [executionState, setExecutionState] = useState<WorkflowExecutionState | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isStartupDialogOpen, setIsStartupDialogOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeStartupSchema, setActiveStartupSchema] = useState<WorkflowSchema | null>(startupSchema ?? null);
  const [activeStartupDefaultValues, setActiveStartupDefaultValues] = useState<Record<string, unknown>>(startupDefaultValues);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isDraftSnapshot, setIsDraftSnapshot] = useState(false);
  const [runtimeUploadNodes, setRuntimeUploadNodes] = useState<RuntimeUploadNode[]>([]);
  const snapshotRef = useRef<WorkflowDraftSnapshot | null>(null);

  const runIdRef = useRef<string | null>(null);
  const eventHydrateTimerRef = useRef<number | null>(null);
  useEffect(() => {
    runIdRef.current = runId;
  }, [runId]);

  const hasStartupInputs = Boolean(
    activeStartupSchema?.enabled && Array.isArray(activeStartupSchema.fields) && activeStartupSchema.fields.length > 0,
  );

  const hydrateRun = useCallback(async (id: string) => {
    try {
      const run = await getRunViaIpc(id);
      if (run) {
        setRun(run);
        setExecutionState(runToExecutionState(run));
      }
    } catch {
      /* best-effort hydration; the next status-update broadcast retries */
    }
  }, []);

  const scheduleEventHydration = useCallback((id: string) => {
    if (eventHydrateTimerRef.current != null) return;
    eventHydrateTimerRef.current = window.setTimeout(() => {
      eventHydrateTimerRef.current = null;
      void hydrateRun(id);
    }, 100);
  }, [hydrateRun]);

  // Status transitions update immediately; stream events are coalesced so an
  // Agent text delta cannot cause a local DB read for every token.
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc?.on) return;
    const unsubscribe = ipc.on('workflow:status-update', (payload: unknown) => {
      const data = payload as StatusUpdatePayload | null;
      if (!data || data.sessionKey !== DESIGNER_TRY_RUN_SESSION_KEY) return;
      if (data.runId !== runIdRef.current) return; // stale broadcast for a different run
      void hydrateRun(data.runId);
      if (isTerminalWorkflowRunStatus(normalizeWorkflowRunStatus(data.status))) {
        setIsStarting(false);
        setIsCancelling(false);
      }
    });
    const unsubscribeEvent = ipc.on('workflow:event', (payload: unknown) => {
      const data = payload as RuntimeEventPayload | null;
      if (!data || !data.runId || data.runId !== runIdRef.current) return;
      scheduleEventHydration(data.runId);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      if (typeof unsubscribeEvent === 'function') unsubscribeEvent();
    };
  }, [hydrateRun, scheduleEventHydration]);

  useEffect(() => () => {
    if (eventHydrateTimerRef.current != null) window.clearTimeout(eventHydrateTimerRef.current);
  }, []);

  const isRunActive = Boolean(
    runId && executionState && isActiveWorkflowRunStatus(executionState.status),
  );

  const launch = useCallback(
    async (inputs: Record<string, unknown>, snapshot = snapshotRef.current) => {
      if (!workflowId) return;
      setIsStarting(true);
      setIsDrawerOpen(true);
      setRun(null);
      setExecutionState(null);
      setLaunchError(null);
      setRunId(null);
      runIdRef.current = null;
      try {
        const result = await startWorkflowLocal({
          workflowId,
          inputs,
          idempotencyKey: `designer-run-${Date.now()}`,
          sessionKey: DESIGNER_TRY_RUN_SESSION_KEY,
          runMode: 'trial',
          workflowVersionId: snapshot?.workflowVersionId ?? workflowVersionId,
        });
        setRunId(result.runId);
        runIdRef.current = result.runId;
        void hydrateRun(result.runId);
      } catch (error) {
        setIsStarting(false);
        setLaunchError(error instanceof Error ? error.message : '试运行启动失败');
      }
    },
    [workflowId, workflowVersionId, hydrateRun],
  );

  const begin = useCallback((snapshot?: WorkflowDraftSnapshot) => {
    if (!workflowId || !canStart()) return;
    void (async () => {
      snapshotRef.current = snapshot ?? null;
      setRunWorkflowVersionId(snapshot?.workflowVersionId ?? workflowVersionId);
      setIsDraftSnapshot(snapshot != null);
      const nextSchema = snapshot?.startup.schema ?? startupSchema ?? null;
      const nextDefaultValues = snapshot?.startup.defaultValues ?? startupDefaultValues;
      setActiveStartupSchema(nextSchema);
      setActiveStartupDefaultValues(nextDefaultValues);
      let definition = snapshot?.definition;
      if (!definition) definition = definitionFromDetail(await getWorkflowDetail(workflowId));
      const uploads = ((definition as any)?.nodes ?? []).flatMap((node: any) => {
        const business = node?.config?.businessConfig ?? {};
        return node?.type === 'agent_data_fetch' && ['runtime_upload', 'mixed'].includes(business.inputProvisionMode)
          ? [{
              nodeId: node.id,
              name: node.name ?? node.id,
              acceptedExtensions: business.localImport?.acceptedExtensions,
              maxFiles: Number.isInteger(business.localImport?.maxFiles) && business.localImport.maxFiles > 0
                ? business.localImport.maxFiles
                : undefined,
            }]
          : [];
      });
      setRuntimeUploadNodes(uploads);
      const nextHasStartupInputs = Boolean(nextSchema?.enabled && Array.isArray(nextSchema.fields) && nextSchema.fields.length > 0);
      if (nextHasStartupInputs || uploads.length > 0) setIsStartupDialogOpen(true);
      else void launch({}, snapshot ?? null);
    })().catch((error) => setLaunchError(error instanceof Error ? error.message : '无法读取试运行配置'));
  }, [workflowId, canStart, launch, startupDefaultValues, startupSchema, workflowVersionId]);

  const confirmStartup = useCallback(
    async (inputs: Record<string, unknown>) => {
      setIsStartupDialogOpen(false);
      await launch(inputs);
    },
    [launch],
  );

  const cancelStartupDialog = useCallback(() => setIsStartupDialogOpen(false), []);

  const cancel = useCallback(async () => {
    const id = runIdRef.current;
    if (!id) return;
    setIsCancelling(true);
    try {
      await cancelRun(id);
      void hydrateRun(id);
    } finally {
      setIsCancelling(false);
    }
  }, [hydrateRun]);

  const rerun = useCallback(() => {
    setRunId(null);
    runIdRef.current = null;
    setRun(null);
    setExecutionState(null);
    setLaunchError(null);
    if (hasStartupInputs || runtimeUploadNodes.length > 0) {
      setIsStartupDialogOpen(true);
    } else {
      void launch({}, snapshotRef.current);
    }
  }, [hasStartupInputs, launch, runtimeUploadNodes.length]);

  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const decideApproval = useCallback(async (approved: boolean, note?: string) => {
    const id = runIdRef.current;
    const nodeId = executionState?.waitingNodeId;
    if (!id || !nodeId) return;
    await resumeWorkflowApproval(id, nodeId, { approved, note });
    await hydrateRun(id);
  }, [executionState?.waitingNodeId, hydrateRun]);
  const submitInput = useCallback(async (values: Record<string, unknown>) => {
    const id = runIdRef.current;
    const nodeId = executionState?.waitingNodeId;
    if (!id || !nodeId) return;
    await submitWorkflowInput(id, nodeId, values);
    await hydrateRun(id);
  }, [executionState?.waitingNodeId, hydrateRun]);
  const retrySync = useCallback(async () => {
    const id = runIdRef.current;
    if (!id) return;
    setIsSyncing(true);
    try {
      await retryWorkflowSync(id);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return {
    runId,
    run,
    runWorkflowVersionId,
    executionState,
    isStarting,
    isCancelling,
    isSyncing,
    isStartupDialogOpen,
    isDrawerOpen,
    isRunActive,
    isDraftSnapshot,
    startupSchema: activeStartupSchema,
    startupDefaultValues: activeStartupDefaultValues,
    runtimeUploadNodes,
    launchError,
    begin,
    confirmStartup,
    cancelStartupDialog,
    cancel,
    rerun,
    closeDrawer,
    decideApproval,
    submitInput,
    retrySync,
  };
}
