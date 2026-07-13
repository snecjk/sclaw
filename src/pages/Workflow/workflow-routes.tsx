import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { CreateWorkflowModal } from '@/pages/Workflow/components/create-workflow-modal';
import { WorkflowMcIframeEditor } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import { useWorkflowEditorContentHeader } from '@/hooks/use-workflow-editor-content-header';
import { cacheAiWorkflowPrompt, createWorkflowStudio } from '@/lib/workflow-studio-api';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import {
  useWorkflowListViewState,
  type WorkflowListViewState,
} from '@/pages/Workflow/hooks/use-workflow-list-view-state';

function useEditorActive(active: boolean) {
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);
  useEffect(() => {
    setEditorActive(active);
    return () => setEditorActive(false);
  }, [active, setEditorActive]);
}

function WorkflowListRoute({ viewState }: { viewState: WorkflowListViewState }) {
  useEditorActive(false);
  const navigate = useNavigate();

  return (
    <div className={workflowPageRootClass}>
      <WorkflowPageShading />
      <div className={workflowPageContentClass}>
        <WorkflowDashboard
          viewState={viewState}
          onManualCreate={() => navigate('/workflow/new')}
          onGenerate={(prompt) => {
            navigate('/workflow/generate', { state: { prompt } });
          }}
          onEditCard={(workflowId) => navigate(`/workflow/${encodeURIComponent(workflowId)}`)}
        />
      </div>
    </div>
  );
}

/** 手动新建：先打开空画布页（不创建工作流、不加载模板），弹窗在画布页上弹出，用户填完信息确认后才创建并加载真实 MC 画布。 */
function WorkflowNewRoute() {
  useEditorActive(true);
  const { t } = useTranslation('workflow');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('templateId') ?? 'blank';
  const name = searchParams.get('name') ?? '';
  const handleBack = useCallback(() => navigate('/workflow'), [navigate]);

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
        onClose={() => navigate('/workflow')}
      />
    </>
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
  const viewState = useWorkflowListViewState();
  return (
    <Routes>
      <Route index element={<WorkflowListRoute viewState={viewState} />} />
      <Route path="new" element={<WorkflowNewRoute />} />
      <Route path="generate" element={<WorkflowGenerateRoute />} />
      <Route path=":workflowId" element={<WorkflowEditRoute />} />
    </Routes>
  );
}

export default WorkflowRoutes;
