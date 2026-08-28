export const STO_SSO_AUTH_ERROR_CODES = [
  'SSO_AUTH_CONFIG_MISSING',
  'SSO_AUTH_CONFIG_INVALID',
  'SSO_AUTH_PAGE_TYPE_UNSUPPORTED',
  'AUTH_REQUIRED',
  'AUTH_RUNTIME_UNAVAILABLE',
  'LOCAL_AUTH_SESSION_DENIED',
  'LOCAL_AUTH_UNAVAILABLE',
  'SSO_EXCHANGE_FAILED',
  'SSO_RESPONSE_INVALID',
  'SSO_REDIRECT_LOOP',
  'SSO_STORAGE_FAILED',
] as const;

export type StoSsoAuthErrorCode = (typeof STO_SSO_AUTH_ERROR_CODES)[number];

export class StoSsoAuthError extends Error {
  readonly code: StoSsoAuthErrorCode;
  readonly traceId?: string;
  readonly httpStatus?: number;

  constructor(
    code: StoSsoAuthErrorCode,
    message: string,
    details?: { traceId?: string; httpStatus?: number },
  ) {
    super(message);
    this.name = 'StoSsoAuthError';
    this.code = code;
    this.traceId = details?.traceId;
    this.httpStatus = details?.httpStatus;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.traceId ? { traceId: this.traceId } : {}),
      ...(this.httpStatus ? { httpStatus: this.httpStatus } : {}),
    };
  }
}
