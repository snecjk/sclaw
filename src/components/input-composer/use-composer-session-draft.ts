/**
 * Park / restore composer text when the active chat session changes.
 *
 * Home, 应用广场 and 建站 each have their own ChatInput but share one
 * `currentSessionKey`. Isolated composers must only read/write their own key
 * so an empty box cannot delete the main-session draft, and so leaving those
 * surfaces does not restore main-session text into a dying editor (layout jank).
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { isAppDevSessionKey } from '@/lib/app-dev-session';
import {
  clearSessionComposerDraft,
  isParkedComposerDraftEmpty,
  readSessionComposerDraft,
  saveSessionComposerDraft,
  type ParkedComposerDraft,
} from '@/lib/composer-session-draft';
import type { MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';

function applyParkedDraft(
  editor: DingTalkMentionEditorHandle,
  parked: ParkedComposerDraft,
): void {
  if (parked.segments.some((segment) => segment.type !== 'text')) {
    editor.setSegments(parked.segments);
    return;
  }
  editor.setPlainText(parked.plainText);
}

export function isHomeComposerSessionKey(sessionKey: string): boolean {
  const key = sessionKey.trim();
  if (!key) return false;
  return !isAppDevSessionKey(key) && !isSclawBrowserEmbedChatSessionKey(key);
}

export function useComposerSessionDraft({
  sessionKey,
  isolateToSessionKey = false,
  seedText,
  mentionEditorRef,
  snapshot,
  onBeforeRestore,
}: {
  sessionKey: string;
  /** When true, ignore foreign keys (plaza / 建站 lock to their own session). */
  isolateToSessionKey?: boolean;
  seedText?: string;
  mentionEditorRef: RefObject<DingTalkMentionEditorHandle | null>;
  snapshot: MentionComposerSnapshot;
  onBeforeRestore?: () => void;
}): { clearParkedDraft: () => void } {
  const snapshotRef = useRef(snapshot);
  const seedTextRef = useRef(seedText);
  const onBeforeRestoreRef = useRef(onBeforeRestore);
  const ownedKeyRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  snapshotRef.current = snapshot;
  seedTextRef.current = seedText;
  onBeforeRestoreRef.current = onBeforeRestore;

  useLayoutEffect(() => {
    const key = sessionKey.trim();
    const canBind = isolateToSessionKey ? Boolean(key) : isHomeComposerSessionKey(key);
    const ownedKey = ownedKeyRef.current;

    if (readyRef.current && ownedKey && ownedKey !== key) {
      saveSessionComposerDraft(ownedKey, snapshotRef.current, { clearIfEmpty: true });
    }

    if (!canBind) {
      readyRef.current = true;
      return;
    }

    const skipRestore = Boolean(seedTextRef.current?.trim());
    const editor = mentionEditorRef.current;
    const parked = readSessionComposerDraft(key);
    const hasParked = !isParkedComposerDraftEmpty(parked);
    const switchingSessions = Boolean(readyRef.current && ownedKey && ownedKey !== key);

    if (editor && !skipRestore) {
      if (hasParked && parked) {
        onBeforeRestoreRef.current?.();
        applyParkedDraft(editor, parked);
      } else if (switchingSessions) {
        onBeforeRestoreRef.current?.();
        editor.clear();
      }
    } else if (editor && skipRestore && switchingSessions) {
      onBeforeRestoreRef.current?.();
      editor.clear();
    }

    ownedKeyRef.current = key;
    readyRef.current = true;
  }, [isolateToSessionKey, mentionEditorRef, sessionKey]);

  useLayoutEffect(() => () => {
    const ownedKey = ownedKeyRef.current;
    if (!ownedKey) return;
    saveSessionComposerDraft(ownedKey, snapshotRef.current);
  }, [mentionEditorRef]);

  const clearParkedDraft = useCallback(() => {
    const ownedKey = ownedKeyRef.current;
    if (!ownedKey) return;
    clearSessionComposerDraft(ownedKey);
  }, []);

  return { clearParkedDraft };
}
