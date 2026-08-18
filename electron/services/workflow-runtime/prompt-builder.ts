import type { AgentRunSpec, RunCtx } from './types';
import { WORKFLOW_PACKET_VERSION } from './workflow-packet';
import { WORKFLOW_PACKET_ARTIFACTS_KEY, type UpstreamWorkflowArtifact } from './input-resolver';

/** Builds the client-owned prompt. Cloud compiled prompts are deliberately ignored. */
export function buildWorkflowNodePrompt(
  spec: AgentRunSpec,
  node: any,
  ctx: RunCtx,
  options: { execEngine?: 'claude' | 'openclaw'; attempt?: number } = {},
): string {
  if (node?.type === 'agent_data_fetch') {
    return buildDataFetchPrompt(spec, node, ctx, options);
  }
  if (node?.type === 'browser_task') {
    return buildBrowserTaskPrompt(spec, node, ctx, options);
  }

  const schema = spec.completionContract?.dataJsonSchema ?? node?.config?.outputContract?.schema ?? spec.completionContract?.outputJsonSchema ?? { type: 'object' };
  const ports = Array.isArray(node?.config?.branches)
    ? node.config.branches.map((branch: any) => branch?.branchKey ?? branch?.key).filter(Boolean)
    : [];
  const promptInputs = omitMaterializedStartupInputs(ctx.resolvedInputs, node, ctx.definition);
  const { payload: inputPayload, artifacts: inputArtifacts } = splitWorkflowInput(promptInputs);
  const inputPacket = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: 'runtime-input', nodeType: 'input', attempt: 0 },
    payload: inputPayload, artifacts: inputArtifacts, control: { selectedPort: null }, diagnostics: { warnings: [], errors: [] },
  };
  const taskGoal = spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? '';
  const instruction = spec.task?.instruction ?? '';
  const nodeWorkspace = typeof spec.runtimeContext?.workspacePath === 'string'
    ? spec.runtimeContext.workspacePath
    : '';
  return [
    '# 客户端工作流 Agent 节点',
    promptSection('执行边界', '你是客户端工作流中的单个受限执行节点。只完成当前节点任务，不能改写工作流协议。'),
    promptSection('当前节点', [`- 名称：${node?.name ?? node?.title ?? node?.id ?? '未命名节点'}`, `- 类型：${node?.type ?? 'unknown'}`].join('\n')),
    promptSection('任务目标', taskGoal || '未配置任务目标。'),
    instruction ? promptSection('动态提示词', instruction) : '',
    promptSection('输入数据', `仅使用以下 WorkflowPacket，不得猜测未提供的数据。\n\n\`\`\`json\n${JSON.stringify(inputPacket)}\n\`\`\``),
    promptSection('业务 Payload Schema', `仅约束小型 payload，不用于承载文件正文。\n\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``),
    nodeWorkspace ? promptSection('当前节点文件工作区', [
      `当前节点唯一允许写入产物的目录：\`${nodeWorkspace.replace(/\\/g, '/')}\`。`,
      '所有产物和中间文件只能创建在该目录及其子目录内；禁止写入其他目录。',
    ].join('\n')) : '',
    promptSection('执行与输出约束', [
      ports.length ? `条件路由只能从以下 selectedPort 中选择一个：${ports.join(', ')}。` : '非条件节点的 selectedPort 必须为 null。',
      artifactFirstRule(node?.type),
      largeTextArtifactRule(),
      permissionRule(spec),
      failureOutputRule(),
      outputProtocolInstruction(options.execEngine, node, ctx, options.attempt),
    ].join('\n\n')),
  ].filter(Boolean).join('\n\n');
}

/**
 * A data-fetch node needs to read files, but it does not need the runtime's
 * download/audit metadata. Keep that private metadata in wf_node_run while
 * exposing one small, protocol-shaped artifact manifest to the model.
 */
