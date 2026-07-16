import { NODE_H, NODE_TEMPLATES, NODE_W } from '@/pages/WorkflowDesigner/constants';
import { MarkerType, Position, type Edge, type Node } from 'reactflow';
import type {
  CanvasNodeData,
  CanvasNodeView,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@/pages/WorkflowDesigner/types';

const ALL_TEMPLATES = NODE_TEMPLATES;
export function createEmptyWorkflowDefinition(name: string): WorkflowDefinition {
  return {
    schemaVersion: 'workflow/v2',
    id: '',
    name,
    version: 0,
    nodes: [],
    edges: [],
  };
}

export function resolveNodeTemplate(type: string) {
  return ALL_TEMPLATES.find((t) => t.type === type);
}

export function nodeTypeLabel(type: string): string {
  return resolveNodeTemplate(type)?.label ?? type;
}

export function nodeSummary(type: string): string | undefined {
  return resolveNodeTemplate(type)?.summary;
}

export function nodeRunStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待运行',
    running: '运行中',
    waiting_approval: '待审批',
    waiting_input: '待填写',
    succeeded: '已完成',
    failed: '失败',
    skipped: '跳过',
  };
  return labels[status] ?? '待运行';
}

export function buildCanvasNodes(workflow: WorkflowDefinition): Node<CanvasNodeData>[] {
  return workflow.nodes.map((node, index) => {
    const position = readNodePosition(node, index);
    return {
      id: node.id,
      type: 'workflowNode',
      position,
      data: {
        id: node.id,
        name: node.name,
        kind: node.type,
        subtitle: nodeTypeLabel(node.type),
        summary: nodeSummary(node.type),
        status: 'pending',
      },
      draggable: true,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

export function buildCanvasEdges(
  workflow: WorkflowDefinition,
  selectedEdgeId?: string | null,
): Edge[] {
  return workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.condition || undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    updatable: true,
    interactionWidth: 20,
    selected: edge.id === selectedEdgeId,
    style: {
      strokeWidth: edge.id === selectedEdgeId ? 3 : 2,
      stroke: edge.id === selectedEdgeId ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
    },
  }));
}

function buildSmartAgentConfig(type: string): Record<string, unknown> {
  const task = {
    goal: '',
    instruction: '',
    outputTemplateId: type === 'agent_data_fetch' ? 'structured_data_extract_result' : 'generic_data_result',
    outputSchema: type === 'agent_data_fetch' ? 'structured_data_extract_result' : 'generic_data_result',
  };
  return {
    businessConfig: { kind: type, goal: '' },
    agentConfig: {
      provider: 'cloud_agent',
      task,
      inputs: {
        mode: 'auto_previous',
        sourceNodeIds: [],
        includeTriggerInputs: false,
        includeUserInputs: false,
        inputBindings: {},
      },
      runtime: { provider: 'cloud_agent', model: 'sonnet' },
      guardrails: {
        approvalMode: 'approval_required',
        allowedSkills: [],
        allowedTools: [],
        timeoutMs: 300_000,
        maxToolCalls: 20,
      },
    },
    ...(type === 'agent_condition'
      ? {
          branches: [
            { branchKey: 'matched', label: '命中条件', isFallback: false },
            { branchKey: 'fallback', label: '兜底处理', isFallback: true },
          ],
        }
      : {}),
  };
}

export function defaultNodeConfig(type: string, index: number): Record<string, unknown> {
  const position = {
    x: 90 + (index % 3) * (NODE_W + 70),
    y: 120 + Math.floor(index / 3) * (NODE_H + 60),
  };
  const base = {
    editor: { position },
    input: { mode: 'auto', bindings: [] },
    output: { ports: [{ name: 'default' }] },
  };

  if (
    type === 'agent_data_fetch' ||
    type === 'agent_data_process' ||
    type === 'agent_condition' ||
    type === 'agent_output'
  ) {
    return { ...base, ...buildSmartAgentConfig(type) };
  }

  if (type === 'agent_task') {
    return {
      ...base,
      taskMode: 'general',
      task: {
        goal: '描述这个节点要完成的业务目标',
        instruction: '',
        outputTemplateId: 'generic_data_result',
        outputSchema: 'generic_data_result',
      },
      inputs: {
        mode: 'auto_previous',
        sourceNodeIds: [],
        includeTriggerInputs: false,
        includeUserInputs: false,
        inputBindings: {},
      },
      runtime: {
        provider: 'cloud_agent',
        agentId: '',
        model: 'sonnet',
      },
      guardrails: {
        approvalMode: 'approval_required',
        allowedSkills: [],
        allowedTools: [],
        timeoutMs: 300_000,
        maxToolCalls: 20,
      },
      goal: '描述这个节点要完成的业务目标',
      outputTemplateId: 'generic_data_result',
      outputSchema: 'generic_data_result',
      approvalMode: 'approval_required',
    };
  }

  if (type === 'trigger') {
    return {
      ...base,
      triggerType: 'file_uploaded',
      acceptedTypes: 'txt,md,pdf,docx,xlsx,xls,csv',
      sampleNote: '请上传待处理文件。',
    };
  }

  if (type === 'startup_config') {
    return { ...base, steps: [] };
  }

  if (type === 'user_input') {
    return {
      ...base,
      title: '请补充资料',
      instruction: '',
      assigneeRole: 'reviewer',
      fields: [
        {
          id: 'note',
          label: '补充说明',
          type: 'textarea',
          required: true,
          placeholder: '请输入补充说明',
        },
      ],
      slaMinutes: 60,
    };
  }

  if (type === 'transform') {
    return {
      ...base,
      transformMode: 'normalize',
      sourcePath: '',
      filterField: '',
      filterOperator: '==',
      filterValue: '',
      selectedFields: [],
      summarySampleSize: 3,
      normalizeTarget: 'standard_result',
      mappingExpression: '',
    };
  }

  if (type === 'condition') {
    return {
      ...base,
      output: { ports: [{ name: 'default' }, { name: 'true' }, { name: 'false' }] },
      condition: '',
      expression: '',
      trueBranch: 'yes',
      falseBranch: 'no',
      truePort: 'true',
      falsePort: 'false',
    };
  }

  if (type === 'human_approval') {
    return {
      ...base,
      assigneeRole: 'reviewer',
      condition: '',
      slaMinutes: 30,
    };
  }

  if (type === 'action') {
    return {
      ...base,
      actionType: 'push_result',
      target: 'business_system',
      sourceMode: 'workflow_output',
      sourceNodeId: '',
      note: '',
    };
  }

  if (type === 'output') {
    return {
      ...base,
      sourceMode: 'workflow_output',
      sourceNodeId: '',
      target: 'report_center',
      format: 'structured_json',
      fileNameMode: 'default',
      fileNameTemplate: '',
      renderInstruction: '',
    };
  }

  return base;
}

export function createNode(type: string, index: number): WorkflowNode {
  const template = resolveNodeTemplate(type);
  return {
    id: `node_${Date.now()}_${index}`,
    type,
    name: template?.label ?? type,
    config: defaultNodeConfig(type, index),
  };
}

export function createEdge(source: string, target: string): WorkflowEdge {
  return {
    id: `edge_${source}_${target}_${Date.now()}`,
    source,
    target,
  };
}

export function readNodePosition(node: WorkflowNode, index: number): { x: number; y: number } {
  const editor = node.config?.editor;
  if (editor && typeof editor === 'object' && editor !== null) {
    const position = (editor as { position?: { x?: number; y?: number } }).position;
    if (position && typeof position.x === 'number' && typeof position.y === 'number') {
      return { x: position.x, y: position.y };
    }
  }
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 90 + column * (NODE_W + 70), y: 120 + row * (NODE_H + 60) };
}

