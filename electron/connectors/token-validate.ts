/**
 * Validate a Personal Access Token against serverUrl + validatePath.
 * Shared by api_token kind and managed_cli api_token mode.
 */
import { ConnectorError, ConnectorErrorCode } from './errors';

export function resolveTokenValidatePath(runtime: Record<string, unknown>): string {
  const nested =
    runtime.runtime && typeof runtime.runtime === 'object'
      ? (runtime.runtime as Record<string, unknown>)
      : {};
  const path =
    (typeof runtime.validatePath === 'string' && runtime.validatePath.trim())
    || (typeof nested.validatePath === 'string' && nested.validatePath.trim())
    || '/api/v4/user';
  return path.startsWith('/') ? path : `/${path}`;
}

export function joinServerUrl(base: string, path: string): string {
  const normalized = base.replace(/\/+$/, '');
  return `${normalized}${path}`;
}

export async function validateConnectorToken(options: {
  serverUrl: string;
  token: string;
  validatePath: string;
}): Promise<void> {
  const url = joinServerUrl(options.serverUrl, options.validatePath);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.token}`,
        'PRIVATE-TOKEN': options.token,
      },
    });
  } catch (error) {
    throw new ConnectorError(
      ConnectorErrorCode.AUTH_FAILED,
      `无法连接服务器：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, 'Token 无效或权限不足');
  }
  if (!response.ok) {
    throw new ConnectorError(
      ConnectorErrorCode.AUTH_FAILED,
      `校验失败（HTTP ${response.status}）`,
    );
  }
}
