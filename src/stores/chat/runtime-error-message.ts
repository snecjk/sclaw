import i18n from '@/i18n';
import type { AppError, AppErrorCode } from '@/lib/error-model';

function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rate limit')
    || lower.includes('429')
    || message.includes('请求过于频繁');
}

function looksLikeHtmlErrorPage(message: string): boolean {
  return /<!DOCTYPE\s+html|<html[\s>]|<\/html>|<head>[\s\S]*<title>|Powered by Tengine/i.test(message);
}

/** Nginx/Tengine dumps the status page body into the model error string. */
function classifyGatewayHtmlError(message: string): 'timeout' | 'unavailable' | null {
  const isHtml = looksLikeHtmlErrorPage(message);
  const isNamedGateway = /gateway time-?out|bad gateway|service unavailable|powered by tengine/i.test(message);
  if (!isHtml && !isNamedGateway) return null;
  if (/\b504\b|gateway time-?out/i.test(message)) return 'timeout';
  if (/\b502\b|\b503\b|bad gateway|service unavailable/i.test(message)) return 'unavailable';
  return isHtml ? 'unavailable' : null;
}

function friendlyRuntimeError(message: string): { code: AppErrorCode; text: string } | null {
  if (isRateLimitMessage(message)) {
    return { code: 'RATE_LIMIT', text: i18n.t('chat:runtime.errors.rateLimit') };
  }
  const gatewayKind = classifyGatewayHtmlError(message);
  if (gatewayKind === 'timeout') {
    return { code: 'TIMEOUT', text: i18n.t('chat:runtime.errors.gatewayTimeout') };
  }
  if (gatewayKind === 'unavailable') {
    return { code: 'GATEWAY', text: i18n.t('chat:runtime.errors.gatewayUnavailable') };
  }
  return null;
}

export function resolveChatRuntimeErrorCode(
  payload: Record<string, unknown> | null,
  fallbackMessage: string,
): AppError['code'] {
  const reason = String(payload?.reason ?? '');
  if (reason === 'recovery-timeout') return 'TIMEOUT';
  const errorText = String(payload?.error ?? fallbackMessage);
  return friendlyRuntimeError(errorText)?.code ?? 'GATEWAY';
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
  return friendlyRuntimeError(errorText)?.text || errorText || fallbackMessage;
}

export function formatChatRuntimeErrorForDisplay(error: AppError): string {
  const reason = typeof error.details?.reason === 'string' ? error.details.reason : '';
  if (reason === 'recovery-timeout') {
    return i18n.t('chat:runtime.errors.recoveryTimeout');
  }
  if (error.code === 'RATE_LIMIT') {
    return i18n.t('chat:runtime.errors.rateLimit');
  }
  return friendlyRuntimeError(error.message)?.text || error.message;
}