export function patchNodePosition(
  workflow: WorkflowDefinition,
  nodeId: string,
  position: { x: number; y: number },
): WorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const editor = (node.config.editor && typeof node.config.editor === 'object')
        ? (node.config.editor as Record<string, unknown>)
        : {};
      return {
        ...node,
        config: {
          ...node.config,
          editor: { ...editor, position },
        },
      };
    }),
  };
}

export function buildCanvasViews(workflow: WorkflowDefinition): CanvasNodeView[] {
  return workflow.nodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    name: node.name,
    subtitle: nodeTypeLabel(node.type),
    ...readNodePosition(node, index),
  }));
}

export function readNodeGoal(node: WorkflowNode): string {
  const task = node.config.task;
  if (task && typeof task === 'object' && 'goal' in task) {
    return String((task as { goal?: string }).goal ?? '');
  }
  const agentTask = node.config.agentConfig;
  if (agentTask && typeof agentTask === 'object') {
    const nested = (agentTask as { task?: { goal?: string } }).task;
    if (nested?.goal) return nested.goal;
  }
  return String(node.config.goal ?? '');
}

export function patchNodeGoal(node: WorkflowNode, goal: string): WorkflowNode {
  const config = { ...node.config };
  if (config.task && typeof config.task === 'object') {
    config.task = { ...(config.task as object), goal };
  }
  if (config.agentConfig && typeof config.agentConfig === 'object') {
    const agentConfig = { ...(config.agentConfig as object) };
    const task = (agentConfig as { task?: Record<string, unknown> }).task ?? {};
    (agentConfig as { task: Record<string, unknown> }).task = { ...task, goal };
    config.agentConfig = agentConfig;
  }
  config.goal = goal;
  return { ...node, config };
}

export function readNodeInstruction(node: WorkflowNode): string {
  const task = node.config.task;
  if (task && typeof task === 'object' && 'instruction' in task) {
    return String((task as { instruction?: string }).instruction ?? '');
  }
  const agentTask = node.config.agentConfig;
  if (agentTask && typeof agentTask === 'object') {
    const nested = (agentTask as { task?: { instruction?: string } }).task;
    if (nested?.instruction) return nested.instruction;
  }
  return '';
}

export function patchNodeInstruction(node: WorkflowNode, instruction: string): WorkflowNode {
  const config = { ...node.config };
  if (config.task && typeof config.task === 'object') {
    config.task = { ...(config.task as object), instruction };
  }
  if (config.agentConfig && typeof config.agentConfig === 'object') {
    const agentConfig = { ...(config.agentConfig as object) };
    const task = (agentConfig as { task?: Record<string, unknown> }).task ?? {};
    (agentConfig as { task: Record<string, unknown> }).task = { ...task, instruction };
    config.agentConfig = agentConfig;
  }
  return { ...node, config };
}

export function formatSavedAt(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
