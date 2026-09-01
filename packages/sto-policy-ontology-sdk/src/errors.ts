export type PolicySdkErrorCode =
  | 'POLICY_CONFIG_INVALID'
  | 'POLICY_ACTION_DENIED'
  | 'POLICY_OPERATION_INVALID'
  | 'POLICY_OPERATION_DUPLICATE'
  | 'POLICY_OPERATION_NOT_FOUND'
  | 'POLICY_OPERATION_BUILD_FAILED'
  | 'POLICY_PARAMETERS_INVALID'
  | 'POLICY_UNAUTHORIZED'
  | 'POLICY_FORBIDDEN'
  | 'POLICY_TIMEOUT'
  | 'POLICY_ABORTED'
  | 'POLICY_NETWORK_ERROR'
  | 'POLICY_UPSTREAM_FAILED'
  | 'POLICY_RESPONSE_INVALID';

export type StoPolicySdkErrorOptions = {
  status?: number;
  upstreamCode?: string;
  traceId?: string;
  retryable?: boolean;
  detail?: unknown;
};

/** 安全错误只保留排障所需字段，禁止挂载请求、Header 或 Token。 */
export class StoPolicySdkError extends Error {
  readonly code: PolicySdkErrorCode;
  readonly status?: number;
  readonly upstreamCode?: string;
  readonly traceId?: string;
  readonly retryable: boolean;
  readonly detail?: unknown;

  constructor(code: PolicySdkErrorCode, message: string, options: StoPolicySdkErrorOptions = {}) {
    super(message);
    this.name = 'StoPolicySdkError';
    this.code = code;
    this.status = options.status;
    this.upstreamCode = options.upstreamCode;
    this.traceId = options.traceId;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.upstreamCode === undefined ? {} : { upstreamCode: this.upstreamCode }),
      ...(this.traceId === undefined ? {} : { traceId: this.traceId }),
      retryable: this.retryable,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}
