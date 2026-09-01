import { assertPolicyRequest, isPolicyAction, POLICY_HTTP_ACTIONS } from './contracts';
import { StoPolicySdkError, type PolicySdkErrorCode } from './errors';
import { PolicyOperationRegistry } from './operations';
import type {
  DescribeMetricTreeRequest,
  DiscoverRequest,
  ExecuteFunctionRequest,
  HelpRequest,
  JsonObject,
  PolicyAction,
  PolicyCallOptions,
  PolicyEndpoint,
  PolicyFetch,
  PolicyRequestMap,
  PolicySdkResult,
  QueryObjectSetRequest,
  ResolveReferenceRequest,
  SchemaRequest,
  SearchAroundRequest,
  StoPolicyOntologySdkOptions,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEndpoint(endpoint: PolicyEndpoint): PolicyEndpoint {
  if (endpoint.mode === 'direct') {
    try {
      const url = new URL(endpoint.policyOrigin.trim());
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new Error('invalid origin');
      }
      return { mode: 'direct', policyOrigin: url.origin };
    } catch {
      throw new StoPolicySdkError(
        'POLICY_CONFIG_INVALID',
        'Direct Policy endpoint must be an HTTPS origin without path, query, or credentials',
      );
    }
  }

  const prefix = endpoint.prefix.trim().replace(/\/+$/, '');
  if (!/^\/(?!\/)/.test(prefix) || prefix.includes('?') || prefix.includes('#')) {
    throw new StoPolicySdkError(
      'POLICY_CONFIG_INVALID',
      'Same-origin Policy proxy prefix must be an absolute path',
    );
  }
  return { mode: 'same-origin-proxy', prefix };
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value <= 0) {
    throw new StoPolicySdkError(
      'POLICY_CONFIG_INVALID',
      'Policy timeoutMs must be a positive integer',
    );
  }
  return value;
}

function buildUrl(endpoint: PolicyEndpoint, action: PolicyAction): string {
  if (endpoint.mode === 'same-origin-proxy') {
    return `${endpoint.prefix}/${action}`;
  }
  return `${endpoint.policyOrigin}${POLICY_HTTP_ACTIONS[action].path}`;
}

function traceIdOf(payload: JsonRecord): string | undefined {
  return typeof payload.traceId === 'string' && payload.traceId.trim()
    ? payload.traceId.trim()
    : undefined;
}

function createRequestTraceId(): string {
  const cryptoWithUuid = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  return cryptoWithUuid?.randomUUID?.() ?? `sto-policy-sdk-${Date.now()}`;
}

function redactText(value: string, token: string): string {
  if (!token) return value;
  return value.split(token).join('[REDACTED]');
}

function sanitizeDetail(value: unknown, token: string, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value, token);
  if (Array.isArray(value)) return value.map((item) => sanitizeDetail(item, token, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeDetail(child, token, depth + 1)]),
    );
  }
  return value;
}

function errorCodeForStatus(status: number, upstreamCode?: string): PolicySdkErrorCode {
  if (status === 401) return 'POLICY_UNAUTHORIZED';
  if (status === 403) return 'POLICY_FORBIDDEN';
  const normalized = upstreamCode?.trim().toUpperCase();
  if (
    normalized &&
    ['9000', 'UNAUTHORIZED', 'AUTH_REQUIRED', 'TOKEN_EXPIRED', 'INVALID_TOKEN'].includes(normalized)
  ) {
    return 'POLICY_UNAUTHORIZED';
  }
  return 'POLICY_UPSTREAM_FAILED';
}

