import { describe, expect, it } from 'vitest';
import { buildChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { getSessionDisplayMessages } from '@/stores/chat/display-selectors';
import { DINGTALK_RECIPIENTS_MARKER } from '../../shared/dingtalk-send/dingtalk-mention';

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

  it('keeps the current user anchor while a completed turn awaits transcript takeover', () => {
    const state = createClientSessionState();
    state.overlay.optimisticUserMessage = {
      id: 'message-1', role: 'user', content: 'question', timestamp: 2,
    };
    state.overlay.streamingMessage = { role: 'assistant', content: 'final answer' };
    state.overlay.awaitingTranscript = true;
    state.runtime = {
      phase: 'completed', runId: 'run-1', idempotencyKey: 'message-1', engineType: 'claude',
      epoch: 1, sequence: 4, startedAt: 2_000, lastEventAt: 3_000,
    };

    expect(buildChatSessionRuntimeView(state)).toMatchObject({
      sending: false,
      activeRunId: null,
      pendingFinal: true,
      lastUserMessageAt: 2_000,
    });
  });

  it('does not anchor a new background run to the previous transcript user turn', () => {
    const state = createClientSessionState();
    state.transcript = [{ role: 'user', content: 'previous question', timestamp: 1 }];
    state.runtime = {
      phase: 'dispatching', runId: null, idempotencyKey: 'scheduled-1', engineType: 'openclaw',
      epoch: 2, sequence: 1, startedAt: 10_000, lastEventAt: 10_000,
    };

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

  it('does not synthesize an optimistic user turn for scheduled runs (X2)', () => {
    // X2: 定时任务不再注入乐观 user 消息。任务会话的 user 气泡完全由 server echo 渲染，
    // setTranscript 不会为 scheduled 会话合成乐观消息，也不会因历史里出现同文 user
    // 而触发乐观配对清除（因为根本没有乐观消息可清）。
    const state = createClientSessionState();
    state.runtime = {
      phase: 'completed', runId: 'run-2', idempotencyKey: 'scheduled-2', engineType: 'openclaw',
      epoch: 2, sequence: 4, startedAt: 100_000, lastEventAt: 110_000,
    };
    state.overlay.streamingMessage = { role: 'assistant', content: 'current answer' };
    state.overlay.awaitingTranscript = true;
    useChatRuntimeV2Store.setState({ sessionsByKey: { scheduled: state } });

    // 老的同文 user turn 不应被当作当前 run 的回显（无乐观消息可清）。
    useChatRuntimeV2Store.getState().setTranscript('scheduled', [
      { id: 'old-user', role: 'user', content: 'repeat scheduled prompt', timestamp: 10 },
      { id: 'old-answer', role: 'assistant', content: 'old answer', timestamp: 20 },
    ]);

    const afterOldHistory = useChatRuntimeV2Store.getState().sessionsByKey.scheduled;
    expect(afterOldHistory.overlay.optimisticUserMessage).toBeNull();

    // 当前 run 的 echo 到达后，streaming overlay 由 transcript 接管清除。
    useChatRuntimeV2Store.getState().setTranscript('scheduled', [
      { id: 'old-user', role: 'user', content: 'repeat scheduled prompt', timestamp: 10 },
      { id: 'old-answer', role: 'assistant', content: 'old answer', timestamp: 20 },
      {
        id: 'server-current-user',
        role: 'user',
        content: `${DINGTALK_RECIPIENTS_MARKER}\n{}\n\n---\n\n用户消息：\nrepeat scheduled prompt`,
        timestamp: 106,
      },
      { id: 'current-answer', role: 'assistant', content: 'current answer', timestamp: 108 },
    ]);

    const settled = useChatRuntimeV2Store.getState().sessionsByKey.scheduled;
    expect(settled.overlay.optimisticUserMessage).toBeNull();
    expect(settled.overlay.streamingMessage).toBeNull();
  });

  it('keeps store and session references stable for an identical transcript', () => {
    const transcript = [{ id: 'user-1', role: 'user' as const, content: 'same' }];
    useChatRuntimeV2Store.setState({ sessionsByKey: {} });
    useChatRuntimeV2Store.getState().setTranscript('stable', transcript);
    const beforeStore = useChatRuntimeV2Store.getState();
    const beforeSession = beforeStore.sessionsByKey.stable;

    useChatRuntimeV2Store.getState().setTranscript('stable', [{ ...transcript[0] }]);

    expect(useChatRuntimeV2Store.getState()).toBe(beforeStore);
    expect(useChatRuntimeV2Store.getState().sessionsByKey.stable).toBe(beforeSession);
    expect(getSessionDisplayMessages('stable')).toBe(getSessionDisplayMessages('stable'));
  });

  it('settles a scheduled run when the echo user timestamp slightly precedes startedAt (X2 clock boundary)', () => {
    // X2 时钟边界：scheduled 会话无乐观消息，完成判定走 transcriptContainsCompletedTurn
    // 兜底（startedAt 之后的首条 user + 其后非空 assistant）。echo user 的 timestamp
    // 可能因数据库写入顺序/时钟偏移略早于 startedAt，需 2s 容差覆盖，否则误判「未完成」。
    const state = createClientSessionState();
    state.runtime = {
      phase: 'completed', runId: 'run-3', idempotencyKey: 'scheduled-3', engineType: 'openclaw',
      epoch: 3, sequence: 4, startedAt: 100_000, lastEventAt: 110_000,
    };
    state.overlay.streamingMessage = { role: 'assistant', content: 'current answer' };
    state.overlay.awaitingTranscript = true;
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'scheduled-boundary': state } });

    // echo user timestamp = 99.5s（→ 99_500ms，早于 startedAt 500ms，在 2s 容差内）+ 非空 assistant。
    useChatRuntimeV2Store.getState().setTranscript('scheduled-boundary', [
      { id: 'old-user', role: 'user', content: 'previous prompt', timestamp: 10 },
      { id: 'old-answer', role: 'assistant', content: 'old answer', timestamp: 20 },
      { id: 'echo-user', role: 'user', content: 'scheduled prompt', timestamp: 99.5 },
      { id: 'echo-answer', role: 'assistant', content: 'current answer', timestamp: 108 },
    ]);

    const settled = useChatRuntimeV2Store.getState().sessionsByKey['scheduled-boundary'];
    expect(settled.overlay.streamingMessage).toBeNull();
    expect(settled.overlay.optimisticUserMessage).toBeNull();
  });

  it('does not settle a scheduled run when the echo user timestamp is far before startedAt', () => {
    // 反例：echo user timestamp 早于 startedAt 超过容差（如 10s），不应被当作当前 run 的 user。
    const state = createClientSessionState();
    state.runtime = {
      phase: 'completed', runId: 'run-4', idempotencyKey: 'scheduled-4', engineType: 'openclaw',
      epoch: 4, sequence: 4, startedAt: 100_000, lastEventAt: 110_000,
    };
    state.overlay.streamingMessage = { role: 'assistant', content: 'current answer' };
    state.overlay.awaitingTranscript = true;
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'scheduled-far': state } });

    useChatRuntimeV2Store.getState().setTranscript('scheduled-far', [
      // 90s（→ 90_000ms）早于 startedAt 10s，超出 2s 容差，不应判定为当前 run 的 user turn。
      { id: 'echo-user', role: 'user', content: 'scheduled prompt', timestamp: 90 },
      { id: 'echo-answer', role: 'assistant', content: 'current answer', timestamp: 108 },
    ]);

    const unsettled = useChatRuntimeV2Store.getState().sessionsByKey['scheduled-far'];
    // 没有 startedAt 之后的 user，transcriptContainsCompletedTurn 兜底失败，streaming 保留。
    expect(unsettled.overlay.streamingMessage).toMatchObject({ content: 'current answer' });
  });
});
