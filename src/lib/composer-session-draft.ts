/**
 * Per-session composer drafts so switching chats (main / 广场 / 建站)
 * restores what the user was typing instead of sharing or wiping one box.
 */
import type { ComposerSegment, MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';

const MAX_PARKED_DRAFTS = 50;

export interface ParkedComposerDraft {
  plainText: string;
  segments: ComposerSegment[];
}

const draftsBySession = new Map<string, ParkedComposerDraft>();

function cloneSegments(segments: ComposerSegment[]): ComposerSegment[] {
  return segments
    .filter((segment) => segment.type !== 'file')
    .map((segment) => structuredClone(segment));
}

export function isParkedComposerDraftEmpty(draft: ParkedComposerDraft | null | undefined): boolean {
  if (!draft) return true;
  if (draft.segments.some((segment) => segment.type !== 'text')) return false;
  return !draft.plainText.trim();
}

export function toParkedComposerDraft(snapshot: MentionComposerSnapshot): ParkedComposerDraft {
  return {
    plainText: typeof snapshot.plainText === 'string' ? snapshot.plainText : '',
    segments: cloneSegments(snapshot.segments ?? []),
  };
}

export function saveSessionComposerDraft(
  sessionKey: string,
  snapshot: MentionComposerSnapshot,
  options?: { clearIfEmpty?: boolean },
): void {
  const key = sessionKey.trim();
  if (!key) return;
  const draft = toParkedComposerDraft(snapshot);
  if (isParkedComposerDraftEmpty(draft)) {
    // Empty snapshots from a different composer (广场 / 建站) must not wipe
    // another session's parked text. Only same-editor session switches opt in.
    if (options?.clearIfEmpty) {
      draftsBySession.delete(key);
    }
    return;
  }
  draftsBySession.delete(key);
  draftsBySession.set(key, draft);
  while (draftsBySession.size > MAX_PARKED_DRAFTS) {
    const oldest = draftsBySession.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    draftsBySession.delete(oldest);
  }
}

export function readSessionComposerDraft(sessionKey: string): ParkedComposerDraft | null {
  const key = sessionKey.trim();
  if (!key) return null;
  return draftsBySession.get(key) ?? null;
}

export function clearSessionComposerDraft(sessionKey: string): void {
  const key = sessionKey.trim();
  if (!key) return;
  draftsBySession.delete(key);
}

export function resetComposerSessionDraftsForTests(): void {
  draftsBySession.clear();
}
