import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateWorkflowModal } from '@/pages/Workflow/components/create-workflow-modal';
import { WorkflowMcIframeEditor, type WorkflowMcIframeEditorHandle } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import { useWorkflowEditorContentHeader } from '@/hooks/use-workflow-editor-content-header';
import { StartupRunDialog } from '@/pages/WorkflowDesigner/components/startup-run-dialog';
import { shouldShowStartupRunDialog } from '@/pages/WorkflowDesigner/components/test-run-drawer-model';
import { TestRunDrawer } from '@/pages/WorkflowDesigner/components/test-run-drawer';
import { LocalRunHistoryDialog } from '@/pages/WorkflowDesigner/components/local-run-history-dialog';
import { useDesignerTryRun } from '@/pages/WorkflowDesigner/hooks/use-designer-try-run';
import { useEmbeddedWorkflowTryRun } from '@/pages/Workflow/hooks/use-embedded-workflow-try-run';
import { createEmbeddedTrialRunDrawerActions } from '@/pages/Workflow/workflow-embedded-trial-run-actions';
import { cacheAiWorkflowPrompt, createWorkflowStudio } from '@/lib/workflow-studio-api';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import { MY_TASKS_WORKFLOW_LIST_HREF, myTasksWorkflowListHref } from '@/pages/MyTask/constants';

function useEditorActive(active: boolean) {
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);
  useEffect(() => {
    setEditorActive(active);
    return () => setEditorActive(false);
  }, [active, setEditorActive]);
}

/** 列表已并入「自动化 · 工作流」；保留 /workflow 索引以兼容旧链接与高亮参数 */
function WorkflowListRedirect() {
  const [searchParams] = useSearchParams();
  const highlightWorkflowId = searchParams.get('highlightWorkflowId');
  return <Navigate to={myTasksWorkflowListHref(highlightWorkflowId)} replace />;
}

/** 手动新建：先打开空画布页（不创建工作流、不加载模板），弹窗在画布页上弹出，用户填完信息确认后才创建并加载真实 MC 画布。 */
function WorkflowNewRoute() {
  useEditorActive(true);
  const { t } = useTranslation('workflow');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('templateId') ?? 'blank';
  const name = searchParams.get('name') ?? '';
  const handleBack = useCallback(() => navigate(MY_TASKS_WORKFLOW_LIST_HREF), [navigate]);

  useWorkflowEditorContentHeader({
    workflowId: '',
    onBack: handleBack,
    enabled: true,
    create: true,
  });

  return (
    <>
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted-foreground">{t('editor.createTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('createModal.subtitle')}</p>
      </div>
      <CreateWorkflowModal
        open
        initialValues={{ templateId, name }}
        onClose={() => navigate(MY_TASKS_WORKFLOW_LIST_HREF)}
      />
    </>
  );
}

export function WorkflowEditorSessionBoundary({
  workflowId,
  children,
}: {
  workflowId: string;
  children: ReactNode;
}) {
  const setEmbeddedHeaderOwned = useWorkflowUiStore((state) => state.setEmbeddedHeaderOwned);
  const setEmbeddedHeaderNegotiating = useWorkflowUiStore((state) => state.setEmbeddedHeaderNegotiating);
  useLayoutEffect(() => {
    setEmbeddedHeaderOwned(false);
    setEmbeddedHeaderNegotiating(true);
    return () => {
      setEmbeddedHeaderOwned(false);
      setEmbeddedHeaderNegotiating(false);
    };
  }, [setEmbeddedHeaderNegotiating, setEmbeddedHeaderOwned, workflowId]);

  return <Fragment key={workflowId}>{children}</Fragment>;
}

