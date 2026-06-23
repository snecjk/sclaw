/**
 * 工作流设计器 — memory-center 功能 + StoClaw 壳层（React Flow 画布对齐 MC）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, Play, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { definitionFromDetail, definitionToSavePayload } from '@/lib/workflow-designer-adapter';
import { persistNewWorkflow } from '@/lib/workflow-designer-persist';
import {
  getWorkflowDetail,
  publishWorkflowDefinition,
  saveWorkflowDefinition,
  startWorkflow,
} from '@/lib/workflow-api';
import { workflowBuilderShell } from '@/lib/surfaces';
import { DesignerCanvas } from '@/pages/WorkflowDesigner/components/designer-canvas';
import { DesignerInspector } from '@/pages/WorkflowDesigner/components/designer-inspector';
import { DesignerNodeLibrary } from '@/pages/WorkflowDesigner/components/designer-node-library';
import type { WorkflowDefinition, WorkflowNode } from '@/pages/WorkflowDesigner/types';
import {
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
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const isNew = !workflowId;

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(
    isNew ? createEmptyWorkflowDefinition(initialName) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [savedAtLabel, setSavedAtLabel] = useState('');

  const loadWorkflow = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await getWorkflowDetail(workflowId);
      setWorkflow(definitionFromDetail(detail));
      setDirty(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (workflowId) void loadWorkflow();
  }, [loadWorkflow, workflowId]);

  const selectedNode = workflow?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const markDirty = () => setDirty(true);

  const patchWorkflow = (patch: Partial<WorkflowDefinition>) => {
    if (!workflow) return;
    setWorkflow({ ...workflow, ...patch });
    markDirty();
  };

  const patchSelectedNode = (node: WorkflowNode) => {
    if (!workflow) return;
    setWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === node.id ? node : n)),
    });
    markDirty();
  };

  const handleAddNode = (type: string) => {
    if (!workflow) return;
    if (type === 'startup_config' && workflow.nodes.some((n) => n.type === 'startup_config')) {
      toast.info('每个流程只能有一个启动配置节点');
      return;
    }
    const node = createNode(type, workflow.nodes.length);
    setWorkflow({ ...workflow, nodes: [...workflow.nodes, node] });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    markDirty();
  };

  const handleDeleteNode = () => {
    if (!workflow || !selectedNode) return;
    setWorkflow({
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== selectedNode.id),
      edges: workflow.edges.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
    });
    setSelectedNodeId(null);
    markDirty();
  };

  const handleSave = async () => {
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
  };

  const handlePublish = async () => {
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
  };

  const handleTryRun = async () => {
    if (!workflow?.id) {
      toast.info('请先保存工作流');
      return;
    }
    if (dirty) {
      toast.info('请先保存草稿再试运行');
      return;
    }
    setRunning(true);
    try {
      const result = await startWorkflow(workflow.id, {
        idempotencyKey: `designer-run-${Date.now()}`,
        inputs: {},
      });
      toast.success(`试运行已启动（runId: ${result.runId}）`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '试运行失败');
    } finally {
      setRunning(false);
    }
  };

  const handleBack = () => {
    if (dirty) {
      const ok = window.confirm('有未保存的修改，确定离开？');
      if (!ok) return;
    }
    onBack();
  };

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
      <header className="flex min-h-[54px] shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-border bg-card px-4 py-2">
        <button
          type="button"
          aria-label={t('builder.back')}
          onClick={handleBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/80 hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 basis-[200px]">
          <Input
            value={workflow.name}
            onChange={(e) => patchWorkflow({ name: e.target.value })}
            className="h-auto border-transparent bg-transparent px-1.5 text-base font-semibold shadow-none hover:bg-muted focus-visible:border-primary/30 focus-visible:bg-card"
          />
          <p className="px-1.5 text-xs text-muted-foreground">
            {workflow.id ? `v${workflow.version}` : '新建草稿'}
            {savedAtLabel ? ` · ${savedAtLabel}` : null}
            {dirty ? ' · 未保存' : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saving || !dirty} onClick={() => void handleSave()}>
            <Save className="mr-1 h-3.5 w-3.5" />
            {saving ? '保存中' : t('builder.saveDraft')}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => void handleTryRun()}>
            <Play className="mr-1 h-3.5 w-3.5" />
            {running ? '启动中' : t('builder.tryRun')}
          </Button>
          <Button type="button" size="sm" disabled={publishing} onClick={() => void handlePublish()}>
            {publishing ? '发布中' : t('builder.publish')}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="absolute left-4 top-4 z-[24] flex w-[220px] max-h-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <b className="text-sm font-semibold">{t('nodeLib.title')}</b>
          </div>
          <DesignerNodeLibrary onPick={handleAddNode} className="flex-1 overflow-auto" />
        </div>

        <DesignerCanvas
          workflow={workflow}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onSelectNode={setSelectedNodeId}
          onSelectEdge={setSelectedEdgeId}
          onWorkflowChange={setWorkflow}
          onDirty={markDirty}
          canvasWrapRef={canvasWrapRef}
        />

        <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">属性</p>
          </div>
          <DesignerInspector
            workflow={workflow}
            selectedNode={selectedNode}
            onWorkflowDescriptionChange={(description) => patchWorkflow({ description })}
            onNodeChange={patchSelectedNode}
            onDeleteNode={handleDeleteNode}
          />
        </aside>
      </div>
    </div>
  );
}
