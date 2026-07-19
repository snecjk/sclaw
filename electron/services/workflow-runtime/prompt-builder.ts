import type { AgentRunSpec, RunCtx } from './types';
import { WORKFLOW_PACKET_VERSION } from './workflow-packet';

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
  const inputPacket = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: 'runtime-input', nodeType: 'input', attempt: 0 },
    payload: ctx.resolvedInputs ?? {}, artifacts: [], control: { selectedPort: null }, diagnostics: { warnings: [], errors: [] },
  };
  const resultTemplate = {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: node?.id, nodeType: node?.type, attempt: '<当前尝试次数>' },
    payload: '<必须符合 payloadSchema>', artifacts: [],
    control: { selectedPort: node?.type === 'agent_condition' ? '<必须从允许端口选择>' : null },
    diagnostics: { warnings: [], errors: [] },
  };
  return [
    '你是客户端工作流中的单个受限执行节点。只完成当前节点任务，不能改写工作流协议。',
    `节点：${node?.name ?? node?.title ?? node?.id} (${node?.type})`,
    `任务目标：${spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? ''}`,
    '输入仅以以下 WorkflowPacket 为准；不得引用未提供的上下文或猜测上游数据：',
    JSON.stringify(inputPacket, null, 2),
    `你的业务 payload 必须符合以下动态 schema：${JSON.stringify(schema, null, 2)}`,
    ports.length ? `条件路由只能从以下 selectedPort 中选择一个：${ports.join(', ')}` : '非条件节点的 selectedPort 必须为 null。',
    htmlArtifactOutput
      ? '这是 HTML 交付节点：payload.html 必须是完整、可直接打开的 HTML 文档（包含 <!doctype html> 或 <html>）。不要把 HTML 放进 Markdown、摘要字段或 artifacts；客户端会将 payload.html 写成 HTML 文件并登记 OUTPUT artifact。payload.fileName 如提供，必须是仅含文件名的 .html 文件名。'
      : '如需生成大结果，可写入当前工作区文件，再在 artifacts 中声明稳定引用。不要把文件绝对路径写入 payload。',
    htmlArtifactOutput
      ? '最终 HTML 由客户端转换为 OUTPUT 产物；除此之外，任何要交给下游且 UTF-8 编码超过 1024 字节的文本，都必须写入当前节点工作区的 processFiles/ 文件，并以 INTERMEDIATE artifact 引用传递。'
      : largeTextArtifactRule(),
    'SDK 已启用 JSON Schema 结构化输出。最终回答必须直接产生该结构化结果；不要写 node-result.json，不要输出 Markdown、代码块或额外文本。',
    '结构化结果必须严格采用以下动态模板；替换 payload、artifacts、selectedPort 与 attempt，禁止新增/删减根字段：',
    JSON.stringify(resultTemplate, null, 2),
    'artifacts 不得包含 checksum。',
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

  return [
    '你是客户端工作流的智能取数节点，只完成当前取数任务。',
    `节点：${node?.name ?? node?.title ?? node?.id} (${node?.type})`,
    `任务目标：${spec.task?.goal ?? node?.config?.goal ?? node?.config?.instruction ?? ''}`,
    '只使用以下 WorkflowPacket 输入；不得猜测或引用未提供的数据：',
    JSON.stringify(inputPacket, null, 2),
    `payload 必须符合此 schema：${JSON.stringify(schema, null, 2)}`,
    '输入文件只能通过 artifacts[].resourceId 读取；它是当前节点工作目录下的相对路径。不得使用、输出或臆造绝对路径、file:// 路径、OSS 地址或临时下载链接。',
    largeTextArtifactRule(),
    'SDK 已强制结果 schema。最终只返回符合 WorkflowPacket 的 JSON，不要 Markdown、代码块、解释性文字或 node-result.json。',
  ].filter(Boolean).join('\n\n');
}

function largeTextArtifactRule(): string {
  return '大文本传递规则：任何要交给下游、UTF-8 编码超过 1024 字节的文本，不得内联在 payload。必须写入当前节点工作区的 processFiles/ 文件（JSON 用 .json，其它文本用 .txt），并在 artifacts 中声明 kind=INTERMEDIATE、artifactId、name、contentType 与相对 resourceId；payload 只保留简短摘要和该 artifactId。';
}

function createDataFetchInputPacket(ctx: RunCtx): Record<string, unknown> {
  const rawInput = ctx.resolvedInputs && typeof ctx.resolvedInputs === 'object' && !Array.isArray(ctx.resolvedInputs)
    ? ctx.resolvedInputs as Record<string, unknown>
    : {};
  const { files, localImport, ...payload } = rawInput;
  const fallbackFiles = localImport && typeof localImport === 'object' && !Array.isArray(localImport)
    ? (localImport as Record<string, unknown>).files
    : undefined;
  const sourceFiles = Array.isArray(files) ? files : (Array.isArray(fallbackFiles) ? fallbackFiles : []);

  return {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: 'succeeded',
    producer: { runId: ctx.runId, nodeId: 'runtime-input', nodeType: 'input', attempt: 0 },
    payload,
    artifacts: sourceFiles.flatMap((source, index) => toInputArtifact(source, index)),
    control: { selectedPort: null },
    diagnostics: { warnings: [], errors: [] },
  };
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
