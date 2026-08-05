import { describe, expect, it } from 'vitest';

import {
  extractLoginUrlFromOutput,
  interpretAuthStatusWithPatterns,
  matchAuthExpired,
} from '../../shared/connectors/auth-output-match';
import { QPATH_AUTH_PATTERNS } from '../../shared/connectors/auth-pattern-presets';

describe('auth-output-match', () => {
  it('extracts dingTalk login URL', () => {
    const text =
      '请访问 https://login.dingtalk.com/oauth2/auth?client_id=abc&foo=1 完成登录';
    expect(extractLoginUrlFromOutput(text, QPATH_AUTH_PATTERNS.loginUrlPattern)).toBe(
      'https://login.dingtalk.com/oauth2/auth?client_id=abc&foo=1',
    );
  });

  it('interprets status with loggedIn / loggedOut patterns', () => {
    expect(
      interpretAuthStatusWithPatterns({
        stdout: '登录状态：已登录',
        stderr: '',
        exitCode: 0,
        loggedInPattern: QPATH_AUTH_PATTERNS.loggedInPattern,
        loggedOutPattern: QPATH_AUTH_PATTERNS.loggedOutPattern,
      }),
    ).toBe(true);

    expect(
      interpretAuthStatusWithPatterns({
        stdout: '登录状态：未登录',
        stderr: '',
        exitCode: 0,
        loggedInPattern: QPATH_AUTH_PATTERNS.loggedInPattern,
        loggedOutPattern: QPATH_AUTH_PATTERNS.loggedOutPattern,
      }),
    ).toBe(false);
  });

  it('matches auth expired pattern', () => {
    expect(
      matchAuthExpired('未登录，请先运行 qpath login', QPATH_AUTH_PATTERNS.authExpiredPattern),
    ).toBe(true);
    expect(matchAuthExpired('network timeout', QPATH_AUTH_PATTERNS.authExpiredPattern)).toBe(
      false,
    );
  });
});
