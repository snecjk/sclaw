import type { BridgeError, BridgeErrorCode } from './types';

export class StoClawBridgeError extends Error implements BridgeError {
  code: BridgeErrorCode;

  details?: Record<string, unknown>;

  constructor(code: BridgeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'StoClawBridgeError';
    this.code = code;
    this.details = details;
  }
}

export function wrapNativeError(error: unknown): StoClawBridgeError {
  if (error instanceof StoClawBridgeError) return error;
  const native = error as Error & { code?: BridgeErrorCode; details?: Record<string, unknown> };
  const code = native.code ?? 'INTERNAL_ERROR';
  return new StoClawBridgeError(code, native.message || 'Bridge call failed', native.details);
}
