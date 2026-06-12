import { useCallback, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getCanvasSize } from '@/pages/Workflow/workflow-layout';
import { WorkflowNodeCard } from '@/pages/Workflow/components/workflow-node-card';
import type { NodeRunState, WorkflowLink, WorkflowNodeData } from '@/pages/Workflow/types';

interface WorkflowCanvasProps {
  nodes: WorkflowNodeData[];
  links: WorkflowLink[];
  zoom: number;
  hint: 'ai' | 'blank' | 'hidden';
  showReplay: boolean;
  nodeRunStates: Record<string, NodeRunState>;
  flashingNodeId: string | null;
  nodeTryStates: Record<string, { busy?: boolean; message?: { type: 'ok' | 'fail'; text: string; onView?: () => void } | null }>;
  onZoomChange: (zoom: number) => void;
  onZoomFit: () => void;
  onReplay: () => void;
  onNodeDelete: (id: string) => void;
  onNodeRename: (id: string, title: string) => void;
  onFieldChange: (nodeId: string, fieldKey: string, patch: Partial<WorkflowNodeData['fields'][0]>) => void;
  onMultiToggle: (nodeId: string, fieldKey: string, option: string) => void;
  onOpenNodeLib: (e: React.MouseEvent) => void;
  onOpenSkillPicker: (nodeId: string, e: React.MouseEvent) => void;
  onDataSourceAction: (nodeId: string, mode: 'local' | 'sys' | 'online', e: React.MouseEvent) => void;
  onTryRunNode: (nodeId: string) => void;
  onDirty: () => void;
  canvasWrapRef: React.RefObject<HTMLDivElement | null>;
}

export function WorkflowCanvas({
  nodes,
  links,
  zoom,
  hint,
  showReplay,
  nodeRunStates,
  flashingNodeId,
  nodeTryStates,
  onZoomChange,
  onZoomFit,
  onReplay,
  onNodeDelete,
  onNodeRename,
  onFieldChange,
  onMultiToggle,
  onOpenNodeLib,
  onOpenSkillPicker,
  onDataSourceAction,
  onTryRunNode,
  onDirty,
  canvasWrapRef,
}: WorkflowCanvasProps) {
  const { t } = useTranslation('workflow');
  const [panning, setPanning] = useState(false);
  const panRef = useRef({ sx: 0, sy: 0, sl: 0, st: 0 });
  const size = getCanvasSize(nodes);
  const scale = zoom / 100;

  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.workflow-node,button,input,select,textarea')) return;
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      setPanning(true);
      panRef.current = { sx: e.clientX, sy: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      e.preventDefault();
    },
    [canvasWrapRef],
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!panning) return;
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      wrap.scrollLeft = panRef.current.sl - (e.clientX - panRef.current.sx);
      wrap.scrollTop = panRef.current.st - (e.clientY - panRef.current.sy);
    },
    [canvasWrapRef, panning],
  );

  const handlePanEnd = useCallback(() => setPanning(false), []);

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={canvasWrapRef}
        className={cn(
          'h-full overflow-auto bg-muted/50',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={{
          backgroundImage: 'radial-gradient(circle, #DCE0E6 1.1px, transparent 1.1px)',
          backgroundSize: '24px 24px',
        }}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
      >
        <div
          className="relative"
          style={{
            width: size.width,
            height: size.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {links.map((link) => {
              const from = nodes.find((n) => n.id === link.from);
              const to = nodes.find((n) => n.id === link.to);
              if (!from || !to) return null;
              const ax = from.x + 380;
              const ay = from.y + 160;
              const bx = to.x;
              const by = to.y + 160;
              return (
                <path
                  key={`${link.from}-${link.to}`}
                  d={`M${ax},${ay} C${ax + 56},${ay} ${bx - 56},${by} ${bx},${by}`}
                  stroke="#C9CDD4"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  fill="none"
                />
              );
            })}
          </svg>

          {hint !== 'hidden' ? (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 text-center text-muted-foreground">
              <div className="mx-auto mb-3 flex h-[60px] w-[60px] items-center justify-center rounded-[17px] border border-dashed border-[#DDE0E5] bg-card text-2xl text-primary">
                {hint === 'blank' ? <Plus className="h-6 w-6" aria-hidden /> : <Sparkles className="h-6 w-6" aria-hidden />}
              </div>
              <b className="block text-[15px] text-foreground/80">
                {hint === 'blank' ? t('canvas.blankTitle') : t('canvas.aiPreparing')}
              </b>
              <span className="mt-1 block text-[13px]">
                {hint === 'blank' ? t('canvas.blankHint') : t('canvas.aiPreparingHint')}
              </span>
            </div>
          ) : null}

          {nodes.map((node) => (
            <div key={node.id} className="workflow-node">
              <WorkflowNodeCard
                node={node}
                runState={nodeRunStates[node.id] ?? null}
                flash={flashingNodeId === node.id}
                onDelete={() => {
                  onDirty();
                  onNodeDelete(node.id);
                }}
                onRename={(title) => {
                  onDirty();
                  onNodeRename(node.id, title);
                }}
                onFieldChange={(key, patch) => {
                  onDirty();
                  onFieldChange(node.id, key, patch);
                }}
                onMultiToggle={(key, opt) => {
                  onDirty();
                  onMultiToggle(node.id, key, opt);
                }}
                onOpenNodeLib={onOpenNodeLib}
                onOpenSkillPicker={(e) => onOpenSkillPicker(node.id, e)}
                onDataSourceAction={(mode, e) => onDataSourceAction(node.id, mode, e)}
                onTryRun={node.tryRun ? () => onTryRunNode(node.id) : undefined}
                tryRunBusy={nodeTryStates[node.id]?.busy}
                tryRunMessage={nodeTryStates[node.id]?.message ?? null}
              />
            </div>
          ))}
        </div>
      </div>

      {showReplay ? (
        <Button
          type="button"
          onClick={onReplay}
          className="absolute bottom-4 left-4 z-[3] bg-foreground text-primary-foreground shadow-elevated hover:bg-foreground/90"
        >
          {t('builder.replay')}
        </Button>
      ) : null}

      <div className="absolute bottom-4 right-4 z-[3] flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-2 py-1.5 text-xs text-foreground/80 shadow-glow">
        <button
          type="button"
          aria-label={t('builder.zoomOut')}
          onClick={() => onZoomChange(Math.max(30, zoom - 10))}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-md hover:bg-muted"
        >
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span className="min-w-[36px] text-center">{zoom}%</span>
        <button
          type="button"
          aria-label={t('builder.zoomIn')}
          onClick={() => onZoomChange(Math.min(200, zoom + 10))}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-md hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('builder.zoomFit')}
          onClick={onZoomFit}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-md hover:bg-muted"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
