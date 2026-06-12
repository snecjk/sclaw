import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { workflowBuilderShell } from '@/lib/surfaces';
import { AiAssistantPanel } from '@/pages/Workflow/components/ai-assistant-panel';
import { NodeLibraryPanel } from '@/pages/Workflow/components/node-library-panel';
import {
  DataTreeModal,
  PublishModal,
  RunDrawer,
  RunReportContent,
  SkillPickerPopover,
  UnsavedModal,
  VersionDrawer,
} from '@/pages/Workflow/components/workflow-overlays';
import { WorkflowCanvas } from '@/pages/Workflow/components/workflow-canvas';
import { computeInitialLeftX, getUpstreamChain, hasDataSourceConfigured, layoutFlowNodes, layoutNewNodeAtEnd } from '@/pages/Workflow/workflow-layout';
import { createNodeFromTemplate } from '@/pages/Workflow/node-templates';
import {
  MOCK_DATA_TREES,
  MOCK_FLOW_LINKS,
  MOCK_FLOW_NODES,
  MOCK_FLOW_PLAN,
  MOCK_SKILLS,
} from '@/pages/Workflow/mock-data';
import type {
  BuilderEntryMode,
  ChatMessage,
  NodeRunState,
  VersionItem,
  WorkflowBuilderBackResult,
  WorkflowField,
  WorkflowLink,
  WorkflowNodeData,
} from '@/pages/Workflow/types';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface WorkflowBuilderProps {
  entryMode: BuilderEntryMode;
  initialName: string;
  userPrompt: string;
  onBack: (result?: WorkflowBuilderBackResult) => void;
}

