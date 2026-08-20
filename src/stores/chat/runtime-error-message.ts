import i18n from '@/i18n';
import type { AppError } from '@/lib/error-model';

function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rate limit')
    || lower.includes('429')
    || message.includes('请求过于频繁');
}

export function resolveChatRuntimeErrorCode(
  payload: Record<string, unknown> | null,
  fallbackMessage: string,
): AppError['code'] {
  const reason = String(payload?.reason ?? '');
  if (reason === 'recovery-timeout') return 'TIMEOUT';
  const errorText = String(payload?.error ?? fallbackMessage);
  if (isRateLimitMessage(errorText)) return 'RATE_LIMIT';
  return 'GATEWAY';
}

export function formatChatRuntimeErrorMessage(
  payload: Record<string, unknown> | null,
  fallbackMessage: string,
): string {
  const reason = String(payload?.reason ?? '');
  if (reason === 'recovery-timeout') {
    return i18n.t('chat:runtime.errors.recoveryTimeout');
  }
  const errorText = String(payload?.error ?? fallbackMessage);
  if (isRateLimitMessage(errorText)) {
    return i18n.t('chat:runtime.errors.rateLimit');
  }
  return errorText || fallbackMessage;
}

export function formatChatRuntimeErrorForDisplay(error: AppError): string {
  const reason = typeof error.details?.reason === 'string' ? error.details.reason : '';
  if (reason === 'recovery-timeout') {
    return i18n.t('chat:runtime.errors.recoveryTimeout');
  }
  if (error.code === 'RATE_LIMIT' || isRateLimitMessage(error.message)) {
    return i18n.t('chat:runtime.errors.rateLimit');
  }
  return error.message;
}
