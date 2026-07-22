import type { AgentRunSpec, RunCtx } from './types';
import { WORKFLOW_PACKET_VERSION } from './workflow-packet';
import { WORKFLOW_PACKET_ARTIFACTS_KEY, type UpstreamWorkflowArtifact } from './input-resolver';

/** Builds the client-owned prompt. Cloud compiled prompts are deliberately ignored. */
export function buildWorkflowNodePrompt(spec: AgentRunSpec, node: any, ctx: RunCtx): string {
  if (node?.type === 'agent_data_fetch') {
    return buildDataFetchPrompt(spec, node, ctx);
  }

  // spec is the normalized runtime contract.  It may deliberately tighten a
  // legacy `{ type: 'object' }` node configuration (for example HTML output).
  const schema = spec.completionContract?.dataJsonSchema ?? node?.config?.outputContract?.schema ?? spec.completionContract?.outputJsonSchema ?? { type: 'object' };
  const htmlArtifactOutput = node?.type === 'agent_output'
    && Array.isArray(schema?.required)
    && schema.required.includes('html');
  const ports = Array.isArray(node?.config?.branches)
    ? node.config.branches.map((branch: any) => branch?.branchKey ?? branch?.key).filter(Boolean)
    : [];
  const { payload: inputPayload, artifacts: inputArtifacts } = splitWorkflowInput(ctx.resolvedInputs);
  const inputPacket = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: 'runtime-input', nodeType: 'input', attempt: 0 },
    payload: inputPayload, artifacts: inputArtifacts, control: { selectedPort: null }, diagnostics: { warnings: [], errors: [] },
  };
  const resultTemplate = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: node?.id, nodeType: node?.type, attempt: '<当前尝试次数>' },
    payload: '<必须符合 payloadSchema>', artifacts: [],
    control: { selectedPort: node?.type === 'agent_condition' ? '<必须从允许端口选择>' : null },
    diagnostics: { warnings: [], errors: [] },
  };
  const failureTemplate = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'failed',
    producer: { runId: ctx.runId, nodeId: node?.id, nodeType: node?.type, attempt: '<当前尝试次数>' },
    payload: { reason: '<可选：简短业务上下文，不能伪装成成功结果>' }, artifacts: [],
    control: { selectedPort: null },
    diagnostics: { warnings: [], errors: [{ code: '<稳定错误码>', category: '<错误分类>', message: '<面向用户的明确失败原因>', retryable: false, attemptsUsed: '<当前尝试次数>' }] },
  };
  const taskGoal = spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? '';
  const instruction = spec.task?.instruction ?? '';
  return [
    '# 客户端工作流 Agent 节点',
    promptSection('执行边界', '你是客户端工作流中的单个受限执行节点。只完成当前节点任务，不能改写工作流协议。'),
    promptSection('当前节点', [`- 名称：${node?.name ?? node?.title ?? node?.id ?? '未命名节点'}`, `- 类型：${node?.type ?? 'unknown'}`].join('\n')),
    promptSection('任务目标', taskGoal || '未配置任务目标。'),
    instruction ? promptSection('动态提示词', instruction) : '',
    promptSection('输入数据', `输入仅以以下 WorkflowPacket 为准；不得引用未提供的上下文或猜测上游数据。\n\n\`\`\`json\n${JSON.stringify(inputPacket, null, 2)}\n\`\`\``),
    promptSection('输出 Schema', `你的业务 payload 必须符合以下动态 schema。\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``),
    promptSection('执行与输出约束', [
      ports.length ? `条件路由只能从以下 selectedPort 中选择一个：${ports.join(', ')}。` : '非条件节点的 selectedPort 必须为 null。',
      htmlArtifactOutput
        ? '这是 HTML 交付节点：payload.html 必须是完整、可直接打开的 HTML 文档（包含 <!doctype html> 或 <html>）。不要把 HTML 放进 Markdown、摘要字段或 artifacts；客户端会将 payload.html 写成 HTML 文件并登记 OUTPUT artifact。payload.fileName 如提供，必须是仅含文件名的 .html 文件名。'
        : '如需生成大结果，可写入当前工作区文件，再在 artifacts 中声明稳定引用。不要把文件绝对路径写入 payload。',
      htmlArtifactOutput
        ? '最终 HTML 由客户端转换为 OUTPUT 产物；除此之外，任何要交给下游且 UTF-8 编码超过 1024 字节的文本，都必须写入当前节点工作区的 processFiles/ 文件，并以 INTERMEDIATE artifact 引用传递。'
        : largeTextArtifactRule(),
      failureOutputRule(),
      'SDK 已启用 JSON Schema 结构化输出。最终回答必须直接产生该结构化结果；不要写 node-result.json，不要输出 Markdown、代码块或额外文本。',
      'artifacts 不得包含 checksum。',
    ].join('\n\n')),
    promptSection('结果模板', `成功时使用成功包；任务无法完成时使用失败包。替换 payload、artifacts、selectedPort 与 attempt，禁止新增或删减根字段。\n\n成功包：\n\`\`\`json\n${JSON.stringify(resultTemplate, null, 2)}\n\`\`\`\n\n失败包：\n\`\`\`json\n${JSON.stringify(failureTemplate, null, 2)}\n\`\`\``),
  ].filter(Boolean).join('\n\n');
}

