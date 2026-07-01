import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import {
  CreateWorkflowModal,
  type CreateWorkflowModalInitialValues,
} from '@/pages/Workflow/components/create-workflow-modal';
import { WorkflowMcIframeEditor } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import { useWorkflowEditorContentHeader } from '@/hooks/use-workflow-editor-content-header';
import { cacheAiWorkflowPrompt, createWorkflowStudio } from '@/lib/workflow-studio-api';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

function useEditorActive(active: boolean) {
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);
  useEffect(() => {
    setEditorActive(active);
    return () => setEditorActive(false);
  }, [active, setEditorActive]);
}

type WorkflowListLocationState = {
  openCreateModal?: boolean;
  createModalInitial?: CreateWorkflowModalInitialValues;
};

function WorkflowListRoute() {
  useEditorActive(false);
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as WorkflowListLocationState | null;

  const [createModalOpen, setCreateModalOpen] = useState(
    () => Boolean(locationState?.openCreateModal),
  );
  const [createModalInitial, setCreateModalInitial] = useState<CreateWorkflowModalInitialValues>(
    () => ({
      templateId: locationState?.createModalInitial?.templateId ?? 'blank',
      name: locationState?.createModalInitial?.name ?? '',
    }),
  );

  // 深链打开后清掉 location state，避免刷新重复弹窗
  useEffect(() => {
    if (!locationState?.openCreateModal) return;
    navigate('.', { replace: true, state: null });
  }, [locationState?.openCreateModal, navigate]);

  const openCreateModal = (initial?: CreateWorkflowModalInitialValues) => {
    setCreateModalInitial({
      templateId: initial?.templateId ?? 'blank',
      name: initial?.name ?? '',
    });
    setCreateModalOpen(true);
  };

  return (
    <div className={workflowPageRootClass}>
      <WorkflowPageShading />
      <div className={workflowPageContentClass}>
        <WorkflowDashboard
          onManualCreate={() => openCreateModal()}
          onGenerate={(prompt) => {
            navigate('/workflow/generate', { state: { prompt } });
          }}
          onEditCard={(workflowId) => navigate(`/workflow/${encodeURIComponent(workflowId)}`)}
        />
      </div>
      <CreateWorkflowModal
        open={createModalOpen}
        initialValues={createModalInitial}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
  );
}

/** 深链兼容：`/workflow/new?templateId=&name=` → 列表页并自动打开新建弹窗 */
function WorkflowNewRoute() {
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('templateId') ?? 'blank';
  const name = searchParams.get('name') ?? '';

  return (
    <Navigate
      to="/workflow"
      replace
      state={{
        openCreateModal: true,
        createModalInitial: { templateId, name },
      }}
    />
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
          const cachedId = await cacheAiWorkflowPrompt(prompt, created.id);
          const params = new URLSearchParams({ id: created.id, promptCacheId: cachedId });
          navigate(`/workflow/generate?${params.toString()}`, { replace: true, state: { prompt } });
        } catch {
          const params = new URLSearchParams({ id: created.id });
          navigate(`/workflow/generate?${params.toString()}`, { replace: true, state: { prompt } });
        }
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : '创建流程失败');
      });
  }, [prompt, workflowId, navigate]);

  const handleBack = useCallback(() => navigate('/workflow'), [navigate]);

  useWorkflowEditorContentHeader({
    workflowId,
    onBack: handleBack,
    prompt: prompt || undefined,
    promptCacheId: promptCacheId || undefined,
    enabled: Boolean(workflowId),
  });

  if (!prompt.trim() && !workflowId) {
    return <Navigate to="/workflow" replace />;
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
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkflowMcIframeEditor
        workflowId={workflowId}
        prompt={prompt || undefined}
        promptCacheId={promptCacheId || undefined}
      />
    </div>
  );
}

function WorkflowEditRoute() {
  useEditorActive(true);
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const handleBack = useCallback(() => navigate('/workflow'), [navigate]);

  useWorkflowEditorContentHeader({
    workflowId: workflowId ?? '',
    onBack: handleBack,
    enabled: Boolean(workflowId),
  });

  if (!workflowId) {
    return <Navigate to="/workflow" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkflowMcIframeEditor workflowId={workflowId} />
    </div>
  );
}

export function WorkflowRoutes() {
  return (
    <Routes>
      <Route index element={<WorkflowListRoute />} />
      <Route path="new" element={<WorkflowNewRoute />} />
      <Route path="generate" element={<WorkflowGenerateRoute />} />
      <Route path=":workflowId" element={<WorkflowEditRoute />} />
    </Routes>
  );
}

export default WorkflowRoutes;
