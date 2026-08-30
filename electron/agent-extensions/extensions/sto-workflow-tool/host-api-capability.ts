import { PORTS } from '../../../utils/config';
import type { StoWorkflowPort } from './capability';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T | null;
  error?: unknown;
  errCode?: string;
  errMessage?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => undefined) as ApiEnvelope<T> | undefined;
  if (!response.ok || !payload?.success || payload.data == null) {
    const errorMessage = payload?.error instanceof Error
      ? payload.error.message
      : payload?.error == null ? undefined : String(payload.error);
    const message = payload?.errMessage
      || errorMessage
      || payload?.errCode
      || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload.data;
}

export function createHostApiWorkflowPort(): StoWorkflowPort {
  return {
    async isAvailable() {
      const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}/api/auth/status`);
      if (!response.ok) return false;
      const payload = await response.json().catch(() => undefined) as { isAuthenticated?: unknown } | undefined;
      return payload?.isAuthenticated === true;
    },
    searchTemplates: (query, limit) => requestJson('/agent/v1/workflow-templates', {
      method: 'POST',
      body: JSON.stringify({ query, page: 1, pageSize: limit }),
    }),
    getStartupSchema: (templateId) => requestJson(
      `/agent/v1/workflow-templates/${encodeURIComponent(templateId)}/startup-schema`,
    ),
    createWorkflow: ({ templateId, displayName, schemaHash, values, idempotencyKey }) => requestJson(
      '/agent/v1/workflows',
      {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          displayName,
          startup: { schemaHash, values },
          idempotencyKey,
        }),
      },
    ),
    startWorkflow: ({ workflowId, inputs, idempotencyKey, sessionKey, templateName, engineType }) => requestJson(
      `/agent/v1/workflows/${encodeURIComponent(workflowId)}/start`,
      {
        method: 'POST',
        body: JSON.stringify({
          inputs,
          idempotencyKey,
          sessionKey,
          chatCardTitle: templateName,
          chatParamsSummary: Object.keys(inputs).length ? JSON.stringify(inputs) : undefined,
          engineType,
        }),
      },
    ),
    getRun: (runId) => requestJson(`/agent/v1/runs/${encodeURIComponent(runId)}`),
  };
}
