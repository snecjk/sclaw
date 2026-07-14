/**
 * Chat State Store v2 implementation
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { markSessionUnreadAfterSuccessfulRun } from '@/lib/session-unread-notify';
import { useSessionUnreadStore } from '@/stores/session-unread';
import { useAgentsStore } from '../agents';
import {
  removeSidebarRecentOrderKey,
} from '@/lib/sidebar-recent-order';
import {
  scheduleSessionLabelHydrationForStore,
} from '@/stores/chat/session-metadata-hydrate';
import {
  type ChatSession,
  type ChatState,
} from './types';
import type { ChatSet } from './store-api';
import { scrubCorruptedSessionLabels } from '@/lib/session-label';
import { stripAgentMemoryContextsForDisplay } from '@/lib/agent-memory-display';
import {
  captureAgentMemories,
} from '@/lib/agent-execution-memory';
import {
  buildSessionSwitchPatch as buildSessionSwitchPatchFromRuntime,
} from './session-runtime';
import { applyRuntimePatch } from './runtime-controller';
import { createBackgroundSessionEventHandler } from './background-session-events';
import type { BackgroundChatEvent } from './background-session-events';
import { initialChatDataState } from './initial-state';
import { createRuntimeUiActions } from './runtime-ui-actions';
import { createSessionUiActions } from './session-ui-actions';
import { createSessionNavigationActions } from './session-navigation-actions';
import { createWorkflowActions } from './workflow-actions';
import { createSessionLifecycleActions } from './session-lifecycle-actions';
import { createHistoryLoadActions } from './history-load-actions';
import { createSendActions } from './send-actions';
import { createForegroundEventActions } from './foreground-event-actions';
import { buildTerminalRuntimePatch } from './turn-state-machine';
import { buildTerminalTurnEffects, executeTurnEffects } from './turn-effects';
import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  hasErrorRecoveryTimer,
  setErrorRecoveryTimer,
  setHistoryPollTimer,
} from './runtime-timers';
import {
  isToolOnlyMessage,
} from './message-content';
import {
  buildFallbackMainSessionKey,
  getAgentIdFromSessionKey,
  normalizeAgentId,
} from './session-identity';
import {
  getFallbackSessionEngineType,
  normalizeSendMessageOptions,
  parseSessionUpdatedAtMs,
  resolveEngineTypeForSession as resolveEngineTypeForSessionWithAgent,
  stripAgentMemoryFromHistoryMessage as stripAgentMemoryMessage,
  toMs,
  toNumberIfFinite,
} from './store-helpers';

export type {
  AttachedFileMeta,
  ChatSession,
  ContentBlock,
  RawMessage,
  ToolStatus,
  WorkflowContextBlock,
} from './types';

function getAgentEngineType(agentId: string | undefined | null): ChatSession['engineType'] | undefined {
  const normalizedAgentId = normalizeAgentId(agentId);
  return useAgentsStore.getState().agents.find((agent) => normalizeAgentId(agent.id) === normalizedAgentId)?.engineType;
}

function stripAgentMemoryFromHistoryMessage(message: Parameters<typeof stripAgentMemoryMessage>[0]) {
  return stripAgentMemoryMessage(message, stripAgentMemoryContextsForDisplay);
}

function resolveEngineTypeForSession(
  sessions: ChatSession[],
  sessionKey: string,
  agentId?: string | null,
): ChatSession['engineType'] | undefined {
  return resolveEngineTypeForSessionWithAgent(sessions, sessionKey, agentId, getAgentEngineType);
}

function scheduleSessionLabelHydrationFromStore(
  set: ChatSet,
  get: () => ChatState,
): void {
  scheduleSessionLabelHydrationForStore(get, set);
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  const engineType = getFallbackSessionEngineType(sessionKey, getAgentEngineType);
  return [...sessions, { key: sessionKey, engineType }];
}

function buildSessionSwitchPatch(
  state: Parameters<typeof buildSessionSwitchPatchFromRuntime>[0],
  nextSessionKey: string,
): Partial<ChatState> {
  return buildSessionSwitchPatchFromRuntime(
    state,
    nextSessionKey,
    (sessionKey) => ensureSessionEntry([], sessionKey)[0]?.engineType,
  );
}
function handleBackgroundSessionEvent(
  set: ChatSet,
  event: BackgroundChatEvent,
): void {
  createBackgroundSessionEventHandler({
    get: () => useChatStore.getState(),
    resolveEngineType: resolveEngineTypeForSession,
    isToolOnlyMessage,
    dispatchMemoryCapture: dispatchAgentMemoryCapture,
    markUnreadAfterRun: markSessionUnreadAfterSuccessfulRun,
  })(set, event);
}
function getCanonicalPrefixFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
  ...initialChatDataState,
  ...createSessionLifecycleActions(set, get, {
    parseSessionUpdatedAtMs,
    scheduleSessionLabelHydrationFromStore,
    getAgentEngineType,
    getCanonicalPrefixFromSessionKey,
  }),

  ...createHistoryLoadActions(set, get, {
    toMs,
    clearHistoryPoll,
    resolveEngineTypeForSession,
    stripAgentMemoryFromHistoryMessage,
    dispatchAgentMemoryCapture,
  }),

  ...createSendActions(set, get, {
    normalizeSendMessageOptions,
    resolveMainSessionKeyForAgent,
    buildSessionSwitchPatch,
    resolveEngineTypeForSession,
    toNumberIfFinite,
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    setHistoryPollTimer,
  }),

  ...createForegroundEventActions(set, get, {
    resolveEngineTypeForSession,
    handleBackgroundSessionEvent,
    dispatchAgentMemoryCapture,
    clearHistoryPoll,
    clearErrorRecoveryTimer,
    setErrorRecoveryTimer,
    hasErrorRecoveryTimer,
  }),

  // Local UI/session metadata actions are composed from dedicated modules.
  ...createRuntimeUiActions(set, get),
  ...createSessionUiActions(set),
  ...createWorkflowActions(set, get),
  ...createSessionNavigationActions(set, get, {
    markSessionRead: (sessionKey) => useSessionUnreadStore.getState().markSessionRead(sessionKey),
    resolveMainSessionKey: resolveMainSessionKeyForAgent,
    resolveEngineType: (sessionKey) => ensureSessionEntry([], sessionKey)[0]?.engineType,
    removeSidebarRecentKey: removeSidebarRecentOrderKey,
  }),
}), {
  name: 'stoclaw-chat-session-labels',
  partialize: (state) => ({
    sessionLabels: state.sessionLabels,
    sessionLastActivity: state.sessionLastActivity,
  }),
  merge: (persisted, current) => {
    const stored = persisted as Partial<Pick<typeof current, 'sessionLabels' | 'sessionLastActivity'>>;
    return {
      ...current,
      sessionLabels: scrubCorruptedSessionLabels(stored.sessionLabels ?? {}),
      sessionLastActivity: stored.sessionLastActivity ?? current.sessionLastActivity,
    };
  },
}));

function dispatchAgentMemoryCapture(input: {
  agentId?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  engineType?: string | null;
}): void {
  captureAgentMemories(input);
}

/** OpenClaw has no Claude-style runtimeResult; agent.completed is the terminal signal. */
export function finalizeOpenClawRunAfterAgentCompleted(sessionKey: string | null, runId?: string | null): void {
  const state = useChatStore.getState();
  const targetKey = sessionKey ?? state.currentSessionKey;
  const engineType = resolveEngineTypeForSession(state.sessions, targetKey, state.currentAgentId);
  // Finalize on agent.completed for both agentic engines. Claude runs whose
  // terminal 'final' event lacks phase=completed are treated as non-terminal
  // fragments (see resolveAssistantFinalTerminalState), so they rely on this
  // path to clear sending. Without it the spinner stays stuck after the run.
  if (engineType !== 'openclaw' && engineType !== 'claude') return;

  // Agentic 'final' chat events lack phase=completed, so their
  // isTerminalOutput gate never fires the memory-capture dispatch. This
  // agent.completed path is the real terminal point — capture the run id
  // before clearing runtime state and dispatch execution-memory precipitation.
  const resolvedRunId = runId ?? state.activeRunId ?? undefined;
  const agentId = getAgentIdFromSessionKey(targetKey);

  clearHistoryPoll();
  useChatStore.setState((prev) => applyRuntimePatch(prev, targetKey, buildTerminalRuntimePatch(null)));
  executeTurnEffects(buildTerminalTurnEffects({
    agentId,
    runId: resolvedRunId,
    sessionKey: targetKey,
    engineType,
    finalizeVisibleMessages: targetKey === state.currentSessionKey,
  }), {
    get: () => useChatStore.getState(),
    set: (partial) => {
      useChatStore.setState(partial);
    },
    dispatchMemoryCapture: dispatchAgentMemoryCapture,
  });
}