function upstreamError(payload: JsonRecord, status: number, token: string): StoPolicySdkError {
  if (payload.ok === false && isRecord(payload.error)) {
    const error = payload.error;
    const upstreamCode = typeof error.code === 'string' ? error.code : undefined;
    const message = typeof error.message === 'string'
      ? redactText(error.message, token)
      : `Policy request failed with HTTP ${status}`;
    return new StoPolicySdkError(errorCodeForStatus(status, upstreamCode), message, {
      status,
      upstreamCode,
      traceId: traceIdOf(payload),
      retryable: error.retryable === true,
      detail: sanitizeDetail({ detail: error.detail, diagnostic: payload.diagnostic }, token),
    });
  }

  if (payload.success === false) {
    const upstreamCode = typeof payload.errorCode === 'string'
      ? payload.errorCode
      : undefined;
    const message = typeof payload.errorMsg === 'string'
      ? redactText(payload.errorMsg, token)
      : `Policy request failed with HTTP ${status}`;
    return new StoPolicySdkError(errorCodeForStatus(status, upstreamCode), message, {
      status,
      upstreamCode,
      traceId: traceIdOf(payload),
      retryable: status >= 500,
      detail: sanitizeDetail(payload.errorDetail, token),
    });
  }

  return new StoPolicySdkError(errorCodeForStatus(status), `Policy request failed with HTTP ${status}`, {
    status,
    traceId: traceIdOf(payload),
    retryable: status >= 500,
  });
}

function parseSuccess<T>(payload: JsonRecord): PolicySdkResult<T> | null {
  if (payload.ok === true) {
    const data = Object.prototype.hasOwnProperty.call(payload, 'data')
      ? payload.data
      : Object.fromEntries(
          Object.entries(payload).filter(
            ([key]) => !['ok', 'traceId', 'warnings'].includes(key),
          ),
        );
    return {
      // CLI 九接口并非都使用 data 包装（如 execute-function 顶层返回 result），统一在这里归一化。
      data: data as T,
      traceId: traceIdOf(payload),
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    };
  }
  if (payload.success === true && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return {
      data: payload.data as T,
      traceId: traceIdOf(payload),
      warnings: [],
    };
  }
  return null;
}