/**
 * A data-fetch node needs to read files, but it does not need the runtime's
 * download/audit metadata. Keep that private metadata in wf_node_run while
 * exposing one small, protocol-shaped artifact manifest to the model.
 */
function buildDataFetchPrompt(spec: AgentRunSpec, node: any, ctx: RunCtx): string {
  const schema = spec.completionContract?.dataJsonSchema
    ?? node?.config?.outputContract?.schema
    ?? spec.completionContract?.outputJsonSchema
    ?? { type: 'object' };
  const inputPacket = createDataFetchInputPacket(ctx);

  const taskGoal = spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? '';
  const instruction = spec.task?.instruction ?? '';
  return [
    '# 客户端工作流智能取数节点',
    promptSection('执行边界', '你是客户端工作流的智能取数节点，只完成当前取数任务。'),
    promptSection('当前节点', [`- 名称：${node?.name ?? node?.title ?? node?.id ?? '未命名节点'}`, `- 类型：${node?.type ?? 'agent_data_fetch'}`].join('\n')),
    promptSection('任务目标', taskGoal || '未配置取数目标。'),
    instruction ? promptSection('动态提示词', instruction) : '',
    promptSection('输入数据', `只使用以下 WorkflowPacket 输入；不得猜测或引用未提供的数据。\n\n\`\`\`json\n${JSON.stringify(inputPacket, null, 2)}\n\`\`\``),
    promptSection('输出 Schema', `payload 必须符合此 schema。\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``),
    promptSection('执行与输出约束', [
      '输入文件只能通过 artifacts[].resourceId 读取；它是当前节点工作目录下的相对路径。不得使用、输出或臆造绝对路径、file:// 路径、OSS 地址或临时下载链接。',
      largeTextArtifactRule(),
      failureOutputRule(),
      'SDK 已强制结果 schema。最终只返回符合 WorkflowPacket 的 JSON，不要 Markdown、代码块、解释性文字或 node-result.json。',
    ].join('\n\n')),
  ].filter(Boolean).join('\n\n');
}

function promptSection(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}`;
}

function largeTextArtifactRule(): string {
  return '大文本传递规则：任何要交给下游、UTF-8 编码超过 1024 字节的文本，不得内联在 payload。必须写入当前节点工作区的 processFiles/ 文件（JSON 用 .json，其它文本用 .txt），并在 artifacts 中声明 kind=INTERMEDIATE、artifactId、name、contentType 与相对 resourceId；payload 只保留简短摘要和该 artifactId。';
}

function failureOutputRule(): string {
  return '失败输出规则：如果当前任务明确无法完成，必须返回 status="failed" 的完整 WorkflowPacket，失败原因必须写入 diagnostics.errors[0].message。不得把 result="failed"、reason 或错误文字仅放在 payload 后仍返回 status="succeeded"。技能不存在、权限不足、必需参数/数据不可用且无法继续属于确定性失败，retryable 必须为 false；仅网络抖动、上游服务暂不可用等瞬态问题才可设为 true。失败包的 selectedPort 必须为 null，失败不会传给下游节点。';
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

function toUpstreamArtifacts(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const artifact = (entry as UpstreamWorkflowArtifact | undefined)?.artifact;
    return artifact ? [{ ...artifact }] : [];
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
