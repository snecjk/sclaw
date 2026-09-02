import { describe, expect, it, vi } from 'vitest';

import {
  createStoPolicyOntologySdk,
  POLICY_HTTP_ACTIONS,
  StoPolicySdkError,
} from '../src';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Policy HTTP client', () => {
  it('freezes exactly the nine Policy actions', () => {
    expect(Object.keys(POLICY_HTTP_ACTIONS).sort()).toEqual([
      'describemetrictree',
      'discover',
      'executefunction',
      'help',
      'queryobjectset',
      'resolvereference',
      'schema',
      'schemagraph',
      'searcharound',
    ]);
    expect(Object.isFrozen(POLICY_HTTP_ACTIONS)).toBe(true);
    expect(Object.isFrozen(POLICY_HTTP_ACTIONS.queryobjectset)).toBe(true);
    expect(() => {
      (POLICY_HTTP_ACTIONS.queryobjectset as { path: string }).path = '/arbitrary';
    }).toThrow(TypeError);
  });

  it('maps a direct queryObjectSet call to the canonical HTTP contract', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      data: { items: [{ siteCode: '100001' }] },
      traceId: 'trace-query',
      warnings: ['warning'],
    }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'secret-token',
      fetch: fetchMock as typeof fetch,
    });

    const result = await sdk.queryObjectSet<{ items: Array<{ siteCode: string }> }>({
      from: 'Site',
      scope: { objectType: 'Site', all: true },
      select: ['siteCode'],
      limit: 20,
    });

    expect(result).toEqual({
      data: { items: [{ siteCode: '100001' }] },
      traceId: 'trace-query',
      warnings: ['warning'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://zc-hybrid-test.sto.cn/sto-policy/api/v1/cli/ontology/query-object-set',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ from: 'Site', limit: 20 });
    const headers = new Headers(init?.headers);
    expect(headers.get('stoToken')).toBe('secret-token');
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('uses the stable action name behind a same-origin proxy', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: { items: [] }, warnings: [] }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'same-origin-proxy', prefix: '/__sto/policy/' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await sdk.discover({ question: '查询网点' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/__sto/policy/discover');
  });

  it('calls schemaGraph with GET and no body, and normalizes success/data envelope', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { nodes: [1] } }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.schemaGraph()).resolves.toEqual({
      data: { nodes: [1] },
      traceId: undefined,
      warnings: [],
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', body: undefined });
  });

  it('normalizes the public CLI envelope that exposes result at the top level', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      schemaVersion: '3.0',
      traceId: 'trace-function',
      capabilityVersion: 'ontology-v2:test',
      functionRef: 'findCrossSiteShops@1.0',
      result: { body: { result: { rows: [['shop-1']] } } },
      warnings: [],
    }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.executeFunction({
      functionRef: 'findCrossSiteShops@1.0',
      arguments: {},
    })).resolves.toEqual({
      data: {
        schemaVersion: '3.0',
        capabilityVersion: 'ontology-v2:test',
        functionRef: 'findCrossSiteShops@1.0',
        result: { body: { result: { rows: [['shop-1']] } } },
      },
      traceId: 'trace-function',
      warnings: [],
    });
  });

  it('rejects an unknown action before fetching', async () => {
    const fetchMock = vi.fn();
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      sdk.invoke('curl' as never, {} as never),
    ).rejects.toMatchObject({ code: 'POLICY_ACTION_DENIED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid action parameters and missing credentials before fetching', async () => {
    const fetchMock = vi.fn();
    const withToken = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });
    await expect(withToken.discover({ question: '' })).rejects.toMatchObject({
      code: 'POLICY_PARAMETERS_INVALID',
    });

    const withoutToken = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => null,
      fetch: fetchMock as typeof fetch,
    });
    await expect(withoutToken.help({})).rejects.toMatchObject({
      code: 'POLICY_UNAUTHORIZED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'POLICY_UNAUTHORIZED'],
    [403, 'POLICY_FORBIDDEN'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: false,
      errorCode: 'AUTH_FAILED',
      errorMsg: 'Access denied',
      traceId: 'trace-auth',
    }, status));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.help({})).rejects.toMatchObject({
      code,
      status,
      upstreamCode: 'AUTH_FAILED',
      traceId: 'trace-auth',
    });
  });

  it('maps a business authentication failure returned with HTTP 200', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: false,
      errorCode: '9000',
      errorMsg: 'Token expired',
      traceId: 'trace-expired',
    }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.help({})).rejects.toMatchObject({
      code: 'POLICY_UNAUTHORIZED',
      upstreamCode: '9000',
    });
  });

  it('preserves canonical upstream diagnostics without leaking the token', async () => {
    const token = 'sensitive-token';
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: false,
      traceId: 'trace-provider',
      error: {
        code: 'PROVIDER_FAILED',
        message: `provider rejected ${token}`,
        retryable: true,
        detail: { authorization: `Bearer ${token}` },
      },
    }, 502));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => token,
      fetch: fetchMock as typeof fetch,
    });

    let caught: unknown;
    try {
      await sdk.help({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StoPolicySdkError);
    expect(JSON.stringify(caught)).not.toContain(token);
    expect(caught).toMatchObject({
      code: 'POLICY_UPSTREAM_FAILED',
      upstreamCode: 'PROVIDER_FAILED',
      retryable: true,
    });
  });

  it('times out a stalled request', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      timeoutMs: 5,
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.help({})).rejects.toMatchObject({ code: 'POLICY_TIMEOUT' });
  });

  it('honors a signal that was already aborted', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });
    const controller = new AbortController();
    controller.abort();
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.help({}, { signal: controller.signal })).rejects.toMatchObject({
      code: 'POLICY_ABORTED',
    });
  });
});
