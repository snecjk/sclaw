/**
 * prompt-builder — TS 移植自 memory-center/src/services/workflow_agent/executor.py:313 _build_prompt。
 *
 * 客户端化（路径契约）：
 * - cwd/产物路径改客户端真实路径 ${userData}/workflow-runtime/workspaces/{runId}/{nodeId}/
 * - 删 _replace_workspace_paths_for_cloud_agent（executor.py:617）、fileInfos 附件输入、
 *   /runtime/outputs/、/runtime/workspaces 服务端硬编码
 * - 最终产物指示引擎写 cwd + 报 file:/// 路径（ArtifactUploader 读该路径上传）
 *
 * 移植为"行为等价最小版"：镜像 _build_prompt 的 section 结构（turn boundary/role/task/
 * fileHints/schema/delivery/retry-context），因为服务端 _build_* 子函数强耦合运行时上下文，
 * 客户端版由 NodeDispatcher 把上游输出 map 经 ctx.upstreamSummary 注入。
 */
import path from 'node:path';
import { getDataDir } from '../../utils/paths';

export interface PromptCtx {
  runId: string;
  nodeId: string;
  upstreamSummary?: string;
  startupInputs?: Record<string, unknown>;
  retryReason?: string;
}

const PROCESS_FILES_DIR = 'processFiles';

export function buildPrompt(spec: any, ctx: PromptCtx): string {
  const contract = spec?.completionContract ?? {};
  const cwd = toFwdSlashes(workspacePath(ctx.runId, ctx.nodeId));
  const processDir = toFwdSlashes(path.join(workspacePath(ctx.runId, ctx.nodeId), PROCESS_FILES_DIR));
  const schema = contract.outputJsonSchema ?? { type: 'object' };
  const lines: string[] = [];

  lines.push(`[runId=${ctx.runId} nodeId=${ctx.nodeId}] turn reset`);
  lines.push(roleLine(spec?.target?.kind));
  lines.push(taskLine(contract));
  if (ctx.startupInputs && Object.keys(ctx.startupInputs).length) {
    lines.push(`启动参数：${JSON.stringify(ctx.startupInputs)}`);
  }
  if (ctx.upstreamSummary) {
    lines.push(`上游产出（位于 ${processDir} 下，可直接读取）：${ctx.upstreamSummary}`);
  }
  lines.push(`输出 schema：${JSON.stringify(schema)}`);
  lines.push(schemaInstructionsLine(schema));
  lines.push(deliveryLine(cwd));
  if (ctx.retryReason) {
    lines.push(`上次失败原因：${ctx.retryReason}`);
    lines.push('重做前请先检查你是否已产出副作用（写过的文件、调用过的工具），避免重复执行。');
  }
  return lines.join('\n');
}

export function workspacePath(runId: string, nodeId: string): string {
  return path.join(getDataDir(), 'workflow-runtime', 'workspaces', runId, nodeId);
}

/** prompt 文本中的路径用正斜杠（跨平台可读、agent 友好）；文件系统操作仍用 workspacePath 原生路径。 */
function toFwdSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function roleLine(kind: string | undefined): string {
  return `角色：${kind || 'agent_task'} 智能节点`;
}
function taskLine(contract: any): string {
  const task = contract?.task ?? {};
  const goal = task.goal ? `目标：${task.goal}` : '';
  const inst = task.instruction ? `指令：${task.instruction}` : '';
  return [goal, inst].filter(Boolean).join('\n');
}
function schemaInstructionsLine(schema: any): string {
  const required: string[] = schema?.required ?? [];
  return required.length
    ? `必须返回 JSON 对象，包含字段：${required.join(', ')}。仅返回 JSON，不要附加解释。`
    : '必须返回 JSON 对象。仅返回 JSON，不要附加解释。';
}
function deliveryLine(cwd: string): string {
  return [
    `产物持久化：把最终产物写到工作区 ${cwd} 下，`,
    `中间态文件写到 ${path.join(cwd, PROCESS_FILES_DIR)} 下，`,
    `在输出中用 file:/// 路径引用产物文件路径（供后续上传）。`,
  ].join('');
}
