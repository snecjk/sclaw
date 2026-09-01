import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const INTERNAL_HOST_API_HEADER = 'x-sclaw-internal-request';
const internalRequestSecret = randomBytes(32).toString('base64url');

export function addInternalHostApiHeader(headers: Record<string, string>): void {
  headers[INTERNAL_HOST_API_HEADER] = internalRequestSecret;
}

export function assertInternalHostApiRequest(req: IncomingMessage): void {
  const provided = req.headers[INTERNAL_HOST_API_HEADER];
  const value = Array.isArray(provided) ? provided[0] : provided;
  const expectedBytes = Buffer.from(internalRequestSecret);
  const providedBytes = Buffer.from(value ?? '');
  if (
    providedBytes.byteLength !== expectedBytes.byteLength
    || !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw Object.assign(new Error('该操作只能从 SClaw 应用内发起'), { statusCode: 403 });
  }
}
