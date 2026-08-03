export type A2uiMessage = Record<string, unknown>;

export type ActionDefinition = {
  actionId: string;
  title?: string;
  description?: string;
  method?: string;
  url?: string;
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
  if (!url) {
    return {
      actionId,
      ok: true,
      data: def.mockResponse ?? { ok: true, actionId, context: payload.context ?? {} },
    };
  }

  try {
    const method = (def.method ?? 'GET').toUpperCase();
    const init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (method !== 'GET' && method !== 'HEAD') {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(payload.context ?? {});
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    if (!response.ok) {
      return {
        actionId,
        ok: false,
        error: `HTTP ${response.status}`,
        data,
      };
    }
    return { actionId, ok: true, data };
  } catch (err) {
    return {
      actionId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
