import type { SclawToolFailure } from './types';

export class SclawToolExecutionError extends Error {
  readonly code: string;
  readonly outcome: SclawToolFailure;

  constructor(outcome: SclawToolFailure) {
    super(JSON.stringify(outcome));
    this.name = 'SclawToolExecutionError';
    this.code = outcome.error.code;
    this.outcome = outcome;
  }
}

export function sclawToolFailure(
  domain: string,
  code: string,
  message: string,
): SclawToolFailure {
  return {
    success: false,
    type: 'sto_tool_error',
    domain,
    message,
    error: { code, message },
  };
}
