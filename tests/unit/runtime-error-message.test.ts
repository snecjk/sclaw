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
});
