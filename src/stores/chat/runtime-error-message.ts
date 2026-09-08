import i18n from '@/i18n';
import type { AppError } from '@/lib/error-model';

function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rate limit')
    || lower.includes('429')
    || message.includes('请求过于频繁');
}

function isRequestTimeoutMessage(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower === 'request timed out.' || lower === 'request timed out' || lower === 'request timeout';
}

function isClaudeCertificateErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('unknown_certificate_verification_error')
    || lower.includes('certificate verification error');
}

function isModelAuthenticationErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('apikey_notfound')
    || lower.includes('api key')
    || lower.includes('invalid api key')
    || lower.includes('大模型令牌无效')
    || lower.includes('大模型令牌未找到');
}

export function resolveChatRuntimeErrorCode(
  payload: Record<string, unknown> | null,
  fallbackMessage: string,
): AppError['code'] {
  const reason = String(payload?.reason ?? '');
  if (reason === 'recovery-timeout') return 'TIMEOUT';
  if (reason === 'network-retry-exhausted') return 'NETWORK';
  const errorText = String(payload?.error ?? fallbackMessage);
  if (isModelAuthenticationErrorMessage(errorText)) return 'AUTH_INVALID';
  if (isClaudeCertificateErrorMessage(errorText)) return 'NETWORK';
  if (isRequestTimeoutMessage(errorText)) return 'TIMEOUT';
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
  if (reason === 'network-retry-exhausted') {
    return i18n.t('chat:runtime.errors.networkRetryExhausted', {
      count: Number(payload?.retryAttempts) || 0,
    });
  }
  const errorText = String(payload?.error ?? fallbackMessage);
  if (isModelAuthenticationErrorMessage(errorText)) {
    return i18n.t('chat:runtime.errors.modelAuthentication');
  }
  if (isClaudeCertificateErrorMessage(errorText)) {
    return i18n.t('chat:runtime.errors.claudeCertificate');
  }
  if (isRequestTimeoutMessage(errorText)) {
    return i18n.t('chat:runtime.errors.requestTimeout');
  }
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
  if (reason === 'network-retry-exhausted') {
    const retryAttempts = typeof error.details?.retryAttempts === 'number'
      ? error.details.retryAttempts
      : 0;
    return i18n.t('chat:runtime.errors.networkRetryExhausted', { count: retryAttempts });
  }
  if (error.code === 'AUTH_INVALID' || isModelAuthenticationErrorMessage(error.message)) {
    return i18n.t('chat:runtime.errors.modelAuthentication');
  }
  if (isClaudeCertificateErrorMessage(error.message)) {
    return i18n.t('chat:runtime.errors.claudeCertificate');
  }
  if (error.code === 'TIMEOUT' || isRequestTimeoutMessage(error.message)) {
    return i18n.t('chat:runtime.errors.requestTimeout');
  }
  if (error.code === 'RATE_LIMIT' || isRateLimitMessage(error.message)) {
    return i18n.t('chat:runtime.errors.rateLimit');
  }
  return error.message;
}
