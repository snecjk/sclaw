/** Runtime input binding compatibility with the former server orchestrator. */

export interface RuntimeInputs {
  runInput: Record<string, unknown>;
  upstream: Record<string, unknown>;
  workflowOutput?: unknown;
}

export function unwrapEnvelope(value: any): any {
  if (Array.isArray(value) && value.length === 1) return unwrapEnvelope(value[0]);
  if (!value || typeof value !== 'object') return value;
  if (value.kind === 'json' && 'value' in value) return value.value;
  if (value.kind === 'artifact') return value;
  if (value.protocolVersion === 'workflow-packet/v1') return value.payload;
  if ('value' in value && Object.keys(value).some((key) => key === 'nodeId' || key === 'nodeType')) {
    return value.value;
  }
  return value;
}

export function resolveNodeInput(node: any, ctx: RuntimeInputs): any {
  if (node?.type === 'trigger' || node?.type === 'startup_config') return ctx.runInput ?? {};
  const config = node?.config ?? {};
  const fields: Record<string, unknown> = {};
  const bindings = Array.isArray(config.input?.bindings) ? config.input.bindings : [];
  for (const binding of bindings) {
    const target = binding?.toField || binding?.targetField || 'payload';
    const sourceNodeId = binding?.from?.nodeId || binding?.sourceNodeId;
    const port = binding?.from?.port || binding?.sourcePort || 'default';
    let value = sourceNodeId ? ctx.upstream[sourceNodeId] : undefined;
    value = unwrapEnvelope(value);
    if (port && port !== 'default') value = resolvePath(value, port);
    if (value === undefined && binding?.required) {
      throw new Error(`节点 ${node.id} 缺少必填输入绑定 ${target}`);
    }
    if (value !== undefined) fields[target] = value;
  }

  const agentInputs = config.agentConfig?.inputs ?? config.inputs;
  const sourceIds = Array.isArray(agentInputs?.sourceNodeIds) ? agentInputs.sourceNodeIds : [];
  for (const sourceId of sourceIds) {
    if (sourceId in ctx.upstream) fields[sourceId] = unwrapEnvelope(ctx.upstream[sourceId]);
  }
  const inputBindings = agentInputs?.inputBindings;
  if (inputBindings && typeof inputBindings === 'object') {
    for (const [target, source] of Object.entries(inputBindings)) {
      fields[target] = resolveBindingSource(source, ctx);
    }
  }
  if (agentInputs?.includeTriggerInputs) fields.trigger = ctx.runInput;
  if (agentInputs?.includeUserInputs) fields.user = ctx.runInput;

  if (Object.keys(fields).length) return fields;
  if (config.sourceMode === 'node_output' && config.sourceNodeId) {
    return unwrapEnvelope(ctx.upstream[config.sourceNodeId]);
  }
  if (config.sourceMode === 'workflow_output' && ctx.workflowOutput !== undefined) {
    return unwrapEnvelope(ctx.workflowOutput);
  }
  return Object.fromEntries(Object.entries(ctx.upstream).map(([key, value]) => [key, unwrapEnvelope(value)]));
}

export function buildConditionContext(ctx: RuntimeInputs): Record<string, unknown> {
  return {
    ...ctx.runInput,
    nodes: Object.fromEntries(Object.entries(ctx.upstream).map(([id, output]) => [id, { output: unwrapEnvelope(output) }])),
    workflow: { output: unwrapEnvelope(ctx.workflowOutput) },
  };
}

function resolveBindingSource(source: any, ctx: RuntimeInputs): unknown {
  if (typeof source === 'string') return resolveTemplatePath(source, ctx);
  if (!source || typeof source !== 'object') return source;
  if (source.nodeId) return resolvePath(unwrapEnvelope(ctx.upstream[source.nodeId]), source.path || source.port);
  if (source.path) return resolveTemplatePath(source.path, ctx);
  return source.value;
}

function resolveTemplatePath(raw: string, ctx: RuntimeInputs): unknown {
  const path = raw.trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
  return resolvePath(buildConditionContext(ctx), path);
}

export function resolvePath(value: any, path?: string): any {
  if (!path || path === 'default') return value;
  return String(path).split('.').reduce((current, part) => {
    if (current == null) return undefined;
    return current[part];
  }, value);
}
