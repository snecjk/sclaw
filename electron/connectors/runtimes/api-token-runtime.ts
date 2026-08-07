/**
 * api_token runtime — Personal Access Token connect flow.
 * Validates token against runtime.validatePath, then stores credentials locally.
 */
import {
  deleteConnectorCredential,
  getConnectorCredential,
  maskToken,
  setConnectorCredential,
} from '../credential-store';
import { ConnectorError, ConnectorErrorCode } from '../errors';
import {
  resolveTokenValidatePath,
  validateConnectorToken,
} from '../token-validate';
import type {
  KindRuntime,
  KindRuntimeConnectContext,
  KindRuntimeConnectResult,
  KindRuntimeStatusResult,
} from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class ApiTokenRuntime implements KindRuntime {
  readonly kind = 'api_token';

  async connect(ctx: KindRuntimeConnectContext): Promise<KindRuntimeConnectResult> {
    const credentials = ctx.credentials;
    if (!credentials?.serverUrl?.trim() || !credentials?.token?.trim()) {
      throw new ConnectorError(
        ConnectorErrorCode.AUTH_FAILED,
        '请填写服务器地址和 Personal Access Token',
      );
    }

    const serverUrl = credentials.serverUrl.trim().replace(/\/+$/, '');
    const token = credentials.token.trim();
    const runtime = asRecord(ctx.descriptor.runtime);
    const validatePath = resolveTokenValidatePath(runtime);

    try {
      ctx.onProgress?.('authorizing', '正在校验 Token…');
      await validateConnectorToken({ serverUrl, token, validatePath });
      setConnectorCredential(ctx.descriptor.id, serverUrl, token);
      return { status: 'connected' };
    } catch (error) {
      if (error instanceof ConnectorError) {
        return { status: 'error', error: error.message };
      }
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(ctx: KindRuntimeConnectContext): Promise<KindRuntimeStatusResult> {
    deleteConnectorCredential(ctx.descriptor.id);
    return { status: 'available', authenticated: false };
  }

  async probe(ctx: KindRuntimeConnectContext): Promise<KindRuntimeStatusResult> {
    const saved = getConnectorCredential(ctx.descriptor.id);
    if (!saved?.token || !saved.serverUrl) {
      return { status: 'available', authenticated: false };
    }

    const runtime = asRecord(ctx.descriptor.runtime);
    const validatePath = resolveTokenValidatePath(runtime);
    try {
      await validateConnectorToken({
        serverUrl: saved.serverUrl,
        token: saved.token,
        validatePath,
      });
      return { status: 'connected', authenticated: true };
    } catch (error) {
      return {
        status: 'error',
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const apiTokenRuntime = new ApiTokenRuntime();

export { maskToken };
