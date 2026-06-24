import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { CreateWorkflowWizard } from '@/pages/Workflow/components/create-workflow-wizard';
import { WorkflowMcIframeEditor } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import { useEffect } from 'react';

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
            navigate(`/workflow/new?${params.toString()}`);
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

function WorkflowEditRoute() {
  useEditorActive(true);
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();

  if (!workflowId) {
    return <Navigate to="/workflow" replace />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <Route path=":workflowId" element={<WorkflowEditRoute />} />
    </Routes>
  );
}

export default WorkflowRoutes;