export function WorkflowBuilder({ entryMode, initialName, userPrompt, onBack }: WorkflowBuilderProps) {
  const { t } = useTranslation('workflow');
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nxCounter = useRef(10);

  const [workflowName, setWorkflowName] = useState(initialName);
  const [savedLabel, setSavedLabel] = useState('2026-05-02 14:30');
  const [dirty, setDirty] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(entryMode !== 'blank');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nodes, setNodes] = useState<WorkflowNodeData[]>([]);
  const [links, setLinks] = useState<WorkflowLink[]>([]);
  const [hint, setHint] = useState<'ai' | 'blank' | 'hidden'>(entryMode === 'blank' ? 'blank' : 'ai');
  const [zoom, setZoom] = useState(90);
  const [showReplay, setShowReplay] = useState(false);
  const [publishPulse, setPublishPulse] = useState(false);
  const [nodeRunStates, setNodeRunStates] = useState<Record<string, NodeRunState>>({});
  const [flashingNodeId, setFlashingNodeId] = useState<string | null>(null);
  const [nodeTryStates, setNodeTryStates] = useState<Record<string, { busy?: boolean; message?: { type: 'ok' | 'fail'; text: string; onView?: () => void } | null }>>({});

  const [nodeLibOpen, setNodeLibOpen] = useState(false);
  const [nodeLibPos, setNodeLibPos] = useState({ x: 440, y: 120 });

  const [publishOpen, setPublishOpen] = useState(false);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runMode, setRunMode] = useState<'loading' | 'report' | 'node-report'>('loading');
  const [runTitle, setRunTitle] = useState('');
  const [hasReport, setHasReport] = useState(false);
  const [running, setRunning] = useState(false);
  const runCancelledRef = useRef(false);

  const [skillPicker, setSkillPicker] = useState<{ nodeId: string; pos: { x: number; y: number }; selected: Set<string> } | null>(null);
  const [skillSearch, setSkillSearch] = useState('');

  const [treeOpen, setTreeOpen] = useState(false);
  const [treeMode, setTreeMode] = useState<'sys' | 'online'>('sys');
  const [treeSelected, setTreeSelected] = useState<Set<string>>(new Set());
  const [treeTarget, setTreeTarget] = useState<{ nodeId: string; fieldKey: string } | null>(null);
  const [fileTarget, setFileTarget] = useState<{ nodeId: string; fieldKey: string } | null>(null);

  const markDirty = useCallback(() => setDirty(true), []);

  const layoutAndSet = useCallback((sourceNodes: WorkflowNodeData[], sourceLinks: WorkflowLink[]) => {
    const wrap = canvasWrapRef.current;
    const startX = computeInitialLeftX(wrap?.clientWidth ?? 1200, zoom / 100);
    const laid = layoutFlowNodes(sourceNodes, startX);
    setNodes(laid);
    setLinks(sourceLinks);
    setHint(laid.length > 0 ? 'hidden' : hint);
  }, [hint, zoom]);

  const runGenerateSequence = useCallback(async (prompt: string) => {
    setMessages([]);
    setNodes([]);
    setLinks([]);
    setHint('ai');
    setShowReplay(false);
    setPublishPulse(false);
    setHasReport(false);

    const push = (msg: ChatMessage) => setMessages((prev) => [...prev, msg]);

    push({ id: 'm1', role: 'assistant', content: t('assistant.welcome') });
    await wait(500);
    push({ id: 'm2', role: 'user', content: prompt });
    await wait(700);
    push({ id: 'm3', role: 'assistant', content: t('assistant.thinking') });
    await wait(1100);
    setMessages((prev) => prev.map((m) => (m.id === 'm3' ? { ...m, content: t('assistant.planIntro') } : m)));
    await wait(600);
    push({ id: 'm4', role: 'plan', planSteps: MOCK_FLOW_PLAN });
    await wait(500);
    setHint('hidden');

    const startX = computeInitialLeftX(canvasWrapRef.current?.clientWidth ?? 1200, zoom / 100);
    const order = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
    const flowNodes = structuredClone(MOCK_FLOW_NODES);
    let builtNodes: WorkflowNodeData[] = [];
    let builtLinks: WorkflowLink[] = [];

    for (const id of order) {
      const node = flowNodes.find((n) => n.id === id);
      if (!node) continue;
      const stepId = `step-${id}`;
      push({ id: stepId, role: 'step', stepText: t('assistant.addingNode', { name: node.title }), stepDone: false });
      await wait(620);
      builtNodes = layoutFlowNodes(
        [...builtNodes, node],
        startX,
      );
      setNodes(builtNodes);
      await wait(420);
      const newLinks = MOCK_FLOW_LINKS.filter((l) => l.to === id);
      builtLinks = [...builtLinks, ...newLinks.filter((nl) => !builtLinks.some((bl) => bl.from === nl.from && bl.to === nl.to))];
      setLinks([...builtLinks]);
      setMessages((prev) =>
        prev.map((m) => (m.id === stepId ? { ...m, stepDone: true, stepText: t('assistant.addedNode', { name: node.title }) } : m)),
      );
      await wait(520);
    }

    const cfgId = 'step-cfg';
    push({ id: cfgId, role: 'step', stepText: t('assistant.connecting'), stepDone: false });
    await wait(1100);
    setMessages((prev) =>
      prev.map((m) => (m.id === cfgId ? { ...m, stepDone: true, stepText: t('assistant.connected') } : m)),
    );
    await wait(500);
    push({ id: 'done', role: 'assistant', content: t('assistant.done') });
    setWorkflowName('客户异常监控');
    setPublishPulse(true);
    setShowReplay(true);
    layoutAndSet(flowNodes, MOCK_FLOW_LINKS);
  }, [layoutAndSet, t, zoom]);

  useEffect(() => {
    if (entryMode === 'generate') {
      void runGenerateSequence(userPrompt || t('generate.chipAbnormal'));
    } else if (entryMode === 'blank') {
      setMessages([{ id: 'blank', role: 'assistant', content: t('assistant.blankGuide') }]);
      setHint('blank');
    } else {
      setMessages([{ id: 'edit', role: 'assistant', content: t('assistant.editGuide') }]);
      layoutAndSet(structuredClone(MOCK_FLOW_NODES), [...MOCK_FLOW_LINKS]);
      setHint('hidden');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const handleBack = () => {
    if (dirty) setUnsavedOpen(true);
    else onBack();
  };

  const addLibNode = (name: string) => {
    setNodeLibOpen(false);
    markDirty();
    setHasReport(false);
    const id = `nx${nxCounter.current++}`;
    const newNode = createNodeFromTemplate(name, id);
    const startX = computeInitialLeftX(canvasWrapRef.current?.clientWidth ?? 1200, zoom / 100);
    const { nodes: nextNodes, linkFrom } = nodes.length
      ? layoutNewNodeAtEnd(nodes, newNode, startX)
      : { nodes: layoutFlowNodes([newNode], startX), linkFrom: null };
    const laid = nextNodes;
    const nextLinks = linkFrom ? [...links, { from: linkFrom, to: id }] : links;
    setNodes(laid);
    setLinks(nextLinks);
    setHint('hidden');
    setFlashingNodeId(id);
    setTimeout(() => setFlashingNodeId(null), 1000);
    toast.success(t('toast.nodeAdded', { name }));
  };

  const openNodeLibAt = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodeLibOpen(true);
    setNodeLibPos({
      x: Math.min(Math.max(20, e.clientX + 14), window.innerWidth - 450),
      y: Math.min(Math.max(70, e.clientY - 40), window.innerHeight - 560),
    });
  };

  const handleTryRunFlow = async () => {
    if (running) {
      setRunOpen(true);
      setRunMode('loading');
      setRunTitle(t('run.title'));
      return;
    }
    if (hasReport) {
      setRunMode('report');
      setRunTitle(t('run.resultTitle'));
      setRunOpen(true);
      return;
    }
    const order = ['n1', 'n2', 'n3', 'n4', 'n5'].filter((id) => nodes.some((n) => n.id === id));
    if (!order.length) {
      toast.error(t('run.noNodes'));
      return;
    }
    setRunning(true);
    runCancelledRef.current = false;
    setNodeRunStates({});
    setRunMode('loading');
    setRunTitle(t('run.title'));
    setRunOpen(true);

    for (const id of order) {
      if (runCancelledRef.current) break;
      setNodeRunStates((s) => ({ ...s, [id]: 'running' }));
      await wait(1400);
      if (runCancelledRef.current) break;
      setNodeRunStates((s) => ({ ...s, [id]: 'done' }));
    }
    if (runCancelledRef.current) {
      setNodeRunStates({});
      setRunning(false);
      return;
    }
    if (nodes.some((n) => n.id === 'n6')) {
      setNodeRunStates((s) => ({ ...s, n6: 'skip' }));
    }
    setRunning(false);
    setHasReport(true);
    setRunMode('report');
    setRunTitle(t('run.resultTitle'));
    setRunOpen((wasOpen) => {
      if (!wasOpen) toast.success(t('run.completeToast'));
      return wasOpen;
    });
  };

  const handleTryRunNode = async (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setNodeTryStates((s) => ({ ...s, [nodeId]: { busy: true, message: null } }));
    const chain = getUpstreamChain(links, nodeId);
    setNodeRunStates({});

    for (const cid of chain) {
      const cn = nodes.find((n) => n.id === cid);
      setNodeRunStates((s) => ({ ...s, [cid]: 'running' }));
      await wait(cid === nodeId ? 1400 : 900);
      if (cn && cn.kind === 'db' && !hasDataSourceConfigured(cn)) {
        setNodeRunStates((s) => ({ ...s, [cid]: 'fail' }));
        setNodeTryStates((s) => ({
          ...s,
          [nodeId]: {
            busy: false,
            message: { type: 'fail', text: t('node.tryFail', { name: cn.title }) },
          },
        }));
        toast.error(t('toast.nodeTryFail'));
        return;
      }
      setNodeRunStates((s) => ({ ...s, [cid]: 'done' }));
    }

    setNodeTryStates((s) => ({
      ...s,
      [nodeId]: {
        busy: false,
        message: {
          type: 'ok',
          text: t('node.trySuccess', { summary: node.resultSummary ?? '' }),
          onView: () => {
            setRunMode('node-report');
            setRunTitle(t('run.nodeResultTitle', { name: node.title }));
            setRunOpen(true);
          },
        },
      },
    }));
    toast.success(t('toast.nodeTrySuccess'));
  };

  const updateNodeField = (nodeId: string, fieldKey: string, patch: Partial<WorkflowField>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, fields: n.fields.map((f) => (f.key === fieldKey ? { ...f, ...patch } : f)) }
          : n,
      ),
    );
  };

  const toggleMulti = (nodeId: string, fieldKey: string, option: string) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          fields: n.fields.map((f) => {
            if (f.key !== fieldKey) return f;
            const sel = (f.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
            const next = sel.includes(option) ? sel.filter((s) => s !== option) : [...sel, option];
            return { ...f, value: next.join(', ') };
          }),
        };
      }),
    );
  };

  return (
    <div className={workflowBuilderShell}>
      <header className="flex min-h-[54px] shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-border bg-card px-4 py-2">
        <button
          type="button"
          aria-label={t('builder.back')}
          onClick={handleBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors duration-fast hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 basis-[200px]">
          <Input
            value={workflowName}
            onChange={(e) => {
              setWorkflowName(e.target.value);
              markDirty();
            }}
            className="h-auto border-transparent bg-transparent px-1.5 text-base font-semibold shadow-none hover:bg-muted focus-visible:border-primary/30 focus-visible:bg-card"
          />
          <p className="px-1.5 text-xs text-muted-foreground">
            {t('builder.lastSaved', { time: savedLabel })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setVersionOpen(true)}>
            {t('builder.history')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDirty(false);
              setSavedLabel(t('builder.lastSavedJustNow'));
              toast.success(t('toast.draftSaved'));
            }}
          >
            {t('builder.saveDraft')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleTryRunFlow()}>
            {t('builder.tryRun')}
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn(publishPulse && 'animate-pulse shadow-soft ring-4 ring-primary/15')}
            onClick={() => {
              setDirty(false);
              setPublishPulse(false);
              setMessages((prev) => [...prev, { id: `pub-${Date.now()}`, role: 'assistant', content: t('assistant.published') }]);
              setPublishOpen(true);
            }}
          >
            {t('builder.publish')}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        {!chatExpanded ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setChatExpanded(true)}
            className="absolute left-4 top-4 z-[25] border-border bg-card text-primary shadow-elevated hover:bg-primary/[0.04]"
          >
            {t('builder.aiFab')}
          </Button>
        ) : null}

        {!chatExpanded ? (
          <div className="absolute left-4 top-[74px] z-[24] flex w-[236px] max-w-[calc(100%-2rem)] max-h-[calc(100%-100px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-modal">
            <NodeLibraryPanel
              variant="dock"
              title={t('nodeLib.title')}
              hint={t('nodeLib.hint')}
              onPick={addLibNode}
            />
          </div>
        ) : null}

        {chatExpanded ? (
          <AiAssistantPanel
            messages={messages}
            onReset={() => void runGenerateSequence(userPrompt || t('generate.chipAbnormal'))}
            onCollapse={() => setChatExpanded(false)}
          />
        ) : null}

        <WorkflowCanvas
          nodes={nodes}
          links={links}
          zoom={zoom}
          hint={hint}
          showReplay={showReplay}
          nodeRunStates={nodeRunStates}
          flashingNodeId={flashingNodeId}
          nodeTryStates={nodeTryStates}
          onZoomChange={setZoom}
          onZoomFit={() => {
            const wrap = canvasWrapRef.current;
            if (!wrap) return;
            setZoom(90);
            wrap.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }}
          onReplay={() => void runGenerateSequence(userPrompt || t('generate.chipAbnormal'))}
          onNodeDelete={(id) => {
            setNodes((prev) => prev.filter((n) => n.id !== id));
            setLinks((prev) => prev.filter((l) => l.from !== id && l.to !== id));
            setHasReport(false);
            toast.success(t('toast.nodeDeleted'));
          }}
          onNodeRename={(id, title) => {
            setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
            toast.success(t('toast.nodeRenamed', { name: title }));
          }}
          onFieldChange={updateNodeField}
          onMultiToggle={toggleMulti}
          onOpenNodeLib={openNodeLibAt}
          onOpenSkillPicker={(nodeId, e) => {
            const node = nodes.find((n) => n.id === nodeId);
            const skillRow = node?.summary?.find((r) => r.pick);
            const selected = new Set(
              skillRow?.value ? MOCK_SKILLS.filter((s) => skillRow.value.includes(s)) : [],
            );
            setSkillPicker({
              nodeId,
              pos: { x: Math.min(e.clientX, window.innerWidth - 320), y: Math.min(e.clientY + 12, window.innerHeight - 400) },
              selected,
            });
            setSkillSearch('');
          }}
          onDataSourceAction={(nodeId, mode, e) => {
            e.stopPropagation();
            const fieldKey = 'datasource';
            if (mode === 'local') {
              setFileTarget({ nodeId, fieldKey });
              fileInputRef.current?.click();
              return;
            }
            const node = nodes.find((n) => n.id === nodeId);
            const field = node?.fields.find((f) => f.key === fieldKey);
            const existing = mode === 'sys' ? field?.dataSource?.sys ?? [] : field?.dataSource?.online ?? [];
            setTreeTarget({ nodeId, fieldKey });
            setTreeMode(mode);
            setTreeSelected(new Set(existing));
            setTreeOpen(true);
          }}
          onTryRunNode={handleTryRunNode}
          onDirty={markDirty}
          canvasWrapRef={canvasWrapRef}
        />
      </div>

      {nodeLibOpen ? (
        <>
          <button type="button" className="fixed inset-0 z-[95]" aria-label={t('skills.cancel')} onClick={() => setNodeLibOpen(false)} />
          <div
            className="fixed z-[96] flex max-h-[min(560px,86vh)] w-[236px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-modal"
            style={{ left: nodeLibPos.x, top: nodeLibPos.y }}
          >
            <NodeLibraryPanel variant="popover" onPick={addLibNode} />
          </div>
        </>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (!fileTarget) return;
          const files = [...(e.target.files ?? [])].map((f) => f.name);
          updateNodeField(fileTarget.nodeId, fileTarget.fieldKey, {
            dataSource: {
              ...(nodes.find((n) => n.id === fileTarget.nodeId)?.fields.find((f) => f.key === fileTarget.fieldKey)?.dataSource ?? {}),
              localFiles: files.slice(0, 5),
            },
          });
          toast.success(t('toast.filesSelected', { count: Math.min(files.length, 5) }));
          e.target.value = '';
        }}
      />

      <SkillPickerPopover
        open={skillPicker !== null}
        position={skillPicker?.pos ?? { x: 0, y: 0 }}
        skills={MOCK_SKILLS}
        selected={skillPicker?.selected ?? new Set()}
        search={skillSearch}
        onSearch={setSkillSearch}
        onToggle={(name) => {
          if (!skillPicker) return;
          const next = new Set(skillPicker.selected);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          setSkillPicker({ ...skillPicker, selected: next });
        }}
        onClose={() => setSkillPicker(null)}
        onConfirm={() => {
          if (!skillPicker) return;
          const names = MOCK_SKILLS.filter((s) => skillPicker.selected.has(s));
          setNodes((prev) =>
            prev.map((n) =>
              n.id === skillPicker.nodeId
                ? {
                    ...n,
                    summary: n.summary?.map((row) => (row.pick ? { ...row, value: names.join('、') } : row)),
                  }
                : n,
            ),
          );
          markDirty();
          toast.success(names.length ? t('toast.skillsSelected', { count: names.length }) : t('toast.skillsCleared'));
          setSkillPicker(null);
        }}
      />

      <DataTreeModal
        open={treeOpen}
        title={MOCK_DATA_TREES[treeMode].title}
        groups={MOCK_DATA_TREES[treeMode].groups.map((g) => ({ name: g.name, items: [...g.items] }))}
        selected={treeSelected}
        onToggle={(name) => {
          setTreeSelected((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
          });
        }}
        onClose={() => setTreeOpen(false)}
        onConfirm={() => {
          if (!treeTarget) return;
          const node = nodes.find((n) => n.id === treeTarget.nodeId);
          const field = node?.fields.find((f) => f.key === treeTarget.fieldKey);
          const ds = { ...(field?.dataSource ?? {}) };
          const names = [...treeSelected];
          if (treeMode === 'sys') ds.sys = names;
          else ds.online = names;
          updateNodeField(treeTarget.nodeId, treeTarget.fieldKey, { dataSource: ds });
          markDirty();
          toast.success(t('toast.treeSelected', { count: names.length }));
          setTreeOpen(false);
        }}
      />

      <PublishModal
        open={publishOpen}
        workflowName={workflowName}
        onClose={() => setPublishOpen(false)}
        onBackToList={() => {
          setPublishOpen(false);
          onBack({ action: 'published', name: workflowName.trim() || initialName });
          toast.success(t('toast.publishedBack'));
        }}
      />

      <UnsavedModal
        open={unsavedOpen}
        onContinue={() => setUnsavedOpen(false)}
        onSaveAndBack={() => {
          setUnsavedOpen(false);
          setDirty(false);
          toast.success(t('toast.draftSaved'));
          onBack({ action: 'draft', name: workflowName.trim() || initialName });
        }}
      />

      <VersionDrawer
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        onRestore={(item: VersionItem) => {
          setVersionOpen(false);
          setDirty(false);
          setSavedLabel(t('builder.restoredFrom', { time: item.time }));
          toast.success(t('toast.restored', { time: item.time }));
        }}
      />

      <RunDrawer
        open={runOpen}
        mode={runMode}
        title={runTitle}
        onClose={() => setRunOpen(false)}
        onCancel={() => {
          runCancelledRef.current = true;
          setNodeRunStates({});
          setRunning(false);
          setRunOpen(false);
          toast.success(t('run.cancelled'));
        }}
        onRerun={() => {
          setHasReport(false);
          setRunOpen(false);
          void handleTryRunFlow();
        }}
      >
        <RunReportContent />
      </RunDrawer>
    </div>
  );
}