function WorkflowEditorSession({
  workflowId,
  onBack,
  prompt,
  promptCacheId,
}: {
  workflowId: string;
  onBack: () => void;
  prompt?: string;
  promptCacheId?: string;
}) {
  const editorRef = useRef<WorkflowMcIframeEditorHandle>(null);
  const embeddedHeaderOwned = useWorkflowUiStore((state) => state.embeddedHeaderOwned);
  const embeddedHeaderNegotiating = useWorkflowUiStore((state) => state.embeddedHeaderNegotiating);
  const setEmbeddedHeaderOwned = useWorkflowUiStore((state) => state.setEmbeddedHeaderOwned);
  const setEmbeddedHeaderNegotiating = useWorkflowUiStore((state) => state.setEmbeddedHeaderNegotiating);
  const [editorCapabilitySession, setEditorCapabilitySession] = useState({ ready: false, generation: 0 });
  const [localRunHistoryOpen, setLocalRunHistoryOpen] = useState(false);
  const handleOpenLocalRunHistory = useCallback(() => setLocalRunHistoryOpen(true), []);
  const canStartTryRun = useCallback(() => true, []);
  const tryRun = useDesignerTryRun({
    workflowId,
    startupSchema: null,
    canStart: canStartTryRun,
  });
  const embeddedTryRun = useEmbeddedWorkflowTryRun({
    workflowId,
    editorSessionIdentity: editorCapabilitySession.generation,
    editorRef,
    editorCapabilitiesReady: editorCapabilitySession.ready,
    beginTryRun: tryRun.begin,
    isRunActive: tryRun.isRunActive,
    isRunStarting: tryRun.isStarting,
    runId: tryRun.runId,
    runStatus: tryRun.executionState?.status,
    launchError: tryRun.launchError,
  });

  const closeStartupDialog = () => {
    tryRun.cancelStartupDialog();
    embeddedTryRun.cancelConfirmation();
  };
  const drawerActions = createEmbeddedTrialRunDrawerActions({
    closeDrawer: tryRun.closeDrawer,
    continueRun: tryRun.continueRun,
    rerun: tryRun.rerun,
  });
  const handleEditorCapabilitiesChange = (ready: boolean) => {
    setEmbeddedHeaderOwned(ready);
    setEmbeddedHeaderNegotiating(!ready);
    setEditorCapabilitySession((current) => ({
      ready,
      generation: current.generation + 1,
    }));
  };
  const handleEditorSessionReset = () => {
    setEmbeddedHeaderOwned(false);
    setEmbeddedHeaderNegotiating(true);
    embeddedTryRun.invalidateSession();
  };
  const handleEditorHandshakeFallback = () => {
    setEmbeddedHeaderOwned(false);
    setEmbeddedHeaderNegotiating(false);
  };

  useWorkflowEditorContentHeader({
    workflowId,
    onBack,
    backDisabled: embeddedTryRun.confirmOpen
      || embeddedTryRun.requestInFlight
      || tryRun.isStartupDialogOpen
      || (tryRun.isStarting && !tryRun.runId),
    prompt,
    promptCacheId,
    enabled: !embeddedHeaderOwned && !embeddedHeaderNegotiating,
    onTryRun: embeddedTryRun.requestFromHostFallback,
    tryRunDisabled: embeddedTryRun.requestInFlight || tryRun.isStarting || tryRun.isRunActive,
    onOpenLocalRunHistory: handleOpenLocalRunHistory,
  });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkflowMcIframeEditor
        ref={editorRef}
        workflowId={workflowId}
        prompt={prompt}
        promptCacheId={promptCacheId}
        onEditorCapabilitiesChange={handleEditorCapabilitiesChange}
        onEditorSessionReset={handleEditorSessionReset}
        onEditorHandshakeFallback={handleEditorHandshakeFallback}
        onTryRunRequest={embeddedTryRun.requestFromWeb}
        onBackRequest={onBack}
        onLocalRunHistoryRequest={handleOpenLocalRunHistory}
      />
      <ConfirmDialog
        open={embeddedTryRun.confirmOpen}
        title="提示"
        message="试运行前将自动保存当前画布为草稿，是否继续？"
        confirmLabel="确认"
        cancelLabel="取消"
        onConfirm={embeddedTryRun.confirmAndPrepare}
        onCancel={embeddedTryRun.cancelConfirmation}
      />
      <StartupRunDialog
        open={shouldShowStartupRunDialog({
          isStartupDialogOpen: tryRun.isStartupDialogOpen,
          isDrawerOpen: tryRun.isDrawerOpen,
        })}
        schema={tryRun.startupSchema}
        defaultValues={tryRun.startupDefaultValues}
        runtimeUploadNodes={tryRun.runtimeUploadNodes}
        isStarting={tryRun.isStarting}
        onConfirm={(inputs, engineType) => void tryRun.confirmStartup(inputs, engineType)}
        onClose={closeStartupDialog}
      />
      <TestRunDrawer
        variant="trial"
        open={tryRun.isDrawerOpen}
        runId={tryRun.runId}
        run={tryRun.run}
        executionState={tryRun.executionState}
        workflowVersion={tryRun.runWorkflowVersion}
        isStarting={tryRun.isStarting}
        isCancelling={tryRun.isCancelling}
        isRunActive={tryRun.isRunActive}
        isDraftSnapshot={tryRun.isDraftSnapshot}
        launchError={tryRun.launchError}
        onClose={drawerActions.close}
        onCancel={() => void tryRun.cancel()}
        onContinue={drawerActions.continueRun}
        onRerun={drawerActions.rerun}
        onDecideApproval={(approved, note) => void tryRun.decideApproval(approved, note)}
        onSubmitInput={(values) => void tryRun.submitInput(values)}
      />
      <LocalRunHistoryDialog
        open={localRunHistoryOpen}
        workflowId={workflowId}
        onClose={() => setLocalRunHistoryOpen(false)}
        onSelectRun={tryRun.openExistingRun}
      />
    </div>
  );
}

