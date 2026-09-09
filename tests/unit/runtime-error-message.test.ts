import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { AppError } from '@/lib/error-model';
import {
  formatChatRuntimeErrorForDisplay,
  formatChatRuntimeErrorMessage,
  resolveChatRuntimeErrorCode,
} from '@/stores/chat/runtime-error-message';

const TENGINE_504 = '504 <!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"> <html> <head><title>504 Gateway Time-out</title></head> <body> <center> <h1>504 Gateway Time-out</h1> </center> <hr/>Powered by Tengine<hr> <center>nginx</center> </body> </html>';
const TENGINE_502 = '502 <!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>';

describe('chat runtime error message', () => {
  it('uses a generic recovery-timeout copy instead of browser automation wording', () => {
    const message = formatChatRuntimeErrorMessage({ reason: 'recovery-timeout' }, 'Chat run failed');
    expect(message).toBe(i18n.t('chat:runtime.errors.recoveryTimeout'));
    expect(message).not.toMatch(/browser automation|浏览器自动化|ブラウザ自動化/i);
  });

  it('rewrites nginx/Tengine 504 HTML into a short timeout copy', () => {
    expect(resolveChatRuntimeErrorCode({ error: TENGINE_504 }, 'Chat run failed')).toBe('TIMEOUT');
    expect(formatChatRuntimeErrorMessage({ error: TENGINE_504 }, 'Chat run failed')).toBe(
      i18n.t('chat:runtime.errors.gatewayTimeout'),
    );
    expect(formatChatRuntimeErrorMessage({ error: TENGINE_504 }, 'Chat run failed')).not.toMatch(/DOCTYPE|Tengine|<html/i);
  });

  it('rewrites 502/503 HTML into a short unavailable copy', () => {
    expect(resolveChatRuntimeErrorCode({ error: TENGINE_502 }, 'Chat run failed')).toBe('GATEWAY');
    expect(formatChatRuntimeErrorMessage({ error: TENGINE_502 }, 'Chat run failed')).toBe(
      i18n.t('chat:runtime.errors.gatewayUnavailable'),
    );
  });

  it('still sanitizes a stored HTML error at display time', () => {
    const stored = new AppError('GATEWAY', TENGINE_504);
    expect(formatChatRuntimeErrorForDisplay(stored)).toBe(i18n.t('chat:runtime.errors.gatewayTimeout'));
    expect(formatChatRuntimeErrorForDisplay(stored)).not.toMatch(/DOCTYPE|<html/i);
  });

  it('leaves ordinary engine errors unchanged', () => {
    expect(formatChatRuntimeErrorMessage({ error: 'model returned empty content' }, 'Chat run failed'))
      .toBe('model returned empty content');
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
