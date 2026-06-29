import {
  buildSessionLabelDerivationOptions,
  hasUsableSessionTitle,
  shouldAutoDeriveSessionLabel,
} from '@/lib/session-label';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import {
  deriveSessionLabelFromHistory,
  isCorruptedSessionLabel,
  isPlaceholderSessionLabel,
  normalizeDerivedSessionLabel,
} from '@/lib/workflow-session-hint';
import { CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../../shared/chat-config';
import { getMessageText, isToolResultRole, toMs } from './helpers';
import type { ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';

/** Match loadHistory cap so long tool-heavy sessions still reach the first user turn. */
export const SESSION_METADATA_HISTORY_LIMIT = CHAT_HISTORY_LENGTH_MAX_LIMIT;
export const SESSION_METADATA_HYDRATE_LIMIT = 80;
export const SESSION_METADATA_HYDRATE_CONCURRENCY = 4;
const LABEL_HYDRATE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 40_000];

export type SessionLabelHydrateSnapshot = {
  sessions: ChatSession[];
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  sidebarRecentOrder?: string[];
};

export type SessionLabelHydrateCommit = (
  updater: (snapshot: SessionLabelHydrateSnapshot) => Partial<SessionLabelHydrateSnapshot>,
) => void;

let labelHydrateInFlight: Promise<void> | null = null;
let labelHydrateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let labelHydrateRetryAttempt = 0;
let labelHydratePending = false;

function resolveSessionAgentEngineType(session: ChatSession): ChatSession['engineType'] | undefined {
  if (!session.key.startsWith('agent:')) return undefined;
  const agentId = session.key.split(':')[1];
  return useAgentsStore.getState().agents.find((agent) => agent.id === agentId)?.engineType;
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  }));
}

/** Align with loadHistory: tool_result rows are not used for title derivation. */
export function prepareMessagesForSessionLabelDerivation(messages: RawMessage[]): RawMessage[] {
  return messages.filter((message) => !isToolResultRole(message.role));
}

export function collectSessionsNeedingLabelHydrate(
  sessions: ChatSession[],
  sessionLabels: Record<string, string>,
  sessionLastActivity: Record<string, number>,
  sidebarRecentOrder: readonly string[] = [],
): ChatSession[] {
  const recentRank = new Map(sidebarRecentOrder.map((key, index) => [key, index]));

  return sessions
    .filter((session) => {
      if (session.key.endsWith(':main')) return false;
      return !hasUsableSessionTitle(session, sessionLabels);
    })
    .sort((left, right) => {
      const leftRecent = recentRank.get(left.key);
      const rightRecent = recentRank.get(right.key);
      const leftRecentRank = leftRecent ?? Number.MAX_SAFE_INTEGER;
      const rightRecentRank = rightRecent ?? Number.MAX_SAFE_INTEGER;
      if (leftRecentRank !== rightRecentRank) return leftRecentRank - rightRecentRank;

      const leftPlaceholder = isPlaceholderSessionLabel(left.label ?? '') ? 1 : 0;
      const rightPlaceholder = isPlaceholderSessionLabel(right.label ?? '') ? 1 : 0;
      if (leftPlaceholder !== rightPlaceholder) return rightPlaceholder - leftPlaceholder;
      const leftAt = sessionLastActivity[left.key] ?? left.updatedAt ?? 0;
      const rightAt = sessionLastActivity[right.key] ?? right.updatedAt ?? 0;
      return rightAt - leftAt;
    })
    .slice(0, SESSION_METADATA_HYDRATE_LIMIT);
}

export async function fetchSessionHistoryForMetadata(
  session: ChatSession,
): Promise<RawMessage[]> {
  const engineType = resolveChatSessionEngineType(
    session,
    resolveSessionAgentEngineType(session),
    session.key,
  );
  const data = await useGatewayStore.getState().rpc<{ messages?: RawMessage[] }>(
    'chat.history',
    {
      sessionKey: session.key,
      limit: SESSION_METADATA_HISTORY_LIMIT,
      engineType,
    },
  );
  return Array.isArray(data?.messages) ? data.messages : [];
}