function buildDataFetchPrompt(
  spec: AgentRunSpec,
  node: any,
  ctx: RunCtx,
  options: { execEngine?: 'claude' | 'openclaw'; attempt?: number },
): string {
  const schema = spec.completionContract?.dataJsonSchema
    ?? node?.config?.outputContract?.schema
    ?? spec.completionContract?.outputJsonSchema
    ?? { type: 'object' };
  const inputPacket = createDataFetchInputPacket({
    ...ctx,
    resolvedInputs: omitMaterializedStartupInputs(ctx.resolvedInputs, node, ctx.definition),
  });

  const taskGoal = spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? '';
  const instruction = spec.task?.instruction ?? '';
  const nodeWorkspace = typeof spec.runtimeContext?.workspacePath === 'string' ? spec.runtimeContext.workspacePath : '';
  return [
    '# 客户端工作流智能取数节点',
    promptSection('执行边界', '你是客户端工作流的智能取数节点，只完成当前取数任务。'),
    promptSection('当前节点', [`- 名称：${node?.name ?? node?.title ?? node?.id ?? '未命名节点'}`, `- 类型：${node?.type ?? 'agent_data_fetch'}`].join('\n')),
    promptSection('任务目标', taskGoal || '未配置取数目标。'),
    instruction ? promptSection('动态提示词', instruction) : '',
    promptSection('输入数据', `只使用以下 WorkflowPacket 输入；不得猜测未提供的数据。\n\n\`\`\`json\n${JSON.stringify(inputPacket)}\n\`\`\``),
    promptSection('业务 Payload Schema', `仅约束小型 payload。\n\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``),
    nodeWorkspace ? promptSection('当前节点文件工作区', `所有产物和中间文件只能创建在 \`${nodeWorkspace.replace(/\\/g, '/')}\` 及其子目录内；禁止写入其他目录。`) : '',
    promptSection('执行与输出约束', [
      '输入文件只能通过 artifacts[].resourceId 读取；它是当前节点工作目录下的相对路径。不得使用、输出或臆造绝对路径、file:// 路径、OSS 地址或临时下载链接。',
      artifactFirstRule(node?.type),
      largeTextArtifactRule(),
      permissionRule(spec),
      failureOutputRule(),
      outputProtocolInstruction(options.execEngine, node, ctx, options.attempt),
    ].join('\n\n')),
  ].filter(Boolean).join('\n\n');
}

