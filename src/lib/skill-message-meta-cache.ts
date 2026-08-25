/**
 * Restore `_skillMeta` on messages loaded from Gateway history.
 *
 * Priority:
 * 1. Transcript marker (`<!-- SClaw-Skill ... -->`) — durable, stored in OpenClaw .jsonl
 * 2. localStorage cache — fast path for same install / before marker rollout
 * 3. Session-label heuristic — legacy skill-only sessions without marker
 */
import {
  applySkillTranscriptMetaToMessages,
  deriveSkillUserDisplayText,
  normalizeSkillBubbleDisplayText,
  stripSkillTranscriptMarker,
} from '@/lib/skill-transcript-marker';
import { hydrateComposerSegmentsOnMessages } from '@/components/input-composer/user-composer-segments';
import { normalizeUserMessageForDisplay } from '@/lib/user-message-display';
import { getMessageText } from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat/types';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillMeta } from '@/types/skill-meta';

const CACHE_KEY = 'stoclaw:skill-message-meta-v1';
const MAX_ENTRIES = 500;
const MATCH_WINDOW_MS = 120_000;

export interface SkillMessageMetaEntry {
  sessionKey: string;
  messageId: string;
  displayText: string;
  skillMeta: SkillMeta;
  sentAtMs: number;
}

interface CacheStore {
  entries: SkillMessageMetaEntry[];
}

function loadStore(): CacheStore {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw) as CacheStore;
    return Array.isArray(parsed?.entries) ? parsed : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

function saveStore(store: CacheStore): void {
  try {
    const entries = store.entries.slice(-MAX_ENTRIES);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ entries }));
  } catch {
    // ignore quota errors
  }
}

export function rememberSkillMessageMeta(
  sessionKey: string,
  messageId: string,
  displayText: string,
  skillMeta: SkillMeta,
  sentAtMs = Date.now(),
): void {
  const store = loadStore();
  store.entries = store.entries.filter(
    (entry) => !(entry.sessionKey === sessionKey && entry.messageId === messageId),
  );
  store.entries.push({
    sessionKey,
    messageId,
    displayText,
    skillMeta,
    sentAtMs,
  });
  saveStore(store);
}

export function forgetSkillMessageMetaForSession(sessionKey: string): void {
  const store = loadStore();
  const next = store.entries.filter((entry) => entry.sessionKey !== sessionKey);
  if (next.length === store.entries.length) return;
  saveStore({ entries: next });
}

function normalizeDisplay(content: unknown): string {
  return normalizeUserMessageForDisplay(getMessageText(content));
}

function messageTimestampMs(message: RawMessage): number {
  const ts = message.timestamp;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return NaN;
  return ts < 1e12 ? ts * 1000 : ts;
}

function entryMatchesMessage(
  entry: SkillMessageMetaEntry,
  message: RawMessage,
  options: { isFirstUserMessage: boolean },
): boolean {
  if (entry.messageId && message.id && entry.messageId === message.id) return true;

  const msgDisplay = normalizeDisplay(message.content);
  const entryDisplay = entry.displayText.trim();
  const title = entry.skillMeta.title.trim();

  if (entryDisplay) {
    if (msgDisplay === entryDisplay) return true;
    if (msgDisplay.endsWith(entryDisplay)) return true;
  } else {
    if (msgDisplay === title) return true;
    if (options.isFirstUserMessage && msgDisplay.length > 0) return true;
  }

  const msgMs = messageTimestampMs(message);
  if (!Number.isFinite(msgMs) || Math.abs(msgMs - entry.sentAtMs) > MATCH_WINDOW_MS) {
    return false;
  }

  if (entryDisplay && msgDisplay.includes(entryDisplay)) return true;
  return !entryDisplay && options.isFirstUserMessage;
}

