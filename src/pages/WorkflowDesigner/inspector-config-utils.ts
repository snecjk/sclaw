import type { WorkflowDefinition, WorkflowNode } from '@/pages/WorkflowDesigner/types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function patchNodeConfig(node: WorkflowNode, configPatch: Record<string, unknown>): WorkflowNode {
  return { ...node, config: { ...node.config, ...configPatch } };
}

export function readConfigString(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key];
  return value === undefined || value === null ? fallback : String(value);
}

export function readConfigNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function readCsv(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function updateArrayItem<T extends Record<string, unknown>>(
  items: T[],
  index: number,
  patch: Partial<T>,
): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

export function buildSourceNodeOptions(workflow: WorkflowDefinition, currentNodeId: string) {
  return workflow.nodes
    .filter((node) => node.id !== currentNodeId)
    .map((node) => ({ value: node.id, label: node.name }));
}

export function buildDownstreamNodeOptions(workflow: WorkflowDefinition, nodeId: string) {
  const targetIds = new Set(
    workflow.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target),
  );
  return workflow.nodes
    .filter((node) => targetIds.has(node.id))
    .map((node) => ({ value: node.id, label: node.name }));
}

export type SimpleConditionParts = {
  field: string;
  operator: '==' | '!=' | 'in';
  value: string;
};

export function parseSimpleCondition(expression: string): SimpleConditionParts {
  const trimmed = expression.trim();
  const inMatch = trimmed.match(/^\{\{([^}]+)\}\}\s+in\s+\[(.+)\]$/);
  if (inMatch) {
    const values = inMatch[2]
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .join(',');
    return { field: inMatch[1].trim(), operator: 'in', value: values };
  }
  const eqMatch = trimmed.match(/^\{\{([^}]+)\}\}\s*(==|!=)\s*(.+)$/);
  if (eqMatch) {
    return {
      field: eqMatch[1].trim(),
      operator: eqMatch[2] as '==' | '!=',
      value: eqMatch[3].trim().replace(/^['"]|['"]$/g, ''),
    };
  }
  return { field: '', operator: '==', value: '' };
}

export function buildSimpleCondition(parts: SimpleConditionParts): string {
  const field = parts.field.trim();
  const value = parts.value.trim();
  if (!field || !value) return '';
  if (parts.operator === 'in') {
    const values = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `'${item}'`)
      .join(', ');
    return `{{${field}}} in [${values}]`;
  }
  return `{{${field}}} ${parts.operator} '${value}'`;
}

export function readPrimaryBinding(config: Record<string, unknown>) {
  const input = isRecord(config.input) ? config.input : {};
  const bindings = Array.isArray(input.bindings) ? input.bindings : [];
  const first = bindings[0];
  if (!isRecord(first)) return { nodeId: '', port: 'default' };
  const source = isRecord(first.from) ? first.from : {};
  return {
    nodeId: typeof source.nodeId === 'string' ? source.nodeId : '',
    port: typeof source.port === 'string' ? source.port : 'default',
  };
}

export function patchPrimaryBinding(
  currentConfig: Record<string, unknown>,
  source: { nodeId: string; port: string },
): Record<string, unknown> {
  const nextBindings = source.nodeId
    ? [{ toField: 'payload', from: { nodeId: source.nodeId, port: source.port }, required: true }]
    : [];
  return {
    ...currentConfig,
    input: {
      ...(isRecord(currentConfig.input) ? currentConfig.input : {}),
      mode: 'auto',
      bindings: nextBindings,
    },
    sourceMode: source.nodeId ? 'node_output' : 'workflow_output',
    sourceNodeId: source.nodeId,
  };
}

export function resolveSmartAgentKind(type: string): string | null {
  if (
    type === 'agent_data_fetch' ||
    type === 'agent_data_process' ||
    type === 'agent_condition' ||
    type === 'agent_output'
  ) {
    return type;
  }
  return null;
}

export function readBusinessConfig(config: Record<string, unknown>) {
  return isRecord(config.businessConfig) ? config.businessConfig : {};
}

export function readAgentConfig(config: Record<string, unknown>) {
  return isRecord(config.agentConfig) ? config.agentConfig : {};
}

export function readAgentTask(config: Record<string, unknown>) {
  const agentConfig = readAgentConfig(config);
  return isRecord(agentConfig.task) ? agentConfig.task : {};
}

export type AgentTaskConfigView = {
  task: {
    goal: string;
    instruction: string;
    outputTemplateId: string;
  };
  guardrails: { approvalMode: string };
  runtime: { provider: string; agentId: string };
  inputs: {
    mode: string;
    sourceNodeIds: string[];
    includeTriggerInputs: boolean;
    includeUserInputs: boolean;
  };
};

