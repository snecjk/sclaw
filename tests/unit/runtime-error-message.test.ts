import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { formatChatRuntimeErrorMessage } from '@/stores/chat/runtime-error-message';

describe('chat runtime error message', () => {
  it('uses a generic recovery-timeout copy instead of browser automation wording', () => {
    const message = formatChatRuntimeErrorMessage({ reason: 'recovery-timeout' }, 'Chat run failed');
    expect(message).toBe(i18n.t('chat:runtime.errors.recoveryTimeout'));
    expect(message).not.toMatch(/browser automation|浏览器自动化|ブラウザ自動化/i);
  });
});