/** AI 创建：先 POST 建空流程拿真实 id，再 iframe 嵌入 MC /workflows-workbench/{id}?prompt=，MC 端自动打开 AI 面板并发起 */
function WorkflowGenerateRoute() {
  useEditorActive(true);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const prompt =
    (location.state as { prompt?: string } | null)?.prompt ?? searchParams.get('prompt') ?? '';
  const workflowId = searchParams.get('id') ?? '';
  const promptCacheId = searchParams.get('promptCacheId') ?? '';
  const [createError, setCreateError] = useState<string | null>(null);
  const createStartedRef = useRef(false);

  useEffect(() => {
    if (!prompt.trim() || workflowId || createStartedRef.current) return;
    createStartedRef.current = true;
    void createWorkflowStudio({
      templateId: 'blank',
      name: '未命名工作流',
      description: prompt.trim().slice(0, 50),
      nodes: [],
      edges: [],
    })
      .then(async (created) => {
        try {
          const cachedId = await cacheAiWorkflowPrompt(prompt, created.id, true);
          const params = new URLSearchParams({ id: created.id, promptCacheId: cachedId });
          // 缓存命中时不再通过路由 state 透传 prompt，确保记忆中心先取回
          // replaceInitialDraft 标识，再发起自动提交。
          navigate(`/workflow/generate?${params.toString()}`, { replace: true });
        } catch {
          const params = new URLSearchParams({ id: created.id });
          navigate(`/workflow/generate?${params.toString()}`, { replace: true, state: { prompt } });
        }
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : '创建流程失败');
      });
  }, [prompt, workflowId, navigate]);

  const handleBack = useCallback(() => navigate(MY_TASKS_WORKFLOW_LIST_HREF), [navigate]);

  if (!prompt.trim() && !workflowId) {
    return <Navigate to={MY_TASKS_WORKFLOW_LIST_HREF} replace />;
  }

  if (!workflowId) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {createError ? (
          <>
            <p className="text-sm text-destructive">{createError}</p>
            <Button type="button" variant="outline" onClick={handleBack}>
              返回列表
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">正在创建工作流…</p>
          </>
        )}
      </div>
    );
  }

  return (
    <WorkflowEditorSessionBoundary workflowId={workflowId}>
      <WorkflowEditorSession
        workflowId={workflowId}
        onBack={handleBack}
        prompt={prompt || undefined}
        promptCacheId={promptCacheId || undefined}
      />
    </WorkflowEditorSessionBoundary>
  );
}

function WorkflowEditRoute() {
  useEditorActive(true);
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const handleBack = useCallback(() => navigate(MY_TASKS_WORKFLOW_LIST_HREF), [navigate]);

  if (!workflowId) {
    return <Navigate to={MY_TASKS_WORKFLOW_LIST_HREF} replace />;
  }

  return (
    <WorkflowEditorSessionBoundary workflowId={workflowId}>
      <WorkflowEditorSession workflowId={workflowId} onBack={handleBack} />
    </WorkflowEditorSessionBoundary>
  );
}

export function WorkflowRoutes() {
  return (
    <Routes>
      <Route index element={<WorkflowListRedirect />} />
      <Route path="new" element={<WorkflowNewRoute />} />
      <Route path="generate" element={<WorkflowGenerateRoute />} />
      <Route path=":workflowId" element={<WorkflowEditRoute />} />
    </Routes>
  );
}

export default WorkflowRoutes;
