import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { CreateWorkflowWizard } from '@/pages/Workflow/components/create-workflow-wizard';
import { WorkflowMcIframeEditor } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import { createWorkflowStudio } from '@/lib/workflow-studio-api';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

function useEditorActive(active: boolean) {
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);
  useEffect(() => {
    setEditorActive(active);
    return () => setEditorActive(false);
  }, [active, setEditorActive]);
}

function WorkflowListRoute() {
  useEditorActive(false);
  const navigate = useNavigate();

  return (
    <div className={workflowPageRootClass}>
      <WorkflowPageShading />
      <div className={workflowPageContentClass}>
        <WorkflowDashboard
          onManualCreate={() => navigate('/workflow/new')}
          onGenerate={(prompt) => {
            const params = new URLSearchParams({ prompt });
            navigate(`/workflow/generate?${params.toString()}`);
          }}
          onEditCard={(workflowId) => navigate(`/workflow/${encodeURIComponent(workflowId)}`)}
        />
      </div>
    </div>
  );
}

/** 新建：StoClaw 两步向导（对齐 MC 创建 API，不走 MC /workflows-workbench/new 页面） */
function WorkflowNewRoute() {
  useEditorActive(false);
  return <CreateWorkflowWizard />;
}

/** AI 创建：先 POST 建空流程拿真实 id，再 iframe 嵌入 MC /workflows-workbench/{id}?prompt=，MC 端自动打开 AI 面板并发起 */
function WorkflowGenerateRoute() {
  useEditorActive(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prompt = searchParams.get('prompt') ?? '';
  const workflowId = searchParams.get('id') ?? '';
  const [createError, setCreateError] = useState<string | null>(null);
  /** 防止 StrictMode 双调用导致 createWorkflowStudio 重复建流程 */
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
      .then((created) => {
        const params = new URLSearchParams({ prompt, id: created.id });
        navigate(`/workflow/generate?${params.toString()}`, { replace: true });
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : '创建流程失败');
      });
  }, [prompt, workflowId, navigate]);

  if (!prompt.trim()) {
    return <Navigate to="/workflow" replace />;
  }

  if (!workflowId) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {createError ? (
          <>
            <p className="text-sm text-destructive">{createError}</p>
            <Button type="button" variant="outline" onClick={() => navigate('/workflow')}>
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
        prompt={prompt}
        onBack={() => navigate('/workflow')}
      />
    </div>
  );
}

function WorkflowEditRoute() {
  useEditorActive(true);
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();

  if (!workflowId) {
    return <Navigate to="/workflow" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkflowMcIframeEditor
        workflowId={workflowId}
        onBack={() => navigate('/workflow')}
      />
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
