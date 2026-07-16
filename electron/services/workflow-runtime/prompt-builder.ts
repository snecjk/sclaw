/**
 * Client-local port of memory-center workflow_agent/executor.py prompt rendering.
 * Business wording and output protocol intentionally mirror the cloud executor;
 * only file paths point at the local workflow workspace.
 */
import path from 'node:path';
import { getDataDir } from '../../utils/paths';
import type { AgentRunSpec } from './types';

export interface PromptCtx { runId: string; nodeId: string; retryReason?: string; }
const PROCESS_FILES_DIR = 'processFiles';
const HIDDEN_KEYS = new Set(['ossKey', 'tempUrl', 'previewUrl', 'url', 'stoToken', 'authorization']);

export function buildPrompt(spec: AgentRunSpec, ctx: PromptCtx): string {
  const contract = spec.completionContract ?? { outputJsonSchema: { type: 'object' } };
  const smartKind = spec.runtimeContext?.smartNode?.kind;
  const nodeWorkspace = workspacePath(ctx.runId, ctx.nodeId);
  const localPaths = { cwd: toFwdSlashes(runWorkspacePath(ctx.runId)), processDir: toFwdSlashes(path.join(nodeWorkspace, PROCESS_FILES_DIR)) };
  if (contract.resultKind === 'structured_data_extract_result' || smartKind === 'agent_data_fetch') {
    return joinLines(buildFetchPrompt(spec, localPaths));
  }

  const isFirst = spec.runtimeContext?.isFirstAgentNode !== false;
  const startup = spec.runtimeContext?.startup ?? { schema: {}, resolvedInputs: {} };
  const safeInputs = sanitizePromptValue(spec.inputs ?? {});
  const startupInputs = isFirst ? sanitizePromptValue(startup.resolvedInputs ?? {}) : {};
  const startupHints = isFirst ? buildStartupParameterHints(startup.schema ?? {}, startupInputs) : [];
  const schema = contract.outputJsonSchema ?? { type: 'object' };
  const isCondition = contract.resultKind === 'agent_condition_route_result' || smartKind === 'agent_condition';
  const lines: Array<string | undefined> = [
    ...nodeTurnBoundary(spec), '',
    '# 系统角色', '你是业务 workflow 中的受控 agent 节点。你只能完成当前节点目标。', '',
    '# 任务信息', `节点名称：${spec.task.name}`, `节点目标：${spec.task.goal}`,
    ...(spec.task.instruction ? ['节点补充要求：', spec.task.instruction] : []),
    `输入数据：${safeJson(safeInputs)}`, '',
    ...inputFileHints(safeInputs),
    ...(specializedInstructions(smartKind, contract.resultKind, localPaths.processDir).length ? ['# 节点专用要求', ...specializedInstructions(smartKind, contract.resultKind, localPaths.processDir), ''] : []),
    ...(Object.keys(startupInputs).length ? ['启动确认参数：', safeJson(startupInputs), ''] : []),
    ...(startupHints.length ? ['启动参数说明：', ...startupHints, ''] : []),
    '# 输出字段约束', schemaToPrompt(schema), '',
    '# 输出格式（极其重要）', ...(isCondition ? conditionResultInstructions() : contentModeInstructions(contract.contentMode ?? 'structured_json')), '',
    ...(!isCondition ? ['# 交付规则（极其重要）', ...deliveryInstructions(contract.contentMode ?? 'structured_json', contract.resultKind ?? '', localPaths.cwd), ''] : []),
    `输出示例：${safeJson(contract.responseExample ?? generateExample(schema))}`,
    ...(ctx.retryReason ? ['', `上次失败原因：${ctx.retryReason}`, '重做前请先检查你是否已产出副作用（写过的文件、调用过的工具），避免重复执行。'] : []),
  ];
  return joinLines(lines);
}

