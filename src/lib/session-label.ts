/**
 * resolveSessionLabel — 会话标题解析（侧栏历史与内容区标题栏共用口径）。
 */
import type { TFunction } from 'i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';
import type { ChatSession } from '@/stores/chat/types';

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

/** Collect human-readable title candidates for a session (lookup order matches resolveSessionLabel). */
export function sessionTitleCandidates(
  session: ChatSession,
  sessionLabels: Record<string, string>,
): string[] {
  const out: string[] = [];
  const preview = sessionLabels[session.key]?.trim();
  if (preview) out.push(preview);
  const label = session.label?.trim();
  if (label) out.push(label);
  const dn = session.displayName?.trim();
  if (dn && !looksLikeTechnicalSessionDisplay(dn) && dn !== session.key) out.push(dn);
  return out;
}

/**
 * Find a session key by exact title match (case-insensitive).
 * When multiple sessions share the same title, returns the most recently active one.
 */
export function findSessionKeyByTitle(
  title: string,
  sessions: ChatSession[],
  sessionLabels: Record<string, string>,
  sessionLastActivity: Record<string, number> = {},
): string | undefined {
  const needle = title.trim().toLowerCase();
  if (!needle) return undefined;

  const matches = sessions.filter((session) =>
    sessionTitleCandidates(session, sessionLabels).some((candidate) => candidate.toLowerCase() === needle),
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].key;

  return [...matches].sort((left, right) => {
    const leftAt = sessionLastActivity[left.key] ?? left.updatedAt ?? 0;
    const rightAt = sessionLastActivity[right.key] ?? right.updatedAt ?? 0;
    return rightAt - leftAt;
  })[0].key;
}
