import {
  isAnyCronSessionKey,
  parseClaudeScheduledTaskRunSessionKey,
  parseClaudeScheduledTaskSessionKey,
} from '@/stores/chat/cron-session-utils';
import type { ChatSession } from '@/stores/chat/types';
import { isAppDevSessionKey } from '@/lib/app-dev-session';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
import { isBridgeAiChatSessionKey } from '../../shared/bridge-ai-session';
import { isWorkflowPiSessionKey } from '../../shared/workflow-pi-session';

export function isSidebarRecentChatSessionKey(sessionKey: string): boolean {
  return !isAnyCronSessionKey(sessionKey)
    && !parseClaudeScheduledTaskRunSessionKey(sessionKey)
    && !parseClaudeScheduledTaskSessionKey(sessionKey)
    && !isAppDevSessionKey(sessionKey)
    && !isSclawBrowserEmbedChatSessionKey(sessionKey)
    && !isBridgeAiChatSessionKey(sessionKey)
    && !isWorkflowPiSessionKey(sessionKey);
}

export function getSessionActivityForSort(
  session: Pick<ChatSession, 'key' | 'updatedAt' | 'engineType'>,
  sessionLastActivity: Record<string, number>,
): number {
  const recorded = sessionLastActivity[session.key] ?? 0;
  const listed = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
    ? session.updatedAt
    : 0;
  // Prefer locally tracked transcript/send activity; registry updatedAt is fallback only.
  if (recorded > 0 && listed > 0) return Math.max(recorded, listed);
  if (recorded > 0) return recorded;
  return listed;
}

/** Drop legacy Claude read-bump timestamps that far exceed transcript activity. */
export function scrubClaudeSessionLastActivity(
  sessions: Array<Pick<ChatSession, 'key' | 'updatedAt' | 'engineType'>>,
  sessionLastActivity: Record<string, number>,
  maxSkewMs = 5 * 60_000,
): Record<string, number> {
  let changed = false;
  const next = { ...sessionLastActivity };
  for (const session of sessions) {
    if (session.engineType !== 'claude') continue;
    const listed = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
      ? session.updatedAt
      : 0;
    const recorded = next[session.key] ?? 0;
    if (listed <= 0 || recorded <= listed) continue;
    if (recorded - listed > maxSkewMs) {
      next[session.key] = listed;
      changed = true;
    }
  }
  return changed ? next : sessionLastActivity;
}

export function sortSessionsByRecentActivity(
  sessions: ChatSession[],
  sessionLastActivity: Record<string, number>,
): ChatSession[] {
  return [...sessions].sort((left, right) => {
    const activityDiff = getSessionActivityForSort(right, sessionLastActivity)
      - getSessionActivityForSort(left, sessionLastActivity);
    if (activityDiff !== 0) return activityDiff;
    return right.key.localeCompare(left.key);
  });
}

export interface CatalogPinSortMeta {
  pinRank: number | null;
  lastActivityAt: string | null;
}

export function getCatalogSessionSortActivityMs(
  session: Pick<ChatSession, 'key' | 'updatedAt' | 'engineType'>,
  sessionLastActivity: Record<string, number>,
  catalogMeta?: CatalogPinSortMeta | null,
): number {
  const catalogActivity = catalogMeta?.lastActivityAt
    ? Date.parse(catalogMeta.lastActivityAt)
    : 0;
  return Math.max(getSessionActivityForSort(session, sessionLastActivity), catalogActivity);
}

export function sortSessionsWithCatalogPin(
  sessions: ChatSession[],
  sessionLastActivity: Record<string, number>,
  catalogByKey: Record<string, CatalogPinSortMeta>,
): ChatSession[] {
  return [...sessions].sort((left, right) => {
    const leftCatalog = catalogByKey[left.key];
    const rightCatalog = catalogByKey[right.key];
    const leftPinned = leftCatalog?.pinRank != null;
    const rightPinned = rightCatalog?.pinRank != null;
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

    const leftActivity = getCatalogSessionSortActivityMs(left, sessionLastActivity, leftCatalog);
    const rightActivity = getCatalogSessionSortActivityMs(right, sessionLastActivity, rightCatalog);
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
    return right.key.localeCompare(left.key);
  });
}

/** Sidebar recency order: last activity descending (mainstream chat UX). */
export function buildInitialSidebarRecentOrder(
  sessions: ChatSession[],
  sessionLastActivity: Record<string, number>,
): string[] {
  const recent = sessions.filter((session) => isSidebarRecentChatSessionKey(session.key));
  return sortSessionsByRecentActivity(recent, sessionLastActivity).map((session) => session.key);
}

export function mergeSidebarRecentOrder(existing: string[], currentKeys: string[]): string[] {
  const currentSet = new Set(currentKeys);
  const next = existing.filter((key) => currentSet.has(key));
  for (const key of currentKeys) {
    if (!existing.includes(key)) next.push(key);
  }
  return next;
}

export function prependSidebarRecentOrder(existing: string[], sessionKey: string): string[] {
  return [sessionKey, ...existing.filter((key) => key !== sessionKey)];
}

export function removeSidebarRecentOrderKey(existing: string[], sessionKey: string): string[] {
  return existing.filter((key) => key !== sessionKey);
}

