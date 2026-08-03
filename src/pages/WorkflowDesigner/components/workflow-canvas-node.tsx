import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { FileText, Pencil, X } from 'lucide-react';
import type { CanvasNodeData, WorkflowNode } from '@/pages/WorkflowDesigner/types';
import {
  isRecord,
  patchAgentTaskConfig,
  patchSmartAgentConfig,
  readAgentTask,
  readBusinessConfig,
  readConfigString,
  readPrimaryBinding,
  resolveSmartAgentKind,
} from '@/pages/WorkflowDesigner/inspector-config-utils';
import { nodeRunStatusLabel, resolveNodeTemplate } from '@/pages/WorkflowDesigner/utils';
import { cn } from '@/lib/utils';

export function WorkflowCanvasNode({ data, selected }: NodeProps<Node<CanvasNodeData>>) {
  const template = resolveNodeTemplate(data.kind);
  const Icon = template?.icon ?? FileText;
  const isCondition = data.kind === 'condition' || data.kind === 'agent_condition';
  const workflowNode = data.workflowNode;
  const canDelete = Boolean(workflowNode && workflowNode.type !== 'trigger' && data.onDeleteNode);

  return (
    <div
      className={cn(
        'wf-canvas-node',
        template?.accent ? `shell-${template.accent}` : 'shell-trigger',
        isCondition && 'wf-canvas-node-diamond',
        selected && 'selected',
      )}
    >
      <Handle className="wf-flow-handle" type="target" position={Position.Left} />
      <div className={cn('wf-canvas-node-body', isCondition && 'wf-canvas-node-diamond-inner')}>
        <div className="wf-canvas-node-header">
          {canDelete ? (
            <button
              type="button"
              className="wf-canvas-node-close nodrag nopan"
              aria-label="删除节点"
              onClick={(event) => {
                event.stopPropagation();
                data.onDeleteNode?.(data.id);
              }}
            >
              <X size={14} />
            </button>
          ) : null}
          <div className="wf-canvas-node-head">
            <span
              className={cn('wf-canvas-node-icon', template?.accent ? `accent-${template.accent}` : 'accent-trigger')}
              title={data.summary}
            >
              <Icon size={16} />
            </span>
            <div className="wf-canvas-node-copy">
              <div className="wf-canvas-node-title-row">
                <strong>{data.name}</strong>
                <Pencil size={13} className="wf-canvas-node-title-edit" aria-hidden />
              </div>
              <small>{data.summary ?? data.subtitle}</small>
            </div>
          </div>
        </div>
        {workflowNode ? (
          <NodeInlineConfig node={workflowNode} data={data} />
        ) : (
          <div className="wf-canvas-node-status">{nodeRunStatusLabel(data.status)}</div>
        )}
      </div>
      <Handle className="wf-flow-handle wf-flow-handle-source" type="source" position={Position.Right} />
    </div>
  );
}

function NodeInlineConfig({ node, data }: { node: WorkflowNode; data: CanvasNodeData }) {
  const config = node.config;
  const smartKind = resolveSmartAgentKind(node.type);
  const businessConfig = readBusinessConfig(config);
  const agentTask = readAgentTask(config);

  const patchConfig = (configPatch: Record<string, unknown>) => {
    data.onNodeChange?.({ ...node, config: { ...node.config, ...configPatch } });
  };

  const patchNodeName = (name: string) => {
    data.onNodeChange?.({ ...node, name });
  };

  if (node.type === 'output' || smartKind === 'agent_output') {
    const binding = readPrimaryBinding(config);
    const target = readConfigString(config, 'target', 'report_center');
    const goal = smartKind
      ? readConfigString(businessConfig, 'goal') || readConfigString(agentTask, 'goal')
      : readConfigString(config, 'renderInstruction') || readConfigString(config, 'target', '生成结果分析报告');
    return (
      <div className="wf-canvas-node-inline-form nodrag nowheel">
        <InlineField label="输出目标">
          <textarea
            value={goal}
            onChange={(event) => {
              if (smartKind) {
                patchConfig(
                  patchSmartAgentConfig(config, {
                    businessConfig: { goal: event.target.value },
                    agentConfig: { task: { ...agentTask, goal: event.target.value } },
                  }),
                );
              } else {
                patchConfig({ renderInstruction: event.target.value });
              }
            }}
          />
        </InlineField>
        <InlineField label="详细输出规则">
          <textarea
            value={readConfigString(config, 'note') || `将结果输出到 ${target}${binding.nodeId ? `，来源：${binding.nodeId}` : ''}`}
            onChange={(event) => patchConfig({ note: event.target.value })}
          />
        </InlineField>
      </div>
    );
  }

  if (smartKind || node.type === 'agent_task') {
    const goal = smartKind
      ? readConfigString(businessConfig, 'goal') || readConfigString(agentTask, 'goal')
      : readTaskValue(config, 'goal');
    const instruction = smartKind
      ? readConfigString(businessConfig, 'rule') || readConfigString(agentTask, 'instruction')
      : readTaskValue(config, 'instruction');
    return (
      <div className="wf-canvas-node-inline-form nodrag nowheel">
        <button type="button" className="wf-canvas-node-prompt-button">
          查看最终 Prompt
        </button>
        <InlineField label={smartKind === 'agent_data_fetch' ? '获取目标' : '处理目标'}>
          <textarea
            value={goal}
            onChange={(event) => {
              const nextGoal = event.target.value;
              if (smartKind) {
                patchConfig(
                  patchSmartAgentConfig(config, {
                    businessConfig: { goal: nextGoal },
                    agentConfig: { task: { ...agentTask, goal: nextGoal } },
                  }),
                );
              } else {
                patchConfig(patchAgentTaskConfig(config, { task: { goal: nextGoal } }));
              }
            }}
          />
        </InlineField>
        <InlineField label={smartKind === 'agent_data_fetch' ? '详细获取规则' : '详细处理规则'}>
          <textarea
            value={instruction}
            onChange={(event) => {
              const nextInstruction = event.target.value;
              if (smartKind) {
                patchConfig(
                  patchSmartAgentConfig(config, {
                    businessConfig: { rule: nextInstruction },
                    agentConfig: { task: { ...agentTask, instruction: nextInstruction } },
                  }),
                );
              } else {
                patchConfig(patchAgentTaskConfig(config, { task: { instruction: nextInstruction } }));
              }
            }}
          />
        </InlineField>
      </div>
    );
  }

  if (node.type === 'trigger') {
    return (
      <div className="wf-canvas-node-inline-form nodrag nowheel">
        <InlineField label="节点名称">
          <input value={node.name} onChange={(event) => patchNodeName(event.target.value)} />
        </InlineField>
      </div>
    );
  }

  return <div className="wf-canvas-node-status">{nodeRunStatusLabel(data.status)}</div>;
}

function InlineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="wf-canvas-node-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function readTaskValue(config: Record<string, unknown>, key: 'goal' | 'instruction'): string {
  const task = isRecord(config.task) ? config.task : {};
  return String(task[key] ?? config[key] ?? '');
}
