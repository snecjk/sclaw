import { describe, expect, it } from 'vitest';
import { buildChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';

describe('canonical chat runtime selectors', () => {
  it('derives active UI state from explicit non-terminal phases', () => {
    const state = createClientSessionState();
    state.runtime = {
      phase: 'reconciling',
      runId: 'run-1',
      idempotencyKey: 'message-1',
      engineType: 'openclaw',
      epoch: 2,
      sequence: 3,
      startedAt: 100,
      lastEventAt: 200,
    };
    expect(buildChatSessionRuntimeView(state)).toMatchObject({
      sending: true,
      activeRunId: 'run-1',
      phase: 'reconciling',
    });
  });

  it('does not expose a terminal run as active', () => {
    const state = createClientSessionState();
    state.transcript = [{ role: 'user', content: 'finished question', timestamp: 250 }];
    state.runtime = {
      phase: 'completed',
      runId: 'run-1',
      idempotencyKey: 'message-1',
      engineType: 'openclaw',
      epoch: 1,
      sequence: 4,
      startedAt: 100,
      lastEventAt: 300,
    };
    expect(buildChatSessionRuntimeView(state)).toMatchObject({
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });
  });

  it('exposes the current user timestamp only while the canonical run is active', () => {
    const state = createClientSessionState();
    state.overlay.optimisticUserMessage = {
      id: 'message-1', role: 'user', content: 'question', timestamp: 2,
    };
    state.runtime = {
      phase: 'running', runId: 'run-1', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 2, startedAt: 2_000, lastEventAt: 2_100,
    };
    expect(buildChatSessionRuntimeView(state).lastUserMessageAt).toBe(2_000);

    state.runtime = { ...state.runtime, phase: 'completed', sequence: 3 };
    expect(buildChatSessionRuntimeView(state).lastUserMessageAt).toBeNull();
  });

  it('keeps the final overlay until history contains the current turn', () => {
    const state = createClientSessionState();
    state.runtime = {
      phase: 'completed', runId: 'run-1', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 4, startedAt: 2_000, lastEventAt: 3_000,
    };
    state.overlay.optimisticUserMessage = {
      id: 'message-1', role: 'user', content: 'new question', timestamp: 2,
    };
    state.overlay.streamingMessage = { role: 'assistant', content: 'new answer' };
    state.overlay.awaitingTranscript = true;
    useChatRuntimeV2Store.setState({ sessionsByKey: { session: state } });

    useChatRuntimeV2Store.getState().setTranscript('session', [
      { id: 'old-user', role: 'user', content: 'old question', timestamp: 1 },
      { id: 'old-answer', role: 'assistant', content: 'old answer', timestamp: 1.5 },
    ]);
    expect(useChatRuntimeV2Store.getState().sessionsByKey.session.overlay.streamingMessage)
      .toMatchObject({ content: 'new answer' });

    useChatRuntimeV2Store.getState().setTranscript('session', [
      { id: 'message-1', role: 'user', content: 'new question', timestamp: 2 },
      { id: 'new-answer', role: 'assistant', content: 'new answer', timestamp: 3 },
    ]);
    expect(useChatRuntimeV2Store.getState().sessionsByKey.session.overlay.streamingMessage).toBeNull();
    expect(useChatRuntimeV2Store.getState().sessionsByKey.session.overlay.optimisticUserMessage).toBeNull();
  });
});
