/**
 * 工作流设计器 — memory-center 功能 + StoClaw 壳层（React Flow 画布对齐 MC）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, History, Loader2, Play, Save, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useContentHeader } from '@/components/layout/content-header-context';
import { definitionFromDetail, definitionToSavePayload } from '@/lib/workflow-designer-adapter';
import { normalizeConditionBranches } from '@/pages/WorkflowDesigner/normalize-conditions';
import { persistNewWorkflow } from '@/lib/workflow-designer-persist';
import {
  getWorkflowDetail,
  publishWorkflowDefinition,
  saveWorkflowDefinition,
} from '@/lib/workflow-api';
import { workflowBuilderShell } from '@/lib/surfaces';
import { DesignerCanvas } from '@/pages/WorkflowDesigner/components/designer-canvas';
import { HistoryVersionsDrawer } from '@/pages/WorkflowDesigner/components/history-versions-drawer';
import { LocalRunHistoryDialog } from '@/pages/WorkflowDesigner/components/local-run-history-dialog';
import { DesignerNodeLibrary } from '@/pages/WorkflowDesigner/components/designer-node-library';
import { StartupRunDialog } from '@/pages/WorkflowDesigner/components/startup-run-dialog';
import { TestRunDrawer } from '@/pages/WorkflowDesigner/components/test-run-drawer';
import { useDesignerTryRun } from '@/pages/WorkflowDesigner/hooks/use-designer-try-run';
import type { WorkflowDefinition } from '@/pages/WorkflowDesigner/types';
import type { WorkflowSchema } from '@/types/workflow';
import {
  buildAiWorkflowGenerateTarget,
  createEmptyWorkflowDefinition,
  createNode,
  formatSavedAt,
} from '@/pages/WorkflowDesigner/utils';

export interface WorkflowDesignerProps {
  workflowId?: string;
  initialName?: string;
  onBack: () => void;
  onCreated?: (workflowId: string) => void;
}

export function WorkflowDesigner({
  workflowId,
  initialName = '未命名工作流',
  onBack,
  onCreated,
}: WorkflowDesignerProps) {
  const { t } = useTranslation('workflow');
  const navigate = useNavigate();
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const tryRunButtonRef = useRef<HTMLButtonElement>(null);
  const isNew = !workflowId;

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(
    isNew ? createEmptyWorkflowDefinition(initialName) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [savedAtLabel, setSavedAtLabel] = useState('');
  const [startupSchema, setStartupSchema] = useState<WorkflowSchema | null>(null);
  const [startupDefaultValues, setStartupDefaultValues] = useState<Record<string, unknown>>({});
  const [workflowVersionId, setWorkflowVersionId] = useState<number | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localRunHistoryOpen, setLocalRunHistoryOpen] = useState(false);

  const loadWorkflow = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await getWorkflowDetail(workflowId);
      setWorkflow(normalizeConditionBranches(definitionFromDetail(detail)));
      setStartupSchema(detail.startup?.schema ?? null);
      setStartupDefaultValues(detail.startup?.defaultPreset?.values ?? {});
      setWorkflowVersionId(detail.workflowVersionId);
      setDirty(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId) return undefined;
    const timer = window.setTimeout(() => {
      void loadWorkflow();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkflow, workflowId]);

  const canStartTryRun = useCallback(() => Boolean(workflow?.id) && !dirty, [dirty, workflow?.id]);
  const tryRun = useDesignerTryRun({
    workflowId: workflow?.id,
    startupSchema,
    startupDefaultValues,
    workflowVersionId,
    canStart: canStartTryRun,
  });
  const beginTryRun = tryRun.begin;
  const isTryRunStarting = tryRun.isStarting;

  const markDirty = useCallback(() => setDirty(true), []);

  const patchWorkflow = useCallback((patch: Partial<WorkflowDefinition>) => {
    if (!workflow) return;
    setWorkflow({ ...workflow, ...patch });
    markDirty();
  }, [markDirty, workflow]);

  const handleAddNodeAt = useCallback((type: string, position?: { x: number; y: number }) => {
    if (!workflow) return;
    if (type === 'startup_config' && workflow.nodes.some((n) => n.type === 'startup_config')) {
      toast.info('每个流程只能有一个启动配置节点');
      return;
    }
    const node = createNode(type, workflow.nodes.length, position);
    setWorkflow({ ...workflow, nodes: [...workflow.nodes, node] });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    markDirty();
  }, [markDirty, workflow]);

  const handleAddNode = useCallback((type: string) => {
    handleAddNodeAt(type);
  }, [handleAddNodeAt]);

  const handleAiBuild = useCallback(() => {
    const target = buildAiWorkflowGenerateTarget(workflow);
    navigate(target.pathname, { state: { prompt: target.prompt } });
  }, [navigate, workflow]);

  const handleSave = useCallback(async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      if (!workflow.id) {
        const saved = await persistNewWorkflow(workflow);
        setWorkflow(saved);
        setDirty(false);
        setSavedAtLabel(formatSavedAt(new Date().toISOString()));
        toast.success('工作流已创建并保存');
        onCreated?.(saved.id);
      } else {
        const saved = await saveWorkflowDefinition(workflow.id, definitionToSavePayload(workflow));
        setWorkflow(saved);
        setDirty(false);
        setSavedAtLabel(formatSavedAt(new Date().toISOString()) || t('builder.lastSavedJustNow'));
        toast.success(t('toast.draftSaved'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [onCreated, t, workflow]);

  const handlePublish = useCallback(async () => {
    if (!workflow?.id) {
      toast.info('请先保存工作流');
      return;
    }
    if (dirty) await handleSave();
    setPublishing(true);
    try {
      const published = await publishWorkflowDefinition(workflow.id);
      setWorkflow(published);
      setDirty(false);
      toast.success('发布成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  }, [dirty, handleSave, workflow]);

  const handleTryRun = useCallback(() => {
    if (!workflow?.id) {
      toast.info('请先保存工作流');
      return;
    }
    if (dirty) {
      toast.info('请先保存草稿再试运行');
      return;
    }
    beginTryRun();
  }, [beginTryRun, dirty, workflow?.id]);

  const handleTryRunFromHistory = useCallback(() => {
    setLocalRunHistoryOpen(false);
    window.setTimeout(() => {
      tryRunButtonRef.current?.focus();
      handleTryRun();
    }, 0);
  }, [handleTryRun]);

  const handleHistoryRestored = useCallback((restoredWorkflow: WorkflowDefinition) => {
    setWorkflow(normalizeConditionBranches(restoredWorkflow));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setDirty(false);
    setSavedAtLabel(new Date().toLocaleString());
  }, []);

  const handleBack = useCallback(() => {
    if (dirty) {
      const ok = window.confirm('有未保存的修改，确定离开？');
      if (!ok) return;
    }
    onBack();
  }, [dirty, onBack]);

  const headerTitle = useMemo(
    () => (
      <div className="no-drag flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
        <button
          type="button"
          aria-label={t('builder.back')}
          onClick={handleBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/80 hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          {workflow ? (
            <Input
              value={workflow.name}
              onChange={(e) => patchWorkflow({ name: e.target.value })}
              className="h-6 min-w-0 border-transparent bg-transparent px-1 text-sm font-semibold leading-5 shadow-none hover:bg-muted focus-visible:border-primary/30 focus-visible:bg-card"
            />
          ) : (
            <p className="min-w-0 truncate px-1 text-sm font-semibold leading-5">
              {t('editor.editTitle')}
              {workflowId ? ` · ${workflowId}` : ''}
            </p>
          )}
          <p className="min-w-0 truncate px-1 text-xs leading-4 text-muted-foreground">
            {workflow?.id ? `v${workflow.version}` : workflow ? '新建草稿' : workflowId}
            {savedAtLabel ? ` · ${savedAtLabel}` : null}
            {dirty ? ' · 未保存' : null}
          </p>
        </div>
      </div>
    ),
    [dirty, handleBack, patchWorkflow, savedAtLabel, t, workflow, workflowId],
  );

  const headerActions = useMemo(
    () =>
      workflow ? (
        <>
          <div className="mr-4 hidden items-center gap-9 text-xs text-muted-foreground xl:flex">
            <div>
              <p>当前编辑版本</p>
              <p className="text-sm font-semibold text-foreground">
                v{workflow.version || 1}
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">已发布</span>
              </p>
            </div>
            <div>
              <p>当前生效版本</p>
              <p className="text-sm font-semibold text-foreground">
                v{workflow.version || 1}
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">已发布</span>
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="mr-1 h-3.5 w-3.5" />
            版本列表
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setLocalRunHistoryOpen(true)}>
            <History className="mr-1 h-3.5 w-3.5" />
            本地运行记录
          </Button>
          <Button ref={tryRunButtonRef} type="button" variant="outline" size="sm" disabled={isTryRunStarting} onClick={handleTryRun}>
            <Play className="mr-1 h-3.5 w-3.5" />
            {isTryRunStarting ? '启动中' : t('builder.tryRun')}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={saving || !dirty} onClick={() => void handleSave()}>
            <Save className="mr-1 h-3.5 w-3.5" />
            {saving ? '保存中' : '另存草稿'}
          </Button>
          <Button type="button" size="sm" className="bg-[#5f6672] text-white hover:bg-[#4b5563]" disabled={publishing} onClick={() => void handlePublish()}>
            <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
            {publishing ? '发布中' : t('builder.publish')}
          </Button>
        </>
      ) : null,
    [dirty, handlePublish, handleSave, handleTryRun, isTryRunStarting, publishing, saving, t, workflow],
  );

  useContentHeader({
    title: headerTitle,
    actions: headerActions,
    enabled: true,
  });

  if (loading) {
    return (
      <div className={workflowBuilderShell}>
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>加载工作流…</span>
        </div>
      </div>
    );
  }

  if (loadError || !workflow) {
    return (
      <div className={workflowBuilderShell}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-destructive">{loadError ?? '加载失败'}</p>
          {workflowId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void loadWorkflow()}>
              重试
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            返回列表
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={workflowBuilderShell}>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="pointer-events-none absolute left-5 top-5 z-[24] flex w-[300px] max-w-[calc(100%-2.5rem)] flex-col gap-8">
          <button
            type="button"
            onClick={handleAiBuild}
            className="pointer-events-auto inline-flex h-12 w-fit items-center gap-2.5 rounded-[18px] border border-orange-200 bg-orange-50/80 px-5 text-base font-bold text-orange-500 shadow-sm hover:bg-orange-50"
          >
            <Sparkles className="h-5 w-5" />
            AI 帮我建
          </button>
          <div className="pointer-events-auto max-h-[440px] overflow-hidden rounded-[20px] border border-slate-100 bg-white/95 p-5 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
            <DesignerNodeLibrary onPick={handleAddNode} className="max-h-[400px] overflow-auto" />
          </div>
        </div>

        <DesignerCanvas
          workflow={workflow}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onSelectNode={setSelectedNodeId}
          onSelectEdge={setSelectedEdgeId}
          onWorkflowChange={setWorkflow}
          onAddNodeAt={handleAddNodeAt}
          onDirty={markDirty}
          canvasWrapRef={canvasWrapRef}
        />

        <HistoryVersionsDrawer
          open={historyOpen}
          workflow={workflow}
          onClose={() => setHistoryOpen(false)}
          onRestored={handleHistoryRestored}
        />
        <LocalRunHistoryDialog
          open={localRunHistoryOpen}
          workflowId={workflow.id}
          workflowName={workflow.name}
          onClose={() => setLocalRunHistoryOpen(false)}
          onTryRun={handleTryRunFromHistory}
          onSelectRun={tryRun.openExistingRun}
        />
      </div>

      <StartupRunDialog
        open={tryRun.isStartupDialogOpen}
        schema={tryRun.startupSchema}
        defaultValues={tryRun.startupDefaultValues}
        runtimeUploadNodes={tryRun.runtimeUploadNodes}
        isStarting={tryRun.isStarting}
        onConfirm={(inputs, engineType) => void tryRun.confirmStartup(inputs, engineType)}
        onClose={tryRun.cancelStartupDialog}
      />
      <TestRunDrawer
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
        onClose={tryRun.closeDrawer}
        onCancel={() => void tryRun.cancel()}
        onContinue={() => void tryRun.continueRun()}
        onRerun={tryRun.rerun}
        onDecideApproval={(approved, note) => void tryRun.decideApproval(approved, note)}
        onSubmitInput={(values) => void tryRun.submitInput(values)}
      />
    </div>
  );
}