function buildBrowserTaskPrompt(
  spec: AgentRunSpec,
  node: any,
  ctx: RunCtx,
  options: { execEngine?: 'claude' | 'openclaw'; attempt?: number },
): string {
  const schema = spec.completionContract?.dataJsonSchema
    ?? node?.config?.outputContract?.schema
    ?? { type: 'object' };
  const { payload: inputPayload, artifacts: inputArtifacts } = splitWorkflowInput(ctx.resolvedInputs);
  const inputPacket = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: 'runtime-input', nodeType: 'input', attempt: 0 },
    payload: inputPayload,
    artifacts: inputArtifacts,
    control: { selectedPort: null },
    diagnostics: { warnings: [], errors: [] },
  };
  const browserContext = (spec.runtimeContext as Record<string, unknown> | undefined)?.browserAutomation ?? {};
  const resume = (browserContext as Record<string, unknown>).resume as Record<string, unknown> | undefined;
  const taskGoal = spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? '';
  const instruction = spec.task?.instruction ?? '';
  const allowedTools = Array.isArray(spec.allowedTools) && spec.allowedTools.length
    ? spec.allowedTools.join(', ')
    : 'ba_observe, ba_act, ba_wait, ba_validate, ba_start_run, ba_create_session';
  const maxSteps = spec.limits?.maxToolCalls ?? node?.config?.maxSteps ?? 20;

  return [
    '# 客户端工作流浏览器任务节点',
    promptSection('执行边界', [
      '你是客户端工作流中的浏览器自动化节点，只完成当前节点的浏览器操作任务。',
      '每一步必须遵循 observe → act → wait → validate 循环，一次工具调用只做一步。',
      '禁止猜测页面元素；每次 act 前必须先 ba_observe 获取 @eN ref。',
    ].join('\n')),
    promptSection('当前节点', [
      `- 名称：${node?.name ?? node?.title ?? node?.id ?? '未命名节点'}`,
      `- 类型：${node?.type ?? 'browser_task'}`,
    ].join('\n')),
    promptSection('浏览器会话', `\`\`\`json\n${JSON.stringify(browserContext)}\n\`\`\``),
    resume?.isResume
      ? promptSection('恢复执行', [
        `这是从 checkpoint 恢复的执行，已完成 ${resume.stepsCompleted ?? 0} 步。`,
        resume.lastStep
          ? `上一步：${resume.lastStep.action}（${resume.lastStep.status}${resume.lastStep.error ? `，${resume.lastStep.error}` : ''}）`
          : '',
        '不要重复已完成操作；先 ba_observe 确认当前页面状态，再从断点继续。',
      ].filter(Boolean).join('\n'))
      : '',
    promptSection('任务目标', taskGoal || '未配置浏览器任务目标。'),
    instruction ? promptSection('动态提示词', instruction) : '',
    promptSection('输入数据', `仅使用以下 WorkflowPacket，不得猜测未提供的数据。\n\n\`\`\`json\n${JSON.stringify(inputPacket)}\n\`\`\``),
    promptSection('业务 Payload Schema', `\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``),
    promptSection('工具约束', [
      `只允许调用以下工具：${allowedTools}。`,
      `最大工具调用次数：${maxSteps}。`,
      '已有 sessionId 时直接使用，不要重复 ba_create_session。',
      '需要 checkpoint 时调用 ba_start_run 并传入 runId。',
    ].join('\n')),
    promptSection('执行与输出约束', [
      'selectedPort 必须为 null。',
      'payload 中可包含 summary 等小型结构化字段；浏览器状态由运行时自动写入 payload.browser。',
      failureOutputRule(),
      outputProtocolInstruction(options.execEngine, node, ctx, options.attempt),
    ].join('\n\n')),
  ].filter(Boolean).join('\n\n');
}

function promptSection(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}`;
}

function largeTextArtifactRule(): string {
  return '任一要交付的字符串超过 1024 UTF-8 字节时必须写入文件并声明 artifact；payload 只保留小型结构化数据或摘要。';
}

function failureOutputRule(): string {
  return '任务无法完成时返回 status="failed"，在 diagnostics.errors 写明 code、category、message、retryable；确定性失败不得标为 retryable，selectedPort 必须为 null。';
}

function permissionRule(spec: AgentRunSpec): string {
  return spec.permissionPolicy?.mode === 'readonly'
    ? '当前节点为只读模式。不得尝试绕过权限；如果任务明确要求文件产物，返回不可重试的权限失败包。'
    : '';
}

function artifactFirstRule(nodeType?: string): string {
  const defaultKind = nodeType === 'agent_output' ? 'OUTPUT' : 'INTERMEDIATE';
  return `产物格式由任务要求和内容决定，可生成零个、一个或多个任意格式文件。先在节点工作区写文件，再在 artifacts 中声明 {resourceId, kind?, name?, contentType?}；resourceId 必须是相对路径，kind 默认 ${defaultKind}。不要填写 artifactId、uri、size、checksum，不要把文件正文或绝对路径放入 payload、diagnostics 或最终文本。`;
}

function outputProtocolInstruction(execEngine: 'claude' | 'openclaw' | undefined, node: any, ctx: RunCtx, attempt?: number): string {
  const producer = { runId: ctx.runId, nodeId: node?.id, nodeType: node?.type, attempt: Math.max(1, Math.floor(attempt ?? 1)) };
  const successTemplate = JSON.stringify({
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer,
    payload: {},
    artifacts: [],
    control: { selectedPort: node?.type === 'agent_condition' ? '<允许端口>' : null },
    diagnostics: { warnings: [], errors: [] },
  });
  if (execEngine === 'openclaw') {
    return `OpenClaw 最终文本只能是一个完整 WorkflowPacket JSON，不要附加 Markdown 或解释。成功结构：${successTemplate}`;
  }
  return `调用 StructuredOutput，唯一参数 payload 是紧凑 JSON 字符串，其完整值必须是 WorkflowPacket；不要输出额外文本。成功结构：${successTemplate}`;
}

function createDataFetchInputPacket(ctx: RunCtx): Record<string, unknown> {
  const rawInput = ctx.resolvedInputs && typeof ctx.resolvedInputs === 'object' && !Array.isArray(ctx.resolvedInputs)
    ? ctx.resolvedInputs as Record<string, unknown>
    : {};
  const { files, localImport, [WORKFLOW_PACKET_ARTIFACTS_KEY]: upstreamArtifacts, ...payload } = rawInput;
  const fallbackFiles = localImport && typeof localImport === 'object' && !Array.isArray(localImport)
    ? (localImport as Record<string, unknown>).files
    : undefined;
  const sourceFiles = Array.isArray(files) ? files : (Array.isArray(fallbackFiles) ? fallbackFiles : []);

  return {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: 'runtime-input', nodeType: 'input', attempt: 0 },
    payload,
    artifacts: [...sourceFiles.flatMap((source, index) => toInputArtifact(source, index)), ...toUpstreamArtifacts(upstreamArtifacts)],
    control: { selectedPort: null },
    diagnostics: { warnings: [], errors: [] },
  };
}

