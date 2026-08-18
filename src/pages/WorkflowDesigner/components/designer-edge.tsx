/**
 * Custom ReactFlow edge for the native designer (canvas Task 6).
 *
 * Ported/simplified from web InsertNodeEdge.tsx: renders the bezier path,
 * a condition/branch label at the midpoint, parallel-edge offsets, and insert
 * / delete actions on the selected edge. Delete uses useReactFlow().deleteElements
 * (no DesignerContext dependency).
 */
import { Plus, X } from 'lucide-react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { BROWSER_NODE_TEMPLATES, SMART_NODE_TEMPLATES, NODE_TEMPLATES } from '@/pages/WorkflowDesigner/constants';
import { nodeSummary } from '@/pages/WorkflowDesigner/utils';
import { isBrowserAutomationEnabled } from '../../../../shared/browser-automation/feature-flag';

type DesignerEdgeData = {
  parallelIndex?: number;
  parallelCount?: number;
  branchHint?: string;
  insertMenuOpen?: boolean;
  onOpenInsertMenu?: (edgeId: string) => void;
  onCloseInsertMenu?: () => void;
  onInsertNode?: (edgeId: string, nodeType: string) => void;
};

const OUTPUT_NODE_TEMPLATE = NODE_TEMPLATES.find((template) => template.type === 'output');
const INSERT_NODE_TEMPLATES = OUTPUT_NODE_TEMPLATE
  ? [
    ...SMART_NODE_TEMPLATES,
    ...(isBrowserAutomationEnabled() ? BROWSER_NODE_TEMPLATES : []),
    OUTPUT_NODE_TEMPLATE,
  ]
  : [
    ...SMART_NODE_TEMPLATES,
    ...(isBrowserAutomationEnabled() ? BROWSER_NODE_TEMPLATES : []),
  ];

export function DesignerEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  data,
  selected,
}: EdgeProps & { data?: DesignerEdgeData }) {
  const { deleteElements } = useReactFlow();
  const parallelCount = Math.max(1, data?.parallelCount ?? 1);
  const parallelIndex = data?.parallelIndex ?? 0;
  const offsetUnit = 18;
  const offset =
    parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * offsetUnit : 0;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY: sourceY + offset,
    sourcePosition,
    targetX,
    targetY: targetY + offset,
    targetPosition,
  });
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2 + offset;
  const branchHint = typeof data?.branchHint === 'string' ? data.branchHint.trim() : '';
  const hint =
    parallelCount > 1
      ? branchHint || `并行分支 ${parallelIndex + 1}/${parallelCount}`
      : typeof label === 'string' && label.trim()
        ? label.trim()
        : '';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {hint ? (
        <EdgeLabelRenderer>
          <div
            className="edge-branch-anchor nodrag nopan pointer-events-none absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY - 14}px)`,
            }}
          >
            <span
              className={`edge-branch-hint${parallelCount > 1 ? ' edge-branch-hint-parallel' : ''}`}
              title={hint}
            >
              {hint}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {selected ? (
        <EdgeLabelRenderer>
          <div
            className="edge-action-anchor nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
              pointerEvents: 'all',
            }}
          >
            <button
              type="button"
              aria-label="插入节点"
              title="插入节点"
              className="edge-action-button edge-action-button-primary"
              onClick={(event) => {
                event.stopPropagation();
                data?.onOpenInsertMenu?.(id);
              }}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              aria-label="删除连线"
              title="删除连线"
              className="edge-action-button"
              onClick={(event) => {
                event.stopPropagation();
                void deleteElements({ edges: [{ id }] });
              }}
            >
              <X size={12} />
            </button>
            {data?.insertMenuOpen ? (
              <InsertNodeMenu
                onClose={() => data.onCloseInsertMenu?.()}
                onSelect={(nodeType) => data.onInsertNode?.(id, nodeType)}
              />
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function InsertNodeMenu({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (nodeType: string) => void;
}) {
  return (
    <div
      className="insert-node-popover nodrag nopan"
      role="dialog"
      aria-label="选择要插入的节点类型"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="insert-node-popover-header">
        <h3 className="insert-node-menu-title">插入节点</h3>
        <button type="button" className="insert-node-popover-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="insert-node-menu-hint">选择节点类型，将节点插入当前连线。</p>
      <div className="insert-node-menu-list node-library-tiles">
        {INSERT_NODE_TEMPLATES.map((template) => {
          const Icon = template.icon;
          const summary = nodeSummary(template.type);
          return (
            <button
              key={template.type}
              type="button"
              className={`template-tile tile-${template.accent}`}
              onClick={() => onSelect(template.type)}
            >
              <span
                className="template-tile-icon"
                aria-label={summary ? `查看节点说明-${template.label}` : undefined}
                title={summary}
              >
                <Icon size={16} />
              </span>
              <span className="template-tile-copy">
                <span className="template-tile-label">{template.label}</span>
                <span className="template-tile-subtitle">{summary ?? '点击节点即可添加到画布'}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
