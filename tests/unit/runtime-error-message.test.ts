import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import {
  formatChatRuntimeErrorMessage,
  resolveChatRuntimeErrorCode,
} from '@/stores/chat/runtime-error-message';

describe('chat runtime error message', () => {
  it('uses a generic recovery-timeout copy instead of browser automation wording', () => {
    const message = formatChatRuntimeErrorMessage({ reason: 'recovery-timeout' }, 'Chat run failed');
    expect(message).toBe(i18n.t('chat:runtime.errors.recoveryTimeout'));
    expect(message).not.toMatch(/browser automation|浏览器自动化|ブラウザ自動化/i);
  });

  it('explains when network retries have been exhausted', () => {
    const payload = { reason: 'network-retry-exhausted', retryAttempts: 2, error: 'Request timed out.' };
    expect(formatChatRuntimeErrorMessage(payload, 'Chat run failed'))
      .toBe(i18n.t('chat:runtime.errors.networkRetryExhausted', { count: 2 }));
    expect(resolveChatRuntimeErrorCode(payload, 'Chat run failed')).toBe('NETWORK');
  });

  it('translates Claude certificate verification failures into actionable guidance', () => {
    const error = 'Claude Code returned an error result: API Error: Unable to connect to API (UNKNOWN_CERTIFICATE_VERIFICATION_ERROR)';
    expect(formatChatRuntimeErrorMessage({ error }, 'Chat run failed'))
      .toBe(i18n.t('chat:runtime.errors.claudeCertificate'));
    expect(resolveChatRuntimeErrorCode({ error }, 'Chat run failed')).toBe('NETWORK');
  });

  it('turns an invalid model API key into a safe, actionable message', () => {
    const error = '401: {"code":"apikey_notfound","message":"大模型令牌无效或未找到"}';
    expect(formatChatRuntimeErrorMessage({ error }, 'Chat run failed'))
      .toBe(i18n.t('chat:runtime.errors.modelAuthentication'));
    expect(resolveChatRuntimeErrorCode({ error }, 'Chat run failed')).toBe('AUTH_INVALID');
  });

  it('explains when a Pi session no longer has a workspace', () => {
    const error = 'PI_WORKSPACE_UNAVAILABLE: session agent:proj-example:appdev:project-1 has no cwd';
    expect(formatChatRuntimeErrorMessage({ error }, 'Chat run failed'))
      .toBe(i18n.t('chat:runtime.errors.workspaceUnavailable'));
    expect(resolveChatRuntimeErrorCode({ error }, 'Chat run failed')).toBe('GATEWAY');
  });
});
