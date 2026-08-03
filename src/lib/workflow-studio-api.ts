/**
 * Workflow Studio API — aligned with memory-center-web `/workflow/v1/*`
 * Used by create modal on `/workflow` (deep link: `/workflow/new`, MC: `/workflows-workbench/new`).
 */
import { hostApiFetch } from '@/lib/host-api';
import { getWorkflowStoToken } from '@/lib/workflow-api';
import type { WorkflowDefinition } from '@/pages/WorkflowDesigner/types';

export interface WorkflowStudioTemplate {
  id: string;
  label: string;
  description?: string;
  category?: string | null;
  nodeCount?: number;
  scope?: string;
  nodes?: Array<{ id: string; type: string; name: string }>;
  edges?: WorkflowDefinition['edges'];
}

export interface WorkflowStudioTemplateDetail extends WorkflowStudioTemplate {
  workflowDefinition: WorkflowDefinition;
}

export interface WorkflowHistoryVersion {
  id: string;
  version: number;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  isCurrent?: boolean;
  summary?: string | null;
}

export interface WorkflowHistoryVersionDetail extends WorkflowHistoryVersion {
  workflow: WorkflowDefinition;
}

export interface CreateWorkflowStudioRequest {
  templateId: string;
  name: string;
  description?: string;
  category?: string;
  nodes: WorkflowDefinition['nodes'];
  edges: WorkflowDefinition['edges'];
}

function studioHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Source-Client': 'stoclaw',
  };
  const token = getWorkflowStoToken();
  if (token) headers.stoToken = token;
  return headers;
}

function parseStudioJson<T>(json: unknown): T {
  if (json && typeof json === 'object' && 'success' in json) {
    const wrapped = json as { success?: boolean; data?: T; errMessage?: string; message?: string };
    if (wrapped.success === false) {
      throw new Error(wrapped.errMessage || wrapped.message || 'Workflow Studio API error');
    }
    if (wrapped.data !== undefined) return wrapped.data as T;
  }
  return json as T;
}

/** GET /workflow/v1/workflow-templates — MC CreateWorkflowPage.loadTemplates */
export async function listWorkflowStudioTemplates(): Promise<WorkflowStudioTemplate[]> {
  const json = await hostApiFetch<unknown>('/workflow/v1/workflow-templates', {
    headers: studioHeaders(),
  });
  const data = parseStudioJson<WorkflowStudioTemplate[] | { items?: WorkflowStudioTemplate[] }>(json);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items;
  return [];
}

/** POST /workflow/v1/workflows — MC CreateWorkflowPage.handleCreate */
export async function createWorkflowStudio(
  body: CreateWorkflowStudioRequest,
): Promise<WorkflowDefinition> {
  const json = await hostApiFetch<unknown>('/workflow/v1/workflows', {
    method: 'POST',
    headers: studioHeaders(),
    body: JSON.stringify(body),
  });
  return parseStudioJson<WorkflowDefinition>(json);
}

/** POST /workflow/v1/ai-builder/prompt-cache — 缓存大 prompt 换短 promptCacheId，避免走 URL 超限 */
export async function cacheAiWorkflowPrompt(
  prompt: string,
  workflowId?: string,
): Promise<string> {
  const json = await hostApiFetch<unknown>('/workflow/v1/ai-builder/prompt-cache', {
    method: 'POST',
    headers: studioHeaders(),
    body: JSON.stringify({ prompt, workflowId }),
  });
  const data = parseStudioJson<{ promptCacheId: string } | undefined>(json);
  if (!data?.promptCacheId) {
    throw new Error('缓存 AI 创建 prompt 失败');
  }
  return data.promptCacheId;
}

/** GET /workflow/v1/workflow-templates/{id} — MC fetchWorkflowTemplate */
export async function getWorkflowStudioTemplate(
  templateId: string,
): Promise<WorkflowStudioTemplateDetail> {
  const json = await hostApiFetch<unknown>(
    `/workflow/v1/workflow-templates/${encodeURIComponent(templateId)}`,
    { headers: studioHeaders() },
  );
  return parseStudioJson<WorkflowStudioTemplateDetail>(json);
}

/** GET /workflow/v1/workflows/{workflowId}/versions — MC HistoryVersionsDrawer */
export async function listWorkflowHistoryVersions(
  workflowId: string,
): Promise<WorkflowHistoryVersion[]> {
  const json = await hostApiFetch<unknown>(
    `/workflow/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
    { headers: studioHeaders() },
  );
  const data = parseStudioJson<WorkflowHistoryVersion[] | { items?: WorkflowHistoryVersion[] }>(json);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items;
  return [];
}

/** GET /workflow/v1/workflows/{workflowId}/versions/{versionId} */
export async function getWorkflowHistoryVersionDetail(
  workflowId: string,
  versionId: string,
): Promise<WorkflowHistoryVersionDetail> {
  const json = await hostApiFetch<unknown>(
    `/workflow/v1/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`,
    { headers: studioHeaders() },
  );
  return parseStudioJson<WorkflowHistoryVersionDetail>(json);
}

/** POST /workflow/v1/workflows/{workflowId}/versions/{versionId}/restore */
export async function restoreWorkflowHistoryVersion(
  workflowId: string,
  versionId: string,
): Promise<WorkflowDefinition> {
  const json = await hostApiFetch<unknown>(
    `/workflow/v1/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/restore`,
    {
      method: 'POST',
      headers: studioHeaders(),
      body: '{}',
    },
  );
  return parseStudioJson<WorkflowDefinition>(json);
}
