import { describe, expect, it, vi } from 'vitest';

import {
  createStoPolicyOntologySdk,
  definePolicyOperation,
  StoPolicySdkError,
  type PolicyOperation,
} from '../src';

function operation(overrides: Partial<PolicyOperation<'queryobjectset'>> = {}) {
  return definePolicyOperation({
    operationId: 'site.list',
    action: 'queryobjectset',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['limit'],
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    buildBody(parameters) {
      return {
        from: 'Site',
        scope: { objectType: 'Site', all: true },
        select: ['siteCode'],
        limit: Number(parameters.limit),
      };
    },
    ...overrides,
  });
}

describe('Policy operation engine', () => {
  it('validates parameters, builds a fixed request, and executes by operationId', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, data: { items: [] }, warnings: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation()],
      fetch: fetchMock as typeof fetch,
    });

    await sdk.execute('site.list', { limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      from: 'Site',
      limit: 10,
    });
  });

  it('rejects missing, unknown, and out-of-range parameters before fetching', async () => {
    const fetchMock = vi.fn();
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation()],
      fetch: fetchMock as typeof fetch,
    });

    await expect(sdk.execute('site.list', {})).rejects.toMatchObject({
      code: 'POLICY_PARAMETERS_INVALID',
    });
    await expect(sdk.execute('site.list', { limit: 101 })).rejects.toMatchObject({
      code: 'POLICY_PARAMETERS_INVALID',
    });
    await expect(sdk.execute('site.list', { limit: 10, injected: true })).rejects.toMatchObject({
      code: 'POLICY_PARAMETERS_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing and duplicate operations at initialization/runtime', async () => {
    expect(() => createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation(), operation()],
      fetch: vi.fn() as typeof fetch,
    })).toThrowError(expect.objectContaining({ code: 'POLICY_OPERATION_DUPLICATE' }));

    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      fetch: vi.fn() as typeof fetch,
    });
    await expect(sdk.execute('missing.operation')).rejects.toMatchObject({
      code: 'POLICY_OPERATION_NOT_FOUND',
    });
  });

  it('requires a closed object parameter schema and a valid operationId', () => {
    expect(() => createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation({ parameterSchema: { type: 'object' } })],
      fetch: vi.fn() as typeof fetch,
    })).toThrowError(expect.objectContaining({ code: 'POLICY_OPERATION_INVALID' }));

    expect(() => createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation({ operationId: 'Invalid Operation' })],
      fetch: vi.fn() as typeof fetch,
    })).toThrowError(expect.objectContaining({ code: 'POLICY_OPERATION_INVALID' }));
  });

  it('normalizes buildBody failures and validates the generated action request', async () => {
    const sdkWithThrow = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation({
        buildBody() {
          throw new Error('do not expose this implementation error');
        },
      })],
      fetch: vi.fn() as typeof fetch,
    });
    await expect(sdkWithThrow.execute('site.list', { limit: 10 })).rejects.toMatchObject({
      code: 'POLICY_OPERATION_BUILD_FAILED',
    });

    const sdkWithInvalidRequest = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation({
        buildBody() {
          return { from: 'Site' } as never;
        },
      })],
      fetch: vi.fn() as typeof fetch,
    });
    await expect(sdkWithInvalidRequest.execute('site.list', { limit: 10 })).rejects.toMatchObject({
      code: 'POLICY_PARAMETERS_INVALID',
    });
  });

  it('freezes an operation contract returned by definePolicyOperation', () => {
    const defined = operation();
    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(defined.parameterSchema)).toBe(true);
    expect(() => {
      (defined as { action: string }).action = 'discover';
    }).toThrow(TypeError);
  });

  it('does not expose buildBody implementation errors', async () => {
    const sdk = createStoPolicyOntologySdk({
      endpoint: { mode: 'direct', policyOrigin: 'https://zc-hybrid-test.sto.cn' },
      tokenProvider: () => 'token',
      operations: [operation({ buildBody: () => { throw new StoPolicySdkError('POLICY_CONFIG_INVALID', 'secret'); } })],
      fetch: vi.fn() as typeof fetch,
    });

    await expect(sdk.execute('site.list', { limit: 10 })).rejects.not.toThrow('secret');
  });
});
