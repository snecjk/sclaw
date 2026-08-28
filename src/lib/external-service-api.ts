import type {
  ExternalServiceDraft,
  ExternalServiceDraftInput,
  ExternalServicePageResult,
  ExternalServiceStatus,
  ExternalServiceVersionConfig,
  ExternalServiceVersionSummary,
} from '../../shared/external-service-contract';
import { hostApiFetch } from './host-api';

const PREFIX = '/ai-memory/agent/v1/external-services';

interface ApiEnvelope<T> {
  success: boolean;
  errCode?: string;
  errMessage?: string;
  traceId?: string;
  data: T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await hostApiFetch<ApiEnvelope<T>>(`${PREFIX}${path}`, init);
  if (!response.success) {
    const details = [response.errCode, response.traceId ? `traceId: ${response.traceId}` : '']
      .filter(Boolean)
      .join(', ');
    throw new Error(`${response.errMessage || '外部服务接口请求失败'}${details ? ` (${details})` : ''}`);
  }
  return response.data;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function pageExternalServices(input: { keyword?: string; pageNum?: number; pageSize?: number } = {}) {
  return request<ExternalServicePageResult>('/page', json({ pageNum: 1, pageSize: 20, ...input }));
}

export function pageExternalServicesAdmin(input: { keyword?: string; pageNum?: number; pageSize?: number } = {}) {
  return request<ExternalServicePageResult>('/admin/page', json({ pageNum: 1, pageSize: 20, ...input }));
}

export function getExternalServiceDraft(serviceId: string) {
  return request<ExternalServiceDraft>(`/${encodeURIComponent(serviceId)}/draft`);
}

export function saveExternalServiceDraft(serviceId: string, draft: ExternalServiceDraftInput) {
  return request<ExternalServiceDraft>(`/${encodeURIComponent(serviceId)}/draft`, {
    ...json(draft),
    method: 'PUT',
  });
}

export function publishExternalService(serviceId: string) {
  return request<ExternalServiceVersionConfig>(`/${encodeURIComponent(serviceId)}/publish`, { method: 'POST' });
}

export function setExternalServiceStatus(serviceId: string, status: ExternalServiceStatus) {
  return request<{ serviceId: string; status: ExternalServiceStatus }>(
    `/${encodeURIComponent(serviceId)}/status`,
    json({ status }),
  );
}

export function listExternalServiceVersions(serviceId: string) {
  return request<ExternalServiceVersionSummary[]>(`/${encodeURIComponent(serviceId)}/versions`);
}