function buildFetchPrompt(spec: AgentRunSpec, paths: { cwd: string; processDir: string }): string[] {
  const contract = spec.completionContract;
  const inputs = sanitizePromptValue(spec.inputs ?? {}) as Record<string, unknown>;
  return [
    ...nodeTurnBoundary(spec), '', '# 系统角色', '你是 workflow 中的“智能取数”节点。', '你的职责是读取用户上传的文件资料，并使用系统固定提示词完成结构化取数。', '你只能输出当前节点的最终结果，不能输出额外解释。', '',
    '# 节点职责', '这是智能取数节点，不是普通总结节点。', '输入会包含文件清单元数据；文件附件访问能力由本地运行时单独提供。', '你的任务是基于文件内容提取机器可读的结构化数据，并将结果输出为结构化 JSON，供下游节点继续消费。', '',
    '# 本次任务', `节点名称：${spec.task.name}`, `处理目标：${spec.task.goal}`, ...(spec.task.instruction ? ['节点补充要求：', spec.task.instruction] : []), '',
    '# 文件输入', `输入数据如下：${safeJson(structuredFileSummary(inputs))}`, '补充说明：', '- 请结合本地工作区提供的附件访问能力和文件清单元数据自行读取并理解文件内容。', '- 如果是表格数据，请基于实际文件内容抽取记录，不要依赖预解析结果。', '- 不得臆造文件中不存在的信息。', '',
    '# 处理要求', '请严格遵守以下原则：', '- 按系统固定取数协议处理，不要自行改写任务类型。', '- 结果必须可供下游节点继续处理。', '- 最终输出必须是结构化 JSON，主结果放在 data 字段。', '- data 可以是对象或数组，但不能退化成自然语言正文。', '- 结果应尽量保留 fileId、fileName、sourceFile、sheetName、section 等来源信息。', '- 缺失字段可返回 null、空字符串，或在结构化结果中明确说明缺失。', ...processFileContract(paths.processDir, 'data'), '- 不要输出自然语言报告。', '- 不要输出 Markdown 代码块。', '- 不要输出额外前言、说明、分析过程。', '',
    '# 输出约束', schemaToPrompt(contract.outputJsonSchema ?? { type: 'object' }), '', `输出示例：${safeJson(contract.responseExample ?? generateExample(contract.outputJsonSchema ?? {}))}`, '', '# 返回要求', '不要输出前言，不要输出 Markdown 代码块，直接输出最终 JSON。',
  ];
}

function nodeTurnBoundary(spec: AgentRunSpec): string[] {
  return ['# 当前节点回合', `workflowRunId：${spec.runId}`, `nodeId：${spec.nodeId}`, '本消息开始一个新的工作流节点回合；此前节点的角色、任务目标和输出格式要求均已失效。', '此前会话中的已确认事实和文件仍可复用，但只能执行本消息定义的当前节点任务。', '如果历史会话与当前输入冲突，以当前节点输入、当前节点要求和当前输出 Schema 为准。'];
}

function specializedInstructions(kind: string | undefined, resultKind: string | undefined, processDir: string): string[] {
  if (resultKind === 'structured_data_extract_result') return [];
  if (kind === 'agent_data_process') return ['这是智能加工节点，不是普通总结节点。', '你要基于当前输入和上游中间态文件完成清洗、整理、汇总或加工，并输出可被下游继续消费的结构化 JSON。', `如果输入包含上游 processFiles，请主动读取 ${processDir} 或其中引用的中间态文件内容，不要只依赖输入摘要。`, ...processFileContract(processDir), '禁止把最终结果写成裸文本、Markdown 或额外包裹的 result/payload；必须直接返回符合 Schema 的 JSON。'];
  if (kind === 'agent_condition') return ['这是智能判断节点，你必须基于输入数据完成路由判断。', '如果输入包含上游 processFiles，请主动读取对应中间态文件内容，不要只依赖输入摘要。', '如果输入包含 artifacts[] 中的 filePath 文件，请主动读取这些文件内容，不要只依赖 input.data 或 summary 摘要。', '读取优先级：processFiles[] 文件内容 > artifacts[] 文件内容 > input.data 结构化摘要 > summary 展示文本。', 'data.branch_key 必须只返回一个值，并且必须命中预先声明的 branch_key；不要输出其他分支字段名、fallback 字面量或未声明分支。', '如果都不满足，data.branch_key 返回兜底分支对应的真实 branch_key。', '路由结果必须直接放在 data 中；processFiles 固定返回空数组，不要为路由结果生成文件。', '禁止把最终结果写成裸文本、Markdown 或额外包裹的 result/payload；必须直接返回符合 Schema 的 JSON。'];
  return [];
}