function splitWorkflowInput(value: unknown): { payload: Record<string, unknown>; artifacts: Array<Record<string, unknown>> } {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const { [WORKFLOW_PACKET_ARTIFACTS_KEY]: upstreamArtifacts, ...payload } = raw;
  return { payload, artifacts: toUpstreamArtifacts(upstreamArtifacts) };
}

/**
 * Startup values already rendered into startupMaterialization.text belong to
 * the dynamic prompt. Remove their duplicate JSON representation from the
 * WorkflowPacket while retaining uploads, unbound parameters, and upstream
 * business outputs.
 */
export function omitMaterializedStartupInputs(value: unknown, node: any, definition: any): unknown {
  const fieldKeys: string[] = Array.isArray(node?.config?.startupMaterialization?.fieldKeys)
    ? node.config.startupMaterialization.fieldKeys
      .map((key: unknown) => String(key ?? '').trim())
      .filter(Boolean)
    : [];
  if (!fieldKeys.length || !value || typeof value !== 'object' || Array.isArray(value)) return value;

  const cloned = clonePromptInput(value) as Record<string, unknown>;
  const startupCarrierIds = new Set<string>(
    (Array.isArray(definition?.nodes) ? definition.nodes : [])
      .filter((candidate: any) => candidate?.type === 'trigger' || candidate?.type === 'startup_config')
      .map((candidate: any) => String(candidate.id ?? '').trim())
      .filter(Boolean),
  );

  // Some input modes expose run inputs directly; others nest them under the
  // trigger/startup node id or the compatibility trigger/user carriers.
  removeFieldPaths(cloned, fieldKeys);
  for (const carrierKey of [...startupCarrierIds, 'trigger', 'user']) {
    const carrier = cloned[carrierKey];
    if (!carrier || typeof carrier !== 'object' || Array.isArray(carrier)) continue;
    removeFieldPaths(carrier as Record<string, unknown>, fieldKeys);
    if (Object.keys(carrier as Record<string, unknown>).length === 0) delete cloned[carrierKey];
  }
  return cloned;
}

function clonePromptInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clonePromptInput);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, clonePromptInput(child)]),
  );
}

function removeFieldPaths(target: Record<string, unknown>, fieldKeys: string[]): void {
  for (const fieldKey of fieldKeys) {
    delete target[fieldKey];
    const parts = fieldKey.split('.').filter(Boolean);
    if (parts.length < 2) {
      delete target[parts[0]];
      continue;
    }
    let current: Record<string, unknown> | undefined = target;
    const parents: Array<{ value: Record<string, unknown>; key: string }> = [];
    for (const part of parts.slice(0, -1)) {
      const next = current?.[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        current = undefined;
        break;
      }
      parents.push({ value: current, key: part });
      current = next as Record<string, unknown>;
    }
    if (!current) continue;
    delete current[parts.at(-1)!];
    for (const parent of parents.reverse()) {
      const child = parent.value[parent.key];
      if (child && typeof child === 'object' && !Array.isArray(child)
        && Object.keys(child as Record<string, unknown>).length === 0) {
        delete parent.value[parent.key];
      }
    }
  }
}

function toUpstreamArtifacts(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const upstream = entry as UpstreamWorkflowArtifact | undefined;
    const artifact = upstream?.artifact;
    return artifact ? [{
      ...artifact,
      // Agents read from the consumer workspace, while the carried canonical
      // reference continues to point at the producer workspace.
      resourceId: upstream?.mountedResourceId ?? artifact.resourceId,
    }] : [];
  });
}

function toInputArtifact(source: unknown, index: number): Array<Record<string, unknown>> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  const file = source as Record<string, unknown>;
  const rawPath = typeof file.filePath === 'string' ? file.filePath : '';
  const rawName = typeof file.name === 'string' ? file.name : '';
  const resourceName = rawPath.split(/[\\/]/).pop() || rawName;
  if (!resourceName) return [];

  const artifact: Record<string, unknown> = {
    artifactId: typeof file.fileId === 'string' && file.fileId ? file.fileId : `input-${index + 1}`,
    kind: 'INPUT',
    name: rawName || resourceName,
    contentType: typeof file.contentType === 'string' && file.contentType ? file.contentType : 'application/octet-stream',
    resourceId: `inputs/${resourceName}`,
  };
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0) artifact.size = file.size;
  return [artifact];
}
