/**
 * STO policy code-deploy status contract (sai-cli policy code-deploy *).
 * Keep in sync with sto-policy CLI registry docs.
 */

export const CODE_DEPLOY_STATUSES = [
  'CREATED',
  'ITERATING',
  'CHANGING',
  'SYNCING_CODE',
  'INTEGRATING',
  'BUILDING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
] as const;

export type CodeDeployStatus = (typeof CODE_DEPLOY_STATUSES)[number];

export const CODE_DEPLOY_STATUS_LABELS: Record<CodeDeployStatus, string> = {
  CREATED: '已创建部署记录',
  ITERATING: '正在创建 DevOps 迭代',
  CHANGING: '正在创建 DevOps 变更',
  SYNCING_CODE: '正在同步代码分支',
  INTEGRATING: '正在提交集成区',
  BUILDING: '正在执行发布流水线',
  SUCCESS: '部署成功',
  FAILED: '部署失败',
  CANCELLED: '已取消',
};

const TERMINAL: ReadonlySet<string> = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);
const FAILED_LIKE: ReadonlySet<string> = new Set(['FAILED', 'CANCELLED']);

export function normalizeCodeDeployStatus(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

export function isCodeDeployStatus(raw: unknown): raw is CodeDeployStatus {
  const status = normalizeCodeDeployStatus(raw);
  return (CODE_DEPLOY_STATUSES as readonly string[]).includes(status);
}

export function codeDeployStatusLabel(raw: unknown): string {
  const status = normalizeCodeDeployStatus(raw);
  if (isCodeDeployStatus(status)) return CODE_DEPLOY_STATUS_LABELS[status];
  return status || '未知状态';
}

export function isCodeDeployTerminal(raw: unknown): boolean {
  return TERMINAL.has(normalizeCodeDeployStatus(raw));
}

export function isCodeDeploySuccess(raw: unknown): boolean {
  return normalizeCodeDeployStatus(raw) === 'SUCCESS';
}

export function isCodeDeployFailed(raw: unknown): boolean {
  return FAILED_LIKE.has(normalizeCodeDeployStatus(raw));
}

export function isCodeDeployInProgress(raw: unknown): boolean {
  const status = normalizeCodeDeployStatus(raw);
  return Boolean(status) && !TERMINAL.has(status);
}

export interface CodeDeployRecordFields {
  deploymentId?: string;
  applicationId?: string;
  env?: string;
  status?: string;
  failureStage?: string;
  failureMessage?: string;
  resourcePages?: unknown;
  pipelineInstanceId?: string;
  deploymentVersion?: string;
  revisionId?: string;
}

/**
 * sai-cli wraps downstream API payloads as:
 * `{ input, path, result: { body: { success, data: Record|Record[] }, statusCode } }`
 * Accept both the raw record and this envelope.
 */
export function unwrapCodeDeployPayload(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) return data[0] ?? null;
  if (typeof data !== 'object') return data;

  const root = data as Record<string, unknown>;
  if (hasDeployRecordShape(root)) return root;

  const fromResult = unwrapFromCliResult(root.result);
  if (fromResult !== undefined) return fromResult;

  if ('data' in root) return unwrapCodeDeployPayload(root.data);
  if ('body' in root) return unwrapCodeDeployPayload(root.body);
  return data;
}

function hasDeployRecordShape(row: Record<string, unknown>): boolean {
  return (
    row.deploymentId != null
    || row.deployment_id != null
    || row.status != null
    || (row.applicationId != null && row.env != null)
    || (row.application_id != null && row.env != null)
    || (row.app_code != null && row.env != null)
  );
}

function unwrapFromCliResult(result: unknown): unknown | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const body = (result as Record<string, unknown>).body;
  if (body === undefined) return undefined;
  return unwrapCodeDeployPayload(body);
}

function asTrimmedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** Extract `dep_*` deployment id embedded in downstream error text. */
export function extractDeploymentIdFromText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/dep_[a-f0-9]{32}/i);
  return match?.[0];
}

export function formatCodeDeployImmediateFailureMessage(fields: CodeDeployRecordFields): string {
  const label = codeDeployStatusLabel(fields.status);
  const parts: string[] = [];
  if (fields.failureMessage) parts.push(fields.failureMessage);
  if (fields.failureStage) parts.push(`阶段：${fields.failureStage}`);
  if (parts.length > 0) return parts.join(' · ');
  return `发布失败：${label}`;
}

export function pickCodeDeployFields(data: unknown): CodeDeployRecordFields {
  const unwrapped = unwrapCodeDeployPayload(data);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return {};
  const row = unwrapped as Record<string, unknown>;
  return {
    deploymentId: asTrimmedString(row.deploymentId, row.deployment_id),
    applicationId: asTrimmedString(row.applicationId, row.application_id, row.appCode, row.app_code),
    env: asTrimmedString(row.env),
    status: asTrimmedString(row.status),
    failureStage: asTrimmedString(row.failureStage, row.failure_stage),
    failureMessage: asTrimmedString(row.failureMessage, row.failure_message),
    resourcePages: row.resourcePages ?? row.resource_pages,
    pipelineInstanceId: asTrimmedString(row.pipelineInstanceId, row.pipeline_instance_id),
    deploymentVersion: asTrimmedString(row.deploymentVersion, row.deployment_version, row.version),
    revisionId: asTrimmedString(row.revisionId, row.revision_id),
  };
}

/** Prompt seeded into the app-dev chat composer when deploy ends in FAILED/CANCELLED. */
export function formatCodeDeployFailurePrompt(
  fields: CodeDeployRecordFields,
  options?: { fallbackMessage?: string },
): string {
  const status = normalizeCodeDeployStatus(fields.status) || 'FAILED';
  const label = codeDeployStatusLabel(status);
  const failureMessage = fields.failureMessage || options?.fallbackMessage?.trim() || undefined;
  const lines = [
    '应用发布失败，请帮我分析原因并修复后重新发布。',
    '',
    `状态：${status}（${label}）`,
  ];
  if (fields.env) lines.push(`环境：${fields.env}`);
  if (fields.deploymentId) lines.push(`deploymentId：${fields.deploymentId}`);
  if (fields.applicationId) lines.push(`applicationId：${fields.applicationId}`);
  if (fields.pipelineInstanceId) lines.push(`流水线实例：${fields.pipelineInstanceId}`);
  if (fields.failureStage) lines.push(`失败阶段：${fields.failureStage}`);
  if (failureMessage) lines.push(`失败原因：${failureMessage}`);
  lines.push('', '请先定位是代码/构建配置问题还是流水线配置问题，给出可执行的修复建议。');
  return lines.join('\n');
}