export function applySkillMetaCacheToMessages(
  messages: RawMessage[],
  sessionKey: string,
): RawMessage[] {
  const entries = loadStore()
    .entries
    .filter((entry) => entry.sessionKey === sessionKey)
    .sort((a, b) => a.sentAtMs - b.sentAtMs);
  if (!entries.length) return messages;

  const usedEntryIds = new Set<string>();
  let seenUserMessage = false;

  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const isFirstUserMessage = !seenUserMessage;
    seenUserMessage = true;

    if (message._skillMeta) {
      const entry = entries.find(
        (candidate) => !usedEntryIds.has(candidate.messageId)
          && entryMatchesMessage(candidate, message, { isFirstUserMessage }),
      );
      if (entry) {
        usedEntryIds.add(entry.messageId);
        return {
          ...message,
          _skillMeta: entry.skillMeta,
          content: normalizeSkillBubbleDisplayText(entry.skillMeta.title, entry.displayText),
        };
      }
      const raw = getMessageText(message.content);
      if (raw.includes('<!-- SClaw-Skill')) {
        const redisplay = deriveSkillUserDisplayText(
          stripSkillTranscriptMarker(raw),
          message._skillMeta.slug,
          message._skillMeta.title,
        );
        if (redisplay !== raw) {
          return { ...message, content: redisplay };
        }
      }
      return {
        ...message,
        content: normalizeSkillBubbleDisplayText(message._skillMeta.title, raw),
      };
    }
    if (message.id?.startsWith('session-label-user-')) return message;

    const entry = entries.find(
      (candidate) => !usedEntryIds.has(candidate.messageId)
        && entryMatchesMessage(candidate, message, { isFirstUserMessage }),
    );
    if (!entry) return message;

    usedEntryIds.add(entry.messageId);
    return {
      ...message,
      _skillMeta: entry.skillMeta,
      content: normalizeSkillBubbleDisplayText(entry.skillMeta.title, entry.displayText),
    };
  });
}

function findUniqueSkillByTitle(title: string): SkillMeta | null {
  const normalized = title.trim();
  if (!normalized) return null;
  const state = useSkillPlazaStore.getState();
  const matches = [...state.plazaSkills, ...state.mySkills].filter(
    (skill) => (skill.title?.trim() || skill.slug) === normalized,
  );
  if (matches.length !== 1) return null;
  const skill = matches[0];
  return { slug: skill.slug, title: skill.title?.trim() || skill.slug };
}

/** Fallback when local cache is missing but session label matches a unique plaza skill title. */
export function applySkillLabelHeuristicToMessages(
  messages: RawMessage[],
  sessionLabel?: string | null,
): RawMessage[] {
  const label = sessionLabel?.trim();
  if (!label) return messages;

  const skillMeta = findUniqueSkillByTitle(label);
  if (!skillMeta) return messages;

  let seenUserMessage = false;
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const isFirstUserMessage = !seenUserMessage;
    seenUserMessage = true;
    if (!isFirstUserMessage || message._skillMeta) return message;

    const display = normalizeDisplay(message.content);
    if (display !== label) return message;

    return {
      ...message,
      _skillMeta: skillMeta,
      content: '',
    };
  });
}

export function restoreSkillMetaOnMessages(
  messages: RawMessage[],
  sessionKey: string,
  sessionLabel?: string | null,
): RawMessage[] {
  // 必须在 skill content 收缩之前：从仍含 `[文件:]`/`[技能:]`/工作流 bake 的原文重建 segments。
  // 切会话后无乐观 donor 时，这是保持 inline 混排的唯一来源。
  let result = hydrateComposerSegmentsOnMessages(messages);
  result = applySkillTranscriptMetaToMessages(result);
  result = applySkillMetaCacheToMessages(result, sessionKey);
  result = applySkillLabelHeuristicToMessages(result, sessionLabel);
  return result;
}

/** Test-only reset */
export function clearSkillMessageMetaCacheForTests(): void {
  localStorage.removeItem(CACHE_KEY);
}