function processFileContract(processDir: string, primary = 'data'): string[] {
  return [`最终 JSON 必须包含 processFiles 字段；如果本节点没有生成中间态文件，返回 processFiles: []。`, `2KB 以内优先直接放在 ${primary}；超过 2KB 的结构化结果必须改为通过 processFiles 输出中间态文件引用。`, `当使用中间态文件时，${primary} 必须返回 mode="process_file"、filePath、name、fileType；processFiles[] 必须返回 filePath、name、size、fileType。`, `中间态文件路径必须位于 ${processDir} 下；下游节点会依赖这些路径继续读取文件。`];
}

function conditionResultInstructions(): string[] { return ['最终结果必须符合给定的 JSON Schema。', '输出必须包含统一结果包装字段：kind、status、data。', 'data 只承载本次路由判断结果；summary 仅可用于简短展示。', '不要创建文件、页面或其他产物，不要调用与路由判断无关的写入操作。']; }
function contentModeInstructions(mode: string): string[] {
  const common = ['最终结果必须符合给定的 JSON Schema。', '输出必须包含统一结果包装字段：kind、status、data。'];
  if (mode === 'document_markdown') return [...common, '这是 Markdown 文档场景：请把完整 Markdown 正文放进 data.content。', '不要把正文拆成大量 JSON 字段，也不要把最终输出写成裸 Markdown；最终仍然必须是 JSON 包裹。', 'data.format 必须是 markdown，data.title 可选。'];
  if (mode === 'document_html') return [...common, '这是 HTML 页面场景：请把完整 HTML 正文放进 data.content。', '不要把正文拆成大量 JSON 字段，也不要把最终输出写成裸 HTML；最终仍然必须是 JSON 包裹。', 'data.format 必须是 html，data.title 可选。', '除 data.content 外，不要在 summary、解释文本或 JSON 外层重复输出整段 HTML。'];
  if (mode === 'plain_text') return [...common, '这是纯文本场景：请把完整文本正文放进 data.content。', '不要输出裸文本；最终仍然必须是 JSON 包裹。'];
  return [...common, '其中 data 是真正给下游节点消费的业务结果；summary 仅用于面向人的展示，可选。'];
}
function deliveryInstructions(mode: string, resultKind: string, cwd: string): string[] {
  const lines = ['data 是主产物，必须承载真正给下游节点消费的完整结果；不要因为用户只关心某个回执字段，就把主产物塞进 summary。', 'summary 仅用于面向人的展示；如果产生了文件、链接、页面、记录等交付物，统一放进 artifacts[]。', `凡是最终需要输出文件类产物的任务，必须把文件保存到 ${cwd} 目录下；不要把最终交付文件散落到其他目录。`, `只有在 Write 等写入工具实际成功且文件仍存在时，才可以在 artifacts[].filePath 填写 ${cwd} 下的路径并说明“已保存”；未写入成功时不得虚构路径、产物或保存状态。`];
  if (resultKind === 'generic_data_result') lines.push('通用数据结果场景下，data 只保留业务结果；filePath、url、uri、tempUrl、name、contentType 等字段统一写入 artifacts[]，不要继续放在 data 中充当下游协议字段。');
  if (mode === 'document_html') lines.push('HTML 正文只放在 data.content；如果文件已保存到本地工作区，artifacts[].filePath 应优先给出最终文件路径，summary.text 只做简短说明。');
  if (mode === 'document_markdown') lines.push('Markdown 正文只放在 data.content；如果文档已保存或已发布，artifacts 中优先给出保存路径或发布地址。');
  if (mode === 'plain_text') lines.push('文本正文只放在 data.content；如果文本已写入目标位置，artifacts 中优先给出目标路径或目标标识。');
  return lines;
}