export function deriveStoredSessionLabelFromMessages(
  sessionKey: string,
  sessions: ChatSession[],
  sessionLabels: Record<string, string>,
  messages: RawMessage[],
): string | undefined {
  if (!shouldAutoDeriveSessionLabel(sessionKey, sessionLabels, isCorruptedSessionLabel)) {
    return undefined;
  }
  const labelText = deriveSessionLabelFromHistory(
    prepareMessagesForSessionLabelDerivation(messages),
    getMessageText,
    buildSessionLabelDerivationOptions(sessionKey, sessions, sessionLabels),
  );
  return normalizeDerivedSessionLabel(labelText);
}

export function lastMessageActivityMs(messages: RawMessage[]): number {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg?.timestamp) return 0;
  return toMs(lastMsg.timestamp);
}

function applySessionLabelHydratePatch(
  snapshot: SessionLabelHydrateSnapshot,
  session: ChatSession,
  messages: RawMessage[],
): Partial<SessionLabelHydrateSnapshot> {
  const labelText = deriveStoredSessionLabelFromMessages(
    session.key,
    snapshot.sessions,
    snapshot.sessionLabels,
    messages,
  );
  if (!labelText) return {};
  return {
    sessionLabels: {
      ...snapshot.sessionLabels,
      [session.key]: labelText,
    },
  };
}

async function runSessionLabelHydration(
  getSnapshot: () => SessionLabelHydrateSnapshot,
  commit: SessionLabelHydrateCommit,
): Promise<void> {
  const snapshot = getSnapshot();
  const sessionsToHydrate = collectSessionsNeedingLabelHydrate(
    snapshot.sessions,
    snapshot.sessionLabels,
    snapshot.sessionLastActivity,
    snapshot.sidebarRecentOrder,
  );
  if (sessionsToHydrate.length === 0) {
    labelHydrateRetryAttempt = 0;
    return;
  }

  await runLimited(sessionsToHydrate, SESSION_METADATA_HYDRATE_CONCURRENCY, async (session) => {
    try {
      const msgs = await fetchSessionHistoryForMetadata(session);
      commit((current) => applySessionLabelHydratePatch(current, session, msgs));
    } catch {
      // ignore per-session errors; retry scheduler may run again
    }
  });

  const after = getSnapshot();
  const stillPending = collectSessionsNeedingLabelHydrate(
    after.sessions,
    after.sessionLabels,
    after.sessionLastActivity,
    after.sidebarRecentOrder,
  );
  if (stillPending.length === 0) {
    labelHydrateRetryAttempt = 0;
    return;
  }
  if (labelHydrateRetryAttempt >= LABEL_HYDRATE_RETRY_DELAYS_MS.length) return;

  const delay = LABEL_HYDRATE_RETRY_DELAYS_MS[labelHydrateRetryAttempt];
  labelHydrateRetryAttempt += 1;
  if (labelHydrateRetryTimer) clearTimeout(labelHydrateRetryTimer);
  labelHydrateRetryTimer = setTimeout(() => {
    labelHydrateRetryTimer = null;
    scheduleSessionLabelHydration(getSnapshot, commit);
  }, delay);
}

/** Background sidebar title hydration; retries when Gateway/history is not ready yet. */
export function scheduleSessionLabelHydration(
  getSnapshot: () => SessionLabelHydrateSnapshot,
  commit: SessionLabelHydrateCommit,
): void {
  if (labelHydrateInFlight) {
    labelHydratePending = true;
    return;
  }
  labelHydrateInFlight = runSessionLabelHydration(getSnapshot, commit).finally(() => {
    labelHydrateInFlight = null;
    if (labelHydratePending) {
      labelHydratePending = false;
      scheduleSessionLabelHydration(getSnapshot, commit);
    }
  });
}

export function scheduleSessionLabelHydrationForStore(
  getState: () => SessionLabelHydrateSnapshot,
  setState: ChatSet,
): void {
  scheduleSessionLabelHydration(
    getState,
    (updater) => {
      setState((state) => updater({
        sessions: state.sessions,
        sessionLabels: state.sessionLabels,
        sessionLastActivity: state.sessionLastActivity,
        sidebarRecentOrder: state.sidebarRecentOrder,
      }));
    },
  );
}
