import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// token 来源整体 mock：每个用例自行控制"已配置/未配置（IO 失败）"两种灰度状态
vi.mock('../../electron/utils/openclaw-auth', () => ({
  getOrCreateBrowserAutomationToken: vi.fn(),
}));

import { getOrCreateBrowserAutomationToken } from '../../electron/utils/openclaw-auth';
import {
  checkBrowserAutomationAuthorization,
  checkBrowserAutomationHost,
  checkBrowserAutomationHttpAuth,
} from '../../electron/api/browser-automation-auth';
import { logger } from '../../electron/utils/logger';

const mockGetToken = vi.mocked(getOrCreateBrowserAutomationToken);

function fakeReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

const TOKEN = 'test-token-32-bytes-padded-0123456789ab';

describe('browser automation Host header allowlist (C1)', () => {
  it.each([
    '127.0.0.1:3210',
    'localhost:3210',
    '[::1]:3210',
    '127.0.0.1',
    'localhost',
    '[::1]',
  ])('allows loopback host %s', (host) => {
    expect(checkBrowserAutomationHost(fakeReq({ host }))).toBeNull();
  });

  it.each([
    'evil.com',
    'attacker.com:3210',
    '127.0.0.1.evil.com',
    '0.0.0.0:3210',
    '192.168.1.5:3210',
    'localhost.evil.com',
  ])('rejects non-loopback host %s with 403 HOST_MISMATCH', (host) => {
    const failure = checkBrowserAutomationHost(fakeReq({ host }));
    expect(failure).toMatchObject({ statusCode: 403, code: 'HOST_MISMATCH' });
  });

  it('rejects a missing Host header', () => {
    const failure = checkBrowserAutomationHost(fakeReq({}));
    expect(failure).toMatchObject({ statusCode: 403, code: 'HOST_MISMATCH' });
  });
});

describe('browser automation Bearer token check (C1/C3)', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  it('accepts the configured token', () => {
    mockGetToken.mockReturnValue(TOKEN);
    const req = fakeReq({ host: '127.0.0.1:3210', authorization: `Bearer ${TOKEN}` });
    expect(checkBrowserAutomationAuthorization(req)).toBeNull();
    expect(checkBrowserAutomationHttpAuth(req)).toBeNull();
  });

  it('rejects a missing Authorization header with 401 UNAUTHORIZED', () => {
    mockGetToken.mockReturnValue(TOKEN);
    const failure = checkBrowserAutomationAuthorization(fakeReq({ host: '127.0.0.1:3210' }));
    expect(failure).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a wrong token (same length, timingSafeEqual path)', () => {
    mockGetToken.mockReturnValue(TOKEN);
    const wrong = `x${TOKEN.slice(1)}`;
    const failure = checkBrowserAutomationAuthorization(
      fakeReq({ host: '127.0.0.1:3210', authorization: `Bearer ${wrong}` }),
    );
    expect(failure).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a wrong-length token and non-Bearer schemes', () => {
    mockGetToken.mockReturnValue(TOKEN);
    expect(
      checkBrowserAutomationAuthorization(fakeReq({ host: '127.0.0.1:3210', authorization: 'Bearer short' })),
    ).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(
      checkBrowserAutomationAuthorization(fakeReq({ host: '127.0.0.1:3210', authorization: `Basic ${TOKEN}` })),
    ).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('gray mode: token unconfigured (IO failure) → allow + warn', () => {
    mockGetToken.mockImplementation(() => {
      throw new Error('token file unreadable');
    });
    const req = fakeReq({ host: '127.0.0.1:3210' });
    expect(checkBrowserAutomationAuthorization(req)).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('runs Host check before token check (bad host + good token → 403)', () => {
    mockGetToken.mockReturnValue(TOKEN);
    const req = fakeReq({ host: 'evil.com', authorization: `Bearer ${TOKEN}` });
    expect(checkBrowserAutomationHttpAuth(req)).toMatchObject({ statusCode: 403, code: 'HOST_MISMATCH' });
  });
});
