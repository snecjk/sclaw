import type { AgentRunSpec, RunCtx } from './types';
import { WORKFLOW_PACKET_VERSION } from './workflow-packet';

/** Builds the client-owned prompt. Cloud compiled prompts are deliberately ignored. */
export function buildWorkflowNodePrompt(spec: AgentRunSpec, node: any, ctx: RunCtx): string {
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
    'SDK 已启用 JSON Schema 结构化输出。最终回答必须直接产生该结构化结果；不要写 node-result.json，不要输出 Markdown、代码块或额外文本。',
    '结构化结果必须严格采用以下动态模板；替换 payload、artifacts、selectedPort 与 attempt，禁止新增/删减根字段：',
    JSON.stringify(resultTemplate, null, 2),
    'artifacts 不得包含 checksum。',
  ].filter(Boolean).join('\n\n');
}
