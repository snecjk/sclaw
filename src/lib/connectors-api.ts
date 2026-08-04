import { hostApiFetch } from '@/lib/host-api';
import type { ConnectorViewItem } from '../../shared/connectors/types';

interface ApiEnvelope<T> {
  success: boolean;
  errCode?: string;
  errMessage?: string;
  data: T;
}

function unwrap<T>(response: ApiEnvelope<T>, fallback: string): T {
  if (!response.success || response.data == null) {
    throw new Error(response.errMessage || fallback);
  }
  return response.data;
}

export async function fetchConnectors(refresh = true): Promise<ConnectorViewItem[]> {
  const query = refresh ? '' : '?refresh=0';
  const response = await hostApiFetch<ApiEnvelope<ConnectorViewItem[]>>(
    `/api/connectors${query}`,
  );
  return unwrap(response, '连接器列表加载失败');
}

export async function connectConnector(id: string): Promise<ConnectorViewItem> {
  const response = await hostApiFetch<ApiEnvelope<ConnectorViewItem>>(
    `/api/connectors/${encodeURIComponent(id)}/connect`,
    { method: 'POST' },
  );
  return unwrap(response, '连接失败');
}

export async function disconnectConnector(id: string): Promise<ConnectorViewItem> {
  const response = await hostApiFetch<ApiEnvelope<ConnectorViewItem>>(
    `/api/connectors/${encodeURIComponent(id)}/disconnect`,
    { method: 'POST' },
  );
  return unwrap(response, '断开失败');
}

export async function tokenConnectConnector(
  id: string,
  serverUrl: string,
  token: string,
): Promise<ConnectorViewItem> {
  const response = await hostApiFetch<ApiEnvelope<ConnectorViewItem>>(
    `/api/connectors/${encodeURIComponent(id)}/token-connect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, token }),
    },
  );
  return unwrap(response, '连接失败');
}

export async function refreshConnectorStatus(id: string): Promise<ConnectorViewItem> {
  const response = await hostApiFetch<ApiEnvelope<ConnectorViewItem>>(
    `/api/connectors/${encodeURIComponent(id)}/status`,
  );
  return unwrap(response, '状态刷新失败');
}
