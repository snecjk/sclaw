/**
 * resolveSessionLabel — 会话标题解析（侧栏历史与内容区标题栏共用口径）。
 */
import type { TFunction } from 'i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';
import type { ChatSession } from '@/stores/chat/types';

/** Zustand persist bucket for `useChatStore` sessionLabels (see chat.ts persist name). */
export const SESSION_LABELS_STORAGE_KEY = 'stoclaw-chat-session-labels';

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
  const preview = resolveStoredSessionLabel(key, sessionLabels);
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

/** Read a single session label from localStorage before Zustand persist rehydration finishes. */
export function readPersistedSessionLabel(sessionKey: string): string | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(SESSION_LABELS_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: { sessionLabels?: Record<string, string> } };
    const label = parsed?.state?.sessionLabels?.[sessionKey]?.trim();
    return label || undefined;
  } catch {
    return undefined;
  }
}

/** In-memory label with localStorage fallback (avoids refresh race with async persist rehydrate). */
export function resolveStoredSessionLabel(
  sessionKey: string,
  sessionLabels: Record<string, string>,
): string | undefined {
  const fromMemory = sessionLabels[sessionKey]?.trim();
  if (fromMemory) return fromMemory;
  return readPersistedSessionLabel(sessionKey);
}

export function shouldAutoDeriveSessionLabel(
  sessionKey: string,
  sessionLabels: Record<string, string>,
  isCorrupted: (label: string) => boolean,
): boolean {
  const existing = resolveStoredSessionLabel(sessionKey, sessionLabels);
  if (!existing) return true;
  return isCorrupted(existing);
}

export function applyStoredSessionLabels<T extends ChatSession>(
  sessions: T[],
  sessionLabels: Record<string, string>,
): T[] {
  return sessions.map((session) => {
    const stored = resolveStoredSessionLabel(session.key, sessionLabels);
    if (!stored) return session;
    return { ...session, label: stored };
  });
}
