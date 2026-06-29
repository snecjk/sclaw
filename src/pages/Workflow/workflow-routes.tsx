import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { CreateWorkflowWizard } from '@/pages/Workflow/components/create-workflow-wizard';
import { WorkflowMcIframeEditor } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
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
            navigate('/workflow/generate', { state: { prompt } });
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // prompt 走 React Router state（不进地址栏）；重载/外链回退到 ?prompt=（legacy）
  const prompt =
    (location.state as { prompt?: string } | null)?.prompt ?? searchParams.get('prompt') ?? '';
  const workflowId = searchParams.get('id') ?? '';
  const promptCacheId = searchParams.get('promptCacheId') ?? '';
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
      .then(async (created) => {
        try {
          // 先把大 prompt 缓存到 MC 后端换短 promptCacheId；地址栏只留 id+promptCacheId，prompt 走 state
          const cachedId = await cacheAiWorkflowPrompt(prompt, created.id);
          const params = new URLSearchParams({ id: created.id, promptCacheId: cachedId });
          navigate(`/workflow/generate?${params.toString()}`, { replace: true, state: { prompt } });
        } catch {
          // 缓存失败回退：prompt 走 state 传给 iframe 编辑器，由 URL 构造器以 ?prompt= 送给 MC（legacy）
          const params = new URLSearchParams({ id: created.id });
          navigate(`/workflow/generate?${params.toString()}`, { replace: true, state: { prompt } });
        }
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : '创建流程失败');
      });
  }, [prompt, workflowId, navigate]);

  // 既无 prompt 又无已建流程 id 才视为非法进入（重载时 prompt state 丢失但 id 在 URL，仍可重入编辑器）
  if (!prompt.trim() && !workflowId) {
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
        prompt={prompt || undefined}
        promptCacheId={promptCacheId || undefined}
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
