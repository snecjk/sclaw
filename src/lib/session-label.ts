/**
 * resolveSessionLabel — 会话标题解析（侧栏历史与内容区标题栏共用口径）。
 */
import type { TFunction } from 'i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';

function isTemporaryAgentSessionKey(key: string): boolean {
  return /^agent:[^:]+:session-\d+/.test(key);
}

export interface ResolveSessionLabelInput {
  /** 会话 key */
  key: string;
  /** 服务端 displayName */
  displayName?: string;
  /** 用户自定义 label */
  label?: string;
  /** 本地预览标题（首条消息截断等） */
  sessionLabels: Record<string, string>;
  /** i18n 翻译函数（需含 chat / common namespace） */
  t: TFunction;
}

/** 与 Sidebar.getSessionLabel 保持同一解析顺序与 fallback 规则 */
export function resolveSessionLabel(input: ResolveSessionLabelInput): string {
  const { key, displayName, label, sessionLabels, t } = input;
  const preview = sessionLabels[key];
  if (preview) return preview;
  if (label?.trim()) return label;
  const dn = displayName?.trim();
  if (dn && !looksLikeTechnicalSessionDisplay(dn) && dn !== key) return dn;
  if (key.endsWith(':main')) {
    return t('chat:sessionList.mainSessionTitle');
  }
  if (isTemporaryAgentSessionKey(key)) {
    return t('common:sidebar.newChat');
  }
  return key;
}