export function normalizeAgentTaskConfig(config: Record<string, unknown>): AgentTaskConfigView {
  const task = isRecord(config.task) ? config.task : {};
  const guardrails = isRecord(config.guardrails) ? config.guardrails : {};
  const runtime = isRecord(config.runtime) ? config.runtime : {};
  const inputs = isRecord(config.inputs) ? config.inputs : {};
  return {
    task: {
      goal: String(task.goal ?? config.goal ?? ''),
      instruction: String(task.instruction ?? ''),
      outputTemplateId: String(task.outputTemplateId ?? config.outputTemplateId ?? 'generic_data_result'),
    },
    guardrails: {
      approvalMode: String(guardrails.approvalMode ?? config.approvalMode ?? 'approval_required'),
    },
    runtime: {
      provider: String(runtime.provider ?? 'cloud_agent'),
      agentId: String(runtime.agentId ?? ''),
    },
    inputs: {
      mode: String(inputs.mode ?? 'auto_previous'),
      sourceNodeIds: Array.isArray(inputs.sourceNodeIds)
        ? inputs.sourceNodeIds.filter((id): id is string => typeof id === 'string')
        : [],
      includeTriggerInputs: Boolean(inputs.includeTriggerInputs),
      includeUserInputs: Boolean(inputs.includeUserInputs),
    },
  };
}

export function patchAgentTaskConfig(
  config: Record<string, unknown>,
  patch: {
    task?: Partial<AgentTaskConfigView['task']>;
    guardrails?: Partial<AgentTaskConfigView['guardrails']>;
    runtime?: Partial<AgentTaskConfigView['runtime']>;
    inputs?: Partial<AgentTaskConfigView['inputs']>;
  },
): Record<string, unknown> {
  const current = normalizeAgentTaskConfig(config);
  const nextTask = { ...current.task, ...patch.task };
  const nextGuardrails = { ...current.guardrails, ...patch.guardrails };
  const nextRuntime = { ...current.runtime, ...patch.runtime };
  const nextInputs = { ...current.inputs, ...patch.inputs };
  return {
    ...config,
    task: {
      ...(isRecord(config.task) ? config.task : {}),
      ...nextTask,
      outputSchema: nextTask.outputTemplateId,
    },
    guardrails: {
      ...(isRecord(config.guardrails) ? config.guardrails : {}),
      ...nextGuardrails,
    },
    runtime: {
      ...(isRecord(config.runtime) ? config.runtime : {}),
      ...nextRuntime,
    },
    inputs: {
      ...(isRecord(config.inputs) ? config.inputs : {}),
      ...nextInputs,
    },
    goal: nextTask.goal,
    outputTemplateId: nextTask.outputTemplateId,
    outputSchema: nextTask.outputTemplateId,
    approvalMode: nextGuardrails.approvalMode,
  };
}

export function patchSmartAgentConfig(
  config: Record<string, unknown>,
  patch: {
    businessConfig?: Record<string, unknown>;
    agentConfig?: Record<string, unknown>;
    branches?: Array<Record<string, unknown>>;
  },
): Record<string, unknown> {
  const businessConfig = { ...readBusinessConfig(config), ...patch.businessConfig };
  const agentConfig = { ...readAgentConfig(config), ...(patch.agentConfig ?? {}) };
  if (patch.agentConfig && isRecord(patch.agentConfig.task)) {
    const existingTask = readAgentTask(config);
    agentConfig.task = { ...existingTask, ...patch.agentConfig.task };
  }
  return {
    ...config,
    businessConfig,
    agentConfig,
    ...(patch.branches ? { branches: patch.branches } : {}),
  };
}

export function toFieldId(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, '_');
  return normalized || `field_${Date.now()}`;
}

export type UserInputField = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export function readUserInputFields(config: Record<string, unknown>): UserInputField[] {
  if (!Array.isArray(config.fields)) return [];
  return config.fields
    .filter(isRecord)
    .map((field) => ({
      id: String(field.id ?? ''),
      label: String(field.label ?? ''),
      type: String(field.type ?? 'text'),
      required: Boolean(field.required),
      placeholder: typeof field.placeholder === 'string' ? field.placeholder : '',
      options: Array.isArray(field.options)
        ? field.options.filter((item): item is string => typeof item === 'string')
        : undefined,
    }));
}

export function updateUserInputField(
  fields: UserInputField[],
  index: number,
  patch: Partial<UserInputField>,
): UserInputField[] {
  return updateArrayItem(fields, index, patch);
}

export function readFieldOptionsText(options: string[] | undefined): string {
  return options?.join('\n') ?? '';
}

export function parseFieldOptionsText(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}
