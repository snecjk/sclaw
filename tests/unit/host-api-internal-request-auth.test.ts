import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';

import {
  addInternalHostApiHeader,
  assertInternalHostApiRequest,
} from '../../electron/api/internal-request-auth';

describe('internal Host API request authentication', () => {
  it('rejects direct localhost requests and accepts the runtime IPC proxy secret', () => {
    expect(() => assertInternalHostApiRequest({ headers: {} } as IncomingMessage))
      .toThrow('只能从 SClaw 应用内发起');

    const headers: Record<string, string> = {};
    addInternalHostApiHeader(headers);
    expect(() => assertInternalHostApiRequest({ headers } as unknown as IncomingMessage))
      .not.toThrow();
  });
});