function sanitizePromptValue(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizePromptValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !HIDDEN_KEYS.has(key)).map(([key, nested]) => [key, sanitizePromptValue(nested)]));
  return value;
}
function buildStartupParameterHints(schema: Record<string, any>, inputs: Record<string, any>): string[] {
  return (Array.isArray(schema.fields) ? schema.fields : []).flatMap((field) => {
    const key = String(field?.key ?? '').trim(); if (!key) return [];
    const parts = [`- ${String(field.label ?? key)}（key: ${key}）`];
    if (field.groupTitle ?? field.group) parts.push(`步骤：${field.groupTitle ?? field.group}`);
    if (field.description) parts.push(`说明：${field.description}`);
    const value = readNested(inputs, key); if (value !== undefined) parts.push(`当前值：${safeJson(value)}`);
    return [parts.join('；')];
  });
}
function inputFileHints(inputs: any): string[] { return hasFileReference(inputs) ? ['# 输入文件说明', '输入数据中包含本地文件 artifact。', '如需读取文件内容，请使用输入中的 filePath 或 file:/// URI。对于 Excel 文件，请解析其中的 sheet 数据后再处理。', ''] : []; }
function hasFileReference(value: any): boolean { if (Array.isArray(value)) return value.some(hasFileReference); if (value && typeof value === 'object') return Boolean(value.filePath || value.uri) || Object.values(value).some(hasFileReference); return false; }
function structuredFileSummary(inputs: Record<string, unknown>) { const files = (inputs.localImport as any)?.files; const list = Array.isArray(files) ? files.flatMap((file) => file && typeof file === 'object' ? [{ ...(file.fileId ? { fileId: file.fileId } : {}), ...(file.name || file.fileName ? { name: file.name ?? file.fileName } : {}) }] : []) : []; return { count: list.length, files: list }; }
function schemaToPrompt(schema: any): string {
  const lines: string[] = [];
  describeSchemaFields(schema, lines, '');
  return lines.join('\n') || '返回 JSON 对象。';
}

function describeSchemaFields(schema: any, lines: string[], prefix: string): void {
  if (!schema || typeof schema !== 'object') return;
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const field = child as Record<string, any>;
    const path = prefix ? `${prefix}.${key}` : key;
    const type = field.type ?? (field.properties ? 'object' : field.items ? 'array' : 'unknown');
    const description = field.description ? `（${field.description}）` : '';
    lines.push(`${path}:${type}${required.has(key) ? ' 必填' : ''}${description}`);
    if (field.properties) describeSchemaFields(field, lines, path);
    if (field.items?.properties) describeSchemaFields(field.items, lines, `${path}[]`);
  }
}
function generateExample(schema: any): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  return Object.fromEntries(Object.entries(properties).map(([key, value]: [string, any]) => {
    const fallback = value.type === 'object' ? {} : value.type === 'array' ? [] : value.type === 'number' ? 0 : '示例值';
    return [key, value.example ?? value.enum?.[0] ?? fallback];
  }));
}
function readNested(value: any, dotted: string): any { return dotted.split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, value); }
function safeJson(value: unknown): string { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function joinLines(lines: Array<string | undefined>): string { return lines.filter((line): line is string => line !== undefined).join('\n'); }
export function workspacePath(runId: string, nodeId: string): string { return path.join(getDataDir(), 'workflow-runtime', 'workspaces', runId, nodeId); }
/** A workflow node may read/write inside this run-scoped sandbox, never arbitrary user directories. */
export function runWorkspacePath(runId: string): string { return path.join(getDataDir(), 'workflow-runtime', 'workspaces', runId); }
function toFwdSlashes(value: string): string { return value.replace(/\\/g, '/'); }
