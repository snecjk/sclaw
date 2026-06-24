/**
 * Dictionary API — aligned with memory-center-web `dictionaryApi.ts`
 * Base: `/api/v1/dictionaries/*` on AI Memory Center backend.
 */
import { hostApiFetch } from '@/lib/host-api';
import { getWorkflowStoToken } from '@/lib/workflow-api';

export interface DictionaryItemOption {
  name: string;
  value: string;
  description?: string;
}

interface DictionaryApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errMessage?: string;
}

function dictionaryHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Source-Client': 'stoclaw',
  };
  const token = getWorkflowStoToken();
  if (token) headers.stoToken = token;
  return headers;
}

/** GET /api/v1/dictionaries/types/{typeCode}/items?tenantId=0 */
export async function fetchDictionaryItemsByTypeCode(
  typeCode: string,
  tenantId = 0,
): Promise<DictionaryItemOption[]> {
  const path = `/api/v1/dictionaries/types/${encodeURIComponent(typeCode)}/items?tenantId=${tenantId}`;
  const json = await hostApiFetch<DictionaryApiResponse<DictionaryItemOption[]>>(path, {
    headers: dictionaryHeaders(),
  });

  if (json && typeof json === 'object' && 'success' in json) {
    if (!json.success) {
      throw new Error(json.errMessage || json.message || '查询字典项列表失败');
    }
    return Array.isArray(json.data) ? json.data : [];
  }

  return Array.isArray(json) ? json : [];
}
