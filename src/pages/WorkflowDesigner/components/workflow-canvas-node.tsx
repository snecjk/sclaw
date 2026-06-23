import { Handle, Position, type NodeProps } from 'reactflow';
import { FileText } from 'lucide-react';
import type { CanvasNodeData } from '@/pages/WorkflowDesigner/types';
import { nodeRunStatusLabel, resolveNodeTemplate } from '@/pages/WorkflowDesigner/utils';
import { cn } from '@/lib/utils';

export function WorkflowCanvasNode({ data, selected }: NodeProps<CanvasNodeData>) {
  const template = resolveNodeTemplate(data.kind);
  const Icon = template?.icon ?? FileText;
  const isCondition = data.kind === 'condition' || data.kind === 'agent_condition';

  return (
    <div
      className={cn(
        'wf-canvas-node',
        isCondition && 'wf-canvas-node-diamond',
        selected && 'selected',
      )}
    >
      <Handle className="wf-flow-handle" type="target" position={Position.Left} />
      <div className={isCondition ? 'wf-canvas-node-diamond-inner' : undefined}>
        <div className="wf-canvas-node-head">
          <span
            className={cn('wf-canvas-node-icon', template?.accent ? `accent-${template.accent}` : 'accent-trigger')}
            title={data.summary}
          >
            <Icon size={16} />
          </span>
          <div>
            <strong>{data.name}</strong>
            <small>{data.subtitle}</small>
          </div>
        </div>
        <div className="wf-canvas-node-status">{nodeRunStatusLabel(data.status)}</div>
      </div>
      <Handle className="wf-flow-handle" type="source" position={Position.Right} />
    </div>
  );
}
