import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowBuilder } from '@/pages/Workflow/components/workflow-builder';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';
import { useWorkflowList } from '@/pages/Workflow/use-workflow-list';
import { createWorkflowCardItem } from '@/pages/Workflow/workflow-card-covers';
import type {
  BuilderEntryMode,
  WorkflowBuilderBackResult,
  WorkflowView,
} from '@/pages/Workflow/types';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

export function WorkflowTestPage() {
  const { t } = useTranslation('workflow');
  const [view, setView] = useState<WorkflowView>('dashboard');
  const {
    cards,
    setCards,
    appendLocalCard,
    isLoading,
    error,
    refetch,
    setSearchKeyword,
    mineCounts,
  } = useWorkflowList();
  const [entryMode, setEntryMode] = useState<BuilderEntryMode>('generate');
  const [workflowName, setWorkflowName] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);

  useEffect(() => {
    setEditorActive(view === 'builder');
    return () => setEditorActive(false);
  }, [setEditorActive, view]);

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
        onBack={(result?: WorkflowBuilderBackResult) => {
          if (result && entryMode !== 'edit') {
            appendLocalCard(
              createWorkflowCardItem(
                result.name,
                result.action === 'published' ? 'published' : 'draft',
              ),
            );
          }
          setView('dashboard');
        }}
      />
      </div>
    );
  }

  return (
    <div className={workflowPageRootClass}>
      <WorkflowPageShading />
      <div className={workflowPageContentClass}>
        <WorkflowDashboard
          cards={cards}
          mineCounts={mineCounts}
          isLoading={isLoading}
          error={error}
          onRetry={() => {
            void refetch();
          }}
          onSearchChange={setSearchKeyword}
          onCardsChange={setCards}
          onManualCreate={() => openBuilder('blank', { name: t('builder.unnamed') })}
          onGenerate={(prompt) => openBuilder('generate', { prompt, name: t('builder.newWorkflow') })}
          onEditCard={(name) => openBuilder('edit', { name })}
        />
      </div>
    </div>
  );
}

export default WorkflowTestPage;