export interface StoPolicyOntologySdk {
  execute<T = unknown>(
    operationId: string,
    parameters?: JsonObject,
    options?: PolicyCallOptions,
  ): Promise<PolicySdkResult<T>>;
  invoke<A extends PolicyAction, T = unknown>(
    action: A,
    input: PolicyRequestMap[A],
    options?: PolicyCallOptions,
  ): Promise<PolicySdkResult<T>>;
  discover<T = unknown>(input: DiscoverRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  executeFunction<T = unknown>(input: ExecuteFunctionRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  resolveReference<T = unknown>(input: ResolveReferenceRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  queryObjectSet<T = unknown>(input: QueryObjectSetRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  searchAround<T = unknown>(input: SearchAroundRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  schema<T = unknown>(input: SchemaRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  schemaGraph<T = unknown>(options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  describeMetricTree<T = unknown>(input: DescribeMetricTreeRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
  help<T = unknown>(input: HelpRequest, options?: PolicyCallOptions): Promise<PolicySdkResult<T>>;
}

class DefaultStoPolicyOntologySdk implements StoPolicyOntologySdk {
  private readonly endpoint: PolicyEndpoint;
  private readonly timeoutMs: number;
  private readonly fetchImpl: PolicyFetch;
  private readonly operations: PolicyOperationRegistry;

  constructor(private readonly options: StoPolicyOntologySdkOptions) {
    if (typeof options.tokenProvider !== 'function') {
      throw new StoPolicySdkError('POLICY_CONFIG_INVALID', 'Policy tokenProvider is required');
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new StoPolicySdkError('POLICY_CONFIG_INVALID', 'Fetch API is unavailable');
    }
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = fetchImpl.bind(globalThis) as PolicyFetch;
    this.operations = new PolicyOperationRegistry(options.operations);
  }

  async execute<T = unknown>(
    operationId: string,
    parameters: JsonObject = {},
    options?: PolicyCallOptions,
  ): Promise<PolicySdkResult<T>> {
    const request = this.operations.buildRequest(operationId, parameters);
    return this.invoke(request.action, request.input, options) as Promise<PolicySdkResult<T>>;
  }

  async invoke<A extends PolicyAction, T = unknown>(
    action: A,
    input: PolicyRequestMap[A],
    options?: PolicyCallOptions,
  ): Promise<PolicySdkResult<T>> {
    if (!isPolicyAction(String(action))) {
      throw new StoPolicySdkError('POLICY_ACTION_DENIED', 'Unsupported Policy action');
    }
    assertPolicyRequest(action, input);

    let token: string;
    try {
      token = String((await this.options.tokenProvider()) ?? '').trim();
    } catch {
      throw new StoPolicySdkError('POLICY_UNAUTHORIZED', 'Unable to obtain Policy credentials');
    }
    if (!token) {
      throw new StoPolicySdkError('POLICY_UNAUTHORIZED', 'Policy credentials are missing');
    }

    const definition = POLICY_HTTP_ACTIONS[action];
    const controller = new AbortController();
    let timedOut = false;
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    if (options?.signal?.aborted) controller.abort();

    let body: string | undefined;
    try {
      body = definition.method === 'POST' ? JSON.stringify(input) : undefined;
    } catch {
      globalThis.clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
      throw new StoPolicySdkError('POLICY_PARAMETERS_INVALID', 'Policy request body must be JSON-compatible');
    }

    try {
      const headers = new Headers({
        accept: 'application/json',
        stoToken: token,
        Authorization: `Bearer ${token}`,
        'x-request-id': createRequestTraceId(),
      });
      if (definition.method === 'POST') headers.set('content-type', 'application/json');

      const response = await this.fetchImpl(buildUrl(this.endpoint, action), {
        method: definition.method,
        headers,
        body,
        credentials: 'include',
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new StoPolicySdkError(
          'POLICY_RESPONSE_INVALID',
          'Policy response is not valid JSON',
          { status: response.status },
        );
      }

      if (!isRecord(payload)) {
        throw new StoPolicySdkError(
          'POLICY_RESPONSE_INVALID',
          'Policy response must be a JSON object',
          { status: response.status },
        );
      }

      const success = parseSuccess<T>(payload);
      if (response.ok && success) return success;
      if (!response.ok || payload.ok === false || payload.success === false) {
        throw upstreamError(payload, response.status, token);
      }
      throw new StoPolicySdkError(
        'POLICY_RESPONSE_INVALID',
        'Policy response does not match a supported envelope',
        { status: response.status, traceId: traceIdOf(payload) },
      );
    } catch (error) {
      if (error instanceof StoPolicySdkError) throw error;
      if (options?.signal?.aborted) {
        throw new StoPolicySdkError('POLICY_ABORTED', 'Policy request was aborted');
      }
      if (timedOut) {
        throw new StoPolicySdkError('POLICY_TIMEOUT', 'Policy request timed out', {
          retryable: true,
        });
      }
      throw new StoPolicySdkError('POLICY_NETWORK_ERROR', 'Policy network request failed', {
        retryable: true,
      });
    } finally {
      globalThis.clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  discover<T = unknown>(input: DiscoverRequest, options?: PolicyCallOptions) {
    return this.invoke<'discover', T>('discover', input, options);
  }

  executeFunction<T = unknown>(input: ExecuteFunctionRequest, options?: PolicyCallOptions) {
    return this.invoke<'executefunction', T>('executefunction', input, options);
  }

  resolveReference<T = unknown>(input: ResolveReferenceRequest, options?: PolicyCallOptions) {
    return this.invoke<'resolvereference', T>('resolvereference', input, options);
  }

  queryObjectSet<T = unknown>(input: QueryObjectSetRequest, options?: PolicyCallOptions) {
    return this.invoke<'queryobjectset', T>('queryobjectset', input, options);
  }

  searchAround<T = unknown>(input: SearchAroundRequest, options?: PolicyCallOptions) {
    return this.invoke<'searcharound', T>('searcharound', input, options);
  }

  schema<T = unknown>(input: SchemaRequest, options?: PolicyCallOptions) {
    return this.invoke<'schema', T>('schema', input, options);
  }

  schemaGraph<T = unknown>(options?: PolicyCallOptions) {
    return this.invoke<'schemagraph', T>('schemagraph', undefined, options);
  }

  describeMetricTree<T = unknown>(input: DescribeMetricTreeRequest, options?: PolicyCallOptions) {
    return this.invoke<'describemetrictree', T>('describemetrictree', input, options);
  }

  help<T = unknown>(input: HelpRequest, options?: PolicyCallOptions) {
    return this.invoke<'help', T>('help', input, options);
  }
}

export function createStoPolicyOntologySdk(
  options: StoPolicyOntologySdkOptions,
): StoPolicyOntologySdk {
  return new DefaultStoPolicyOntologySdk(options);
}
