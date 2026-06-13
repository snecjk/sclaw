import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowBuilder } from '@/pages/WorkflowBuilder/components/workflow-builder';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';
import type { WorkflowView } from '@/pages/Workflow/types';
import type {
  BuilderEntryMode,
} from '@/pages/WorkflowBuilder/types';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

/** 工作流页面路由入口：管理 dashboard / builder 视图切换，串联列表与编辑器 */
export function WorkflowTestPage() {
  const { t } = useTranslation('workflow');
  const [view, setView] = useState<WorkflowView>('dashboard');
  const [entryMode, setEntryMode] = useState<BuilderEntryMode>('generate');
  const [workflowName, setWorkflowName] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);

  /** 同步全局编辑器激活状态，用于控制其他 UI 元素的显隐 */
  useEffect(() => {
    setEditorActive(view === 'builder');
    return () => setEditorActive(false);
  }, [setEditorActive, view]);

  /** 打开编辑器：记录入口模式、工作流名、用户 prompt */
  const openBuilder = (mode: BuilderEntryMode, opts?: { name?: string; prompt?: string }) => {
    setEntryMode(mode);
    setWorkflowName(opts?.name ?? '');
    setUserPrompt(opts?.prompt ?? '');
    setView('builder');
  };

  if (view === 'builder') {
    return (
      <div className="min-h-0 min-w-0 overflow-hidden">
      <WorkflowBuilder
        entryMode={entryMode}
        initialName={workflowName || (entryMode === 'blank' ? t('builder.unnamed') : t('builder.newWorkflow'))}
        userPrompt={userPrompt}
        onBack={() => setView('dashboard')}
      />
      </div>
    );
  }

  return (
    <div className={workflowPageRootClass}>
      <WorkflowPageShading />
      <div className={workflowPageContentClass}>
        <WorkflowDashboard
          onManualCreate={() => openBuilder('blank', { name: t('builder.unnamed') })}
          onGenerate={(prompt) => openBuilder('generate', { prompt, name: t('builder.newWorkflow') })}
          onEditCard={(name) => openBuilder('edit', { name })}
        />
      </div>
    </div>
  );
}

export default WorkflowTestPage;
