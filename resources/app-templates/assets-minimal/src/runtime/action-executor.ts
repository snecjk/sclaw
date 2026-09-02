import { request, RequestError } from '@/lib/request';
import { services } from '@/sclaw/services.generated';

export type A2uiMessage = Record<string, unknown>;

export type ActionDefinition = {
  actionId: string;
  title?: string;
  description?: string;
  method?: string;
  /** Prefer relative `/proxy/<key>/...` (dev: Vite proxy; prod: request.ts → absolute target). */
  url?: string;
  /** Registered service alias. Production requests use its environment-specific base URL. */
  service?: string;
  /** Relative path for `service`, such as `/v1/orders`. */
  path?: string;
  mockResponse?: unknown;
};

export type ActionRegistry = {
  version: string;
  actions: ActionDefinition[];
};

export type HostActionPayload = {
  name: string;
  surfaceId?: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
  timestamp?: string;
};

export type ActionResult = {
  actionId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

function pickActionName(raw: unknown): HostActionPayload {
  if (!raw || typeof raw !== 'object') {
    return { name: '' };
  }
  const obj = raw as Record<string, unknown>;
  // MessageProcessor may pass the inner action object or a wrapper.
  const inner =
    obj.action && typeof obj.action === 'object'
      ? (obj.action as Record<string, unknown>)
      : obj;
  return {
    name: typeof inner.name === 'string' ? inner.name : '',
    surfaceId: typeof inner.surfaceId === 'string' ? inner.surfaceId : undefined,
    sourceComponentId:
      typeof inner.sourceComponentId === 'string' ? inner.sourceComponentId : undefined,
    context:
      inner.context && typeof inner.context === 'object'
        ? (inner.context as Record<string, unknown>)
        : {},
    timestamp: typeof inner.timestamp === 'string' ? inner.timestamp : undefined,
  };
}

export async function executeAction(
  registry: ActionRegistry,
  rawAction: unknown,
): Promise<ActionResult> {
  const payload = pickActionName(rawAction);
  const actionId = payload.name.trim();
  if (!actionId) {
    return { actionId: '', ok: false, error: 'action.name 为空' };
  }

  const def = registry.actions.find((item) => item.actionId === actionId);
  if (!def) {
    return {
      actionId,
      ok: false,
      error: `未注册的 actionId: ${actionId}（请写入 contracts/action-registry.v1.json）`,
    };
  }

  if (def.method === 'LOCAL') {
    return { actionId, ok: true, data: { local: true, context: payload.context ?? {} } };
  }

  const url = (def.url ?? '').trim();
  const serviceAlias = (def.service ?? '').trim();
  const servicePath = (def.path ?? '').trim();
  if (serviceAlias || servicePath) {
    if (!serviceAlias || !servicePath) {
      return { actionId, ok: false, error: '注册服务 action 必须同时提供 service 和 path' };
    }
    const service = (services as Record<string, { request: (input: { path: string; method: string; data?: unknown }) => Promise<unknown> }>)[serviceAlias];
    if (!service) return { actionId, ok: false, error: `未绑定的外部服务：${serviceAlias}` };
    try {
      const method = (def.method ?? 'GET').toUpperCase();
      const data = method === 'GET' || method === 'HEAD' ? undefined : (payload.context ?? {});
      return { actionId, ok: true, data: await service.request({
        path: servicePath,
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD',
        data,
      }) };
    } catch (err) {
      return { actionId, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!url) {
    return {
      actionId,
      ok: true,
      data: def.mockResponse ?? { ok: true, actionId, context: payload.context ?? {} },
    };
  }

  try {
    const method = (def.method ?? 'GET').toUpperCase();
    const data =
      method === 'GET' || method === 'HEAD' ? undefined : (payload.context ?? {});
    const result = await request(url, {
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      data,
    });
    return { actionId, ok: true, data: result };
  } catch (err) {
    if (err instanceof RequestError) {
      return {
        actionId,
        ok: false,
        error: err.message || `HTTP ${err.status}`,
        data: err.payload,
      };
    }
    return {
      actionId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
