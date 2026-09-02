import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ invokeIpc }));
vi.mock('@/lib/host-events', () => ({ subscribeHostEvent: vi.fn(() => () => undefined) }));

import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import {
  flushPendingChatRuntimeDeltas,
  subscribeCanonicalChatRuntimeProjection,
  useChatRuntimeV2Store,
} from '@/stores/chat/runtime-v2-store';

function event(overrides: Partial<CanonicalChatEvent> = {}): CanonicalChatEvent {
  return {
    protocolVersion: 1,
    eventId: 'event-1',
    sessionKey: 'agent:main:session-batch',
    runId: 'run-1',
    idempotencyKey: 'message-1',
    engineType: 'openclaw',
    epoch: 1,
    sequence: 1,
    occurredAt: 100,
    type: 'run.started',
    ...overrides,
  };
}

function delta(sequence: number, content: string, sessionKey = 'agent:main:session-batch'): CanonicalChatEvent {
  return event({
    eventId: `delta-${sequence}`,
    sequence,
    sessionKey,
    type: 'message.delta',
    payload: { id: 'run-1', role: 'assistant', content },
  });
}

function session() {
  return useChatRuntimeV2Store.getState().sessionsByKey['agent:main:session-batch'];
}

describe('chat runtime delta 合帧（chat-thinking-perf 3.1）', () => {
  beforeEach(() => {
    invokeIpc.mockReset();
    // 排空上一用例可能排队的 delta，再重置 store
    flushPendingChatRuntimeDeltas();
    useChatRuntimeV2Store.setState({ sessionsByKey: {}, initialized: false });
  });

  it('同帧多个 delta 只提交一次 store 更新', () => {
    let commitCount = 0;
    const unsubscribe = useChatRuntimeV2Store.subscribe(() => {
      commitCount += 1;
    });
    const projected: CanonicalChatEvent[] = [];
    const unsubscribeProjection = subscribeCanonicalChatRuntimeProjection((event) => {
      projected.push(event);
    });

    useChatRuntimeV2Store.getState().applyEvent(event());
    expect(commitCount).toBe(1);

    useChatRuntimeV2Store.getState().applyEvent(delta(2, '第一'));
    useChatRuntimeV2Store.getState().applyEvent(delta(3, '第一第二'));
    useChatRuntimeV2Store.getState().applyEvent(delta(4, '第一第二第三'));

    // flush 前：delta 不产生任何 store 提交，也不发 projection
    expect(commitCount).toBe(1);
    expect(session()?.overlay.streamingMessage).toBeNull();
    expect(projected).toEqual([]);

    flushPendingChatRuntimeDeltas();

    // 一帧一次提交，三个 delta 全部按序生效
    expect(commitCount).toBe(2);
    expect(session()?.overlay.streamingMessage).toMatchObject({ content: '第一第二第三' });
    expect(session()?.runtime).toMatchObject({ phase: 'running', sequence: 4 });
    expect(projected.map((e) => e.sequence)).toEqual([2, 3, 4]);

    unsubscribe();
    unsubscribeProjection();
  });

  it('非 delta 事件（message.final）到来前立即 flush 排队 delta，不丢不乱序', () => {
    useChatRuntimeV2Store.getState().applyEvent(event());
    useChatRuntimeV2Store.getState().applyEvent(delta(2, '流式片段'));

    const accepted = useChatRuntimeV2Store.getState().applyEvent(event({
      eventId: 'final-3',
      sequence: 3,
      type: 'message.final',
      payload: { id: 'assistant-1', role: 'assistant', content: '最终回复' },
    }));

    // 无需手动 flush：delta 已在 final 前归约，final 当场生效
    expect(accepted).toBe(true);
    expect(session()?.overlay.streamingMessages.map((m) => m.id)).toEqual(['assistant-1']);
    expect(session()?.overlay.streamingMessage).toMatchObject({ content: '最终回复' });
    expect(session()?.runtime?.sequence).toBe(3);
  });

  it('clearSession 丢弃未提交的 delta，flush 不再重建会话', () => {
    useChatRuntimeV2Store.getState().applyEvent(event());
    useChatRuntimeV2Store.getState().applyEvent(delta(2, '将被丢弃'));
    useChatRuntimeV2Store.getState().clearSession('agent:main:session-batch');

    flushPendingChatRuntimeDeltas();
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:main:session-batch']).toBeUndefined();
  });

  it('hydrate 回放 pending delta 时直接生效，不再进合帧队列', async () => {
    // 预置一个 gapped 会话，pending 里有两个 delta
    const sessionKey = 'agent:main:session-hydrate';
    const base = createClientSessionState();
    base.sync.status = 'gapped';
    base.sync.pendingEvents = [
      delta(2, '片段一', sessionKey),
      delta(3, '片段一二', sessionKey),
    ];
    base.runtime = {
      phase: 'running',
      runId: 'run-1',
      idempotencyKey: 'msg-1',
      engineType: 'openclaw',
      epoch: 1,
      sequence: 1,
      startedAt: 100,
      lastEventAt: 100,
    };
    useChatRuntimeV2Store.setState({
      sessionsByKey: { [sessionKey]: base },
    });

    const projected: CanonicalChatEvent[] = [];
    const unsubscribeProjection = subscribeCanonicalChatRuntimeProjection((event) => {
      projected.push(event);
    });

    invokeIpc.mockResolvedValue(null);

    await useChatRuntimeV2Store.getState().hydrate(sessionKey);

    // hydrate 内应直接应用 delta，不依赖外部 flush；最后一条内容生效
    const hydrated = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey];
    expect(hydrated?.sync.status).toBe('ready');
    expect(hydrated?.overlay.streamingMessage).toMatchObject({ content: '片段一二' });
    expect(hydrated?.runtime?.sequence).toBe(3);
    // projection 通知在回放时同步发出
    expect(projected.map((e) => e.sequence)).toEqual([2, 3]);

    unsubscribeProjection();
  });

  it('setTranscript 前先对齐排队 delta，transcriptSettled 判断基于最新 overlay', () => {
    useChatRuntimeV2Store.getState().applyEvent(event());
    useChatRuntimeV2Store.getState().applyEvent(delta(2, '流式内容'));

    useChatRuntimeV2Store.getState().setTranscript('agent:main:session-batch', [
      { role: 'user', content: '问', timestamp: 1 },
    ]);
    expect(session()?.overlay.streamingMessage).toMatchObject({ content: '流式内容' });
  });

  it('clearOverlay 丢弃本会话排队 delta，flush 不会重建 overlay', () => {
    useChatRuntimeV2Store.getState().applyEvent(event());
    useChatRuntimeV2Store.getState().applyEvent(delta(2, '将被 clearOverlay 丢弃'));
    useChatRuntimeV2Store.getState().clearOverlay('agent:main:session-batch');

    flushPendingChatRuntimeDeltas();
    const s = session();
    expect(s?.overlay.streamingMessage).toBeNull();
    expect(s?.overlay.streamingMessages).toEqual([]);
  });
});
