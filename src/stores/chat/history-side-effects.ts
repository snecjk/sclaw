import { deriveSessionLabelFromHistory, isCorruptedSessionLabel, normalizeDerivedSessionLabel } from '@/lib/workflow-session-hint';
import { buildSessionLabelDerivationOptions, shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import { getMessageText } from './helpers';
import { loadMissingPreviews } from './media-preview-cache';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage } from './types';

export function maybeDeriveSessionLabel(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  messages: RawMessage[];
}): void {
  const { get, messages, sessionKey, set } = input;
  if (sessionKey.endsWith(':main')) return;
  if (!shouldAutoDeriveSessionLabel(sessionKey, get().sessionLabels, isCorruptedSessionLabel)) return;

  const labelText = deriveSessionLabelFromHistory(
    messages,
    getMessageText,
    buildSessionLabelDerivationOptions(
      sessionKey,
      get().sessions,
      get().sessionLabels,
    ),
  );
  if (!labelText) return;

  const normalized = normalizeDerivedSessionLabel(labelText);
  if (!normalized) return;

  set((state) => ({
    sessionLabels: {
      ...state.sessionLabels,
      [sessionKey]: normalized,
    },
  }));
}

export function recordSessionActivityFromMessages(input: {
  set: ChatSet;
  sessionKey: string;
  messages: RawMessage[];
  toMs: (ts: unknown) => number;
}): void {
  const { messages, sessionKey, set, toMs } = input;
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg?.timestamp) return;

  const lastAt = toMs(lastMsg.timestamp);
  if (lastAt <= 0) return;

  set((state) => {
    const targetSession = state.sessions.find((session) => session.key === sessionKey);
    const listedAt = targetSession?.engineType === 'claude'
      ? 0
      : targetSession?.updatedAt ?? 0;
    const currentAt = state.sessionLastActivity[sessionKey] ?? 0;
    const nextAt = Math.max(currentAt, listedAt, lastAt);
    if (nextAt === currentAt) return {};
    return {
      sessionLastActivity: { ...state.sessionLastActivity, [sessionKey]: nextAt },
    };
  });
}

export function loadMissingPreviewsInBackground(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  messages: RawMessage[];
}): void {
  const { get, messages, sessionKey, set } = input;
  loadMissingPreviews(messages).then((updated) => {
    if (get().currentSessionKey !== sessionKey) return;
    if (!updated) return;

    set({
      messages: messages.map(msg =>
        msg._attachedFiles
          ? { ...msg, _attachedFiles: msg._attachedFiles.map(f => ({ ...f })) }
          : msg
      ),
    });
  });
}
