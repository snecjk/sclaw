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
  resumeWorkflowRun,
  resumeWorkflowApproval,
  runToExecutionState,
  startWorkflowLocal,
  getWorkflowDetail,
  submitWorkflowInput,
} from '@/lib/workflow-api';
import { subscribeHostEvent } from '@/lib/host-events';
import {
  isActiveWorkflowRunStatus,
  isTerminalWorkflowRunStatus,
  normalizeWorkflowRunStatus,
} from '@/lib/workflow-run-status';
import type { WorkflowDetailResponse, WorkflowExecutionState, WorkflowRunResponse, WorkflowSchema } from '@/types/workflow';
import type { WorkflowDraftSnapshot } from '@/lib/workflow-iframe-bridge';
import { definitionFromDetail } from '@/lib/workflow-designer-adapter';
import { saveWorkflowExecution, updateExecutionStatus } from '@/stores/workflow-memory';

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
  runWorkflowVersion?: string | number | null;
  executionState: WorkflowExecutionState | null;
  isStarting: boolean;
  isCancelling: boolean;
  isStartupDialogOpen: boolean;
  isDrawerOpen: boolean;
  isRunActive: boolean;
  isDraftSnapshot: boolean;
  startupSchema: WorkflowSchema | null;
  startupDefaultValues: Record<string, unknown>;
  runtimeUploadNodes: RuntimeUploadNode[];
  launchError: string | null;
  begin: (snapshot?: WorkflowDraftSnapshot) => void;
  confirmStartup: (inputs: Record<string, unknown>, engineType: 'claude' | 'openclaw') => Promise<void>;
  cancelStartupDialog: () => void;
  cancel: () => Promise<void>;
  continueRun: () => Promise<void>;
  rerun: () => void;
  /** Open an already persisted local run in the shared result drawer. */
  openExistingRun: (runId: string) => Promise<boolean>;
  closeDrawer: () => void;
  decideApproval: (approved: boolean, note?: string) => Promise<void>;
  submitInput: (values: Record<string, unknown>) => Promise<void>;
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
  const [runWorkflowVersion, setRunWorkflowVersion] = useState<string | number | null | undefined>();
  const [executionState, setExecutionState] = useState<WorkflowExecutionState | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isStartupDialogOpen, setIsStartupDialogOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeStartupSchema, setActiveStartupSchema] = useState<WorkflowSchema | null>(startupSchema ?? null);
  const [activeStartupDefaultValues, setActiveStartupDefaultValues] = useState<Record<string, unknown>>(startupDefaultValues);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isDraftSnapshot, setIsDraftSnapshot] = useState(false);
  const [runtimeUploadNodes, setRuntimeUploadNodes] = useState<RuntimeUploadNode[]>([]);
  const snapshotRef = useRef<WorkflowDraftSnapshot | null>(null);
  const workflowNameRef = useRef<string>('');

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
      const run = await getRunViaIpc(id, 'detail');
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
    const unsubscribe = subscribeHostEvent('workflow:status-update', (payload: unknown) => {
      const data = payload as StatusUpdatePayload | null;
      if (!data || data.sessionKey !== DESIGNER_TRY_RUN_SESSION_KEY) return;
      if (data.runId !== runIdRef.current) return; // stale broadcast for a different run
      const normalizedStatus = normalizeWorkflowRunStatus(data.status);
      updateExecutionStatus(data.runId, normalizedStatus, DESIGNER_TRY_RUN_SESSION_KEY);
      void hydrateRun(data.runId);
      if (isTerminalWorkflowRunStatus(normalizedStatus)) {
        setIsStarting(false);
        setIsCancelling(false);
      }
    });
    const unsubscribeEvent = subscribeHostEvent('workflow:event', (payload: unknown) => {
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
    async (inputs: Record<string, unknown>, snapshot = snapshotRef.current, engineType: 'claude' | 'openclaw') => {
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
          agentId: 'main',
          triggerType: 'designer_test',
          runMode: 'trial',
          workflowVersionId: snapshot?.workflowVersionId ?? workflowVersionId,
          engineType,
        });
        setRunId(result.runId);
        runIdRef.current = result.runId;
        setRunWorkflowVersion(result.workflowVersion);
        const startedAt = Date.now();
        saveWorkflowExecution({
          sessionKey: DESIGNER_TRY_RUN_SESSION_KEY,
          workflowId,
          runId: result.runId,
          templateId: workflowId,
          templateName: workflowNameRef.current || workflowId,
          versionId: result.versionId,
          status: 'running',
          createdAt: startedAt,
          updatedAt: startedAt,
          collectedInputs: inputs,
        });
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
      setRunWorkflowVersion(undefined);
      setIsDraftSnapshot(snapshot?.versionStatus === 'draft');
      // The draft snapshot only carries canvas data. Fetch the workflow detail
      // on every launch so the startup form is initialized from this user's
      // current default preset, just like the web-side trial run.
      let workflowDetail: WorkflowDetailResponse | null = null;
      let definition = snapshot?.definition;
      try {
        workflowDetail = await getWorkflowDetail(workflowId);
        workflowNameRef.current = workflowDetail.workflowName || workflowId;
      } catch (error) {
        // A saved draft can still be tried locally if refreshing its user
        // preset fails. Without a draft definition, keep the existing error.
        if (!definition) throw error;
      }
      if (!definition) definition = definitionFromDetail(workflowDetail!);

      const nextSchema = snapshot?.startup.schema ?? workflowDetail?.startup?.schema ?? startupSchema ?? null;
      const nextDefaultValues = {
        ...startupDefaultValues,
        ...snapshot?.startup.defaultValues,
        ...workflowDetail?.startup?.defaultPreset?.values,
      };
      setActiveStartupSchema(nextSchema);
      setActiveStartupDefaultValues(nextDefaultValues);
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
      // Engine selection is mandatory even when the workflow has no startup fields.
      setIsStartupDialogOpen(true);
    })().catch((error) => setLaunchError(error instanceof Error ? error.message : '无法读取试运行配置'));
  }, [workflowId, canStart, launch, startupDefaultValues, startupSchema]);

  const confirmStartup = useCallback(
    async (inputs: Record<string, unknown>, engineType: 'claude' | 'openclaw') => {
      setIsStartupDialogOpen(false);
      await launch(inputs, snapshotRef.current, engineType);
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

  const continueRun = useCallback(async () => {
    const id = runIdRef.current;
    if (!id) return;
    setIsStarting(true);
    setLaunchError(null);
    try {
      await resumeWorkflowRun(id);
      void hydrateRun(id);
    } catch (error) {
      setIsStarting(false);
      setLaunchError(error instanceof Error ? error.message : '继续运行失败');
    }
  }, [hydrateRun]);

  const rerun = useCallback(() => {
    setRunId(null);
    runIdRef.current = null;
    setRun(null);
    setExecutionState(null);
    setLaunchError(null);
    setIsStartupDialogOpen(true);
  }, [hasStartupInputs, launch, runtimeUploadNodes.length]);

  const openExistingRun = useCallback(async (id: string): Promise<boolean> => {
    const existingRun = await getRunViaIpc(id, 'detail');
    if (!existingRun) return false;
    setRunId(id);
    runIdRef.current = id;
    setRun(existingRun);
    setExecutionState(runToExecutionState(existingRun));
    setRunWorkflowVersion(existingRun.workflowVersion);
    setIsStarting(false);
    setIsCancelling(false);
    setIsDraftSnapshot(false);
    setLaunchError(null);
    setIsDrawerOpen(true);
    return true;
  }, []);

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
  return {
    runId,
    run,
    runWorkflowVersion,
    executionState,
    isStarting,
    isCancelling,
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
    continueRun,
    rerun,
    openExistingRun,
    closeDrawer,
    decideApproval,
    submitInput,
  };
}
