/**
 * resolveSessionLabel — 会话标题解析（侧栏历史与内容区标题栏共用口径）。
 */
import type { TFunction } from 'i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';
import type { ChatSession } from '@/stores/chat/types';
import { isCorruptedSessionLabel, type DeriveSessionLabelOptions } from '@/lib/workflow-session-hint';

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

export function buildSessionLabelDerivationOptions(
  sessionKey: string,
  sessions: ChatSession[],
  sessionLabels: Record<string, string>,
): DeriveSessionLabelOptions {
  const session = sessions.find((entry) => entry.key === sessionKey);
  return {
    sessionKey,
    gatewayLabel: session?.label,
    spawnedBy: session?.spawnedBy,
    sessionLabels,
    sessions,
  };
}

/** First non-corrupted human title from stored preview, gateway label, or main displayName. */
export function resolveVisibleSessionTitle(
  session: Pick<ChatSession, 'key' | 'label' | 'displayName'>,
  sessionLabels: Record<string, string>,
): string | undefined {
  const stored = resolveStoredSessionLabel(session.key, sessionLabels);
  if (stored && !isCorruptedSessionLabel(stored)) return stored;
  const label = session.label?.trim();
  if (label && !isCorruptedSessionLabel(label)) return label;
  if (session.key.endsWith(':main')) {
    const dn = session.displayName?.trim();
    if (dn && !looksLikeTechnicalSessionDisplay(dn) && dn !== session.key) return dn;
  }
  return undefined;
}

export function hasUsableSessionTitle(
  session: Pick<ChatSession, 'key' | 'label' | 'displayName'>,
  sessionLabels: Record<string, string>,
): boolean {
  return Boolean(resolveVisibleSessionTitle(session, sessionLabels));
}

/** Drop persisted titles that were saved from subagent boilerplate or workflow hints. */
export function scrubCorruptedSessionLabels(
  sessionLabels: Record<string, string>,
): Record<string, string> {
  let changed = false;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(sessionLabels)) {
    if (isCorruptedSessionLabel(value)) {
      changed = true;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : sessionLabels;
}

/** 与 Sidebar.getSessionLabel 保持同一解析顺序与 fallback 规则 */
export function resolveSessionLabel(input: ResolveSessionLabelInput): string {
  const { key, displayName, label, sessionLabels, t } = input;
  const preview = resolveStoredSessionLabel(key, sessionLabels);
  if (preview && !isCorruptedSessionLabel(preview)) return preview;
  const gatewayLabel = label?.trim();
  if (gatewayLabel && !isCorruptedSessionLabel(gatewayLabel)) return gatewayLabel;
  if (key.endsWith(':main')) {
    const dn = displayName?.trim();
    if (dn && !looksLikeTechnicalSessionDisplay(dn) && dn !== key) return dn;
    return t('chat:sessionList.mainSessionTitle');
  }
  if (isTemporaryAgentSessionKey(key)) {
    return t('common:sidebar.newChat');
  }
  // Non-main sessions without a derived title: avoid agent displayName (e.g. "S Claw").
  return t('common:sidebar.newChat');
}

/** Collect human-readable title candidates for a session (lookup order matches resolveSessionLabel). */
export function sessionTitleCandidates(
  session: ChatSession,
  sessionLabels: Record<string, string>,
): string[] {
  const out: string[] = [];
  const preview = sessionLabels[session.key]?.trim();
  if (preview && !isCorruptedSessionLabel(preview)) out.push(preview);
  const label = session.label?.trim();
  if (label && !isCorruptedSessionLabel(label)) out.push(label);
  const dn = session.displayName?.trim();
  if (session.key.endsWith(':main') && dn && !looksLikeTechnicalSessionDisplay(dn) && dn !== session.key) {
    out.push(dn);
  }
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
    if (!stored || isCorruptedSessionLabel(stored)) return session;
    return { ...session, label: stored };
  });
}
