import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  listActive: vi.fn(async () => []),
  prune: vi.fn(async () => undefined),
  upsert: vi.fn(async () => undefined),
  getByIdempotencyKey: vi.fn(async () => null),
  getLatestForSession: vi.fn(async () => null),
}));
const engine = vi.hoisted(() => ({
  getAdapterForSession: vi.fn(),
}));

vi.mock('../../electron/db/repositories/chat-runtime-repository', () => ({
  getChatRuntimeRepository: () => repository,
}));

vi.mock('../../electron/engines/manager', () => ({
  getAdapterForSession: engine.getAdapterForSession,
}));

import { ChatRuntimeSupervisor } from '../../electron/services/chat-runtime-supervisor';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';

describe('main chat runtime supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.listActive.mockResolvedValue([]);
    repository.getByIdempotencyKey.mockResolvedValue(null);
    repository.getLatestForSession.mockResolvedValue(null);
    engine.getAdapterForSession.mockReset();
  });

  it('publishes a monotonic canonical lifecycle and persists transitions', async () => {
    const gateway = new EventEmitter() as GatewayManager;
    const supervisor = new ChatRuntimeSupervisor(gateway);
    const events: CanonicalChatEvent[] = [];
    supervisor.on('event', (value) => events.push(value));

    await supervisor.begin({
      sessionKey: 'agent:main:session-1',
      idempotencyKey: 'message-1',
      engineType: 'openclaw',
    });
    await supervisor.accepted({
      sessionKey: 'agent:main:session-1',
      idempotencyKey: 'message-1',
      runId: 'run-1',
      engineType: 'openclaw',
      result: { runId: 'run-1' },
    });
    await supervisor.handleEngineEvent({
      type: 'message.delta',
      sessionKey: 'agent:main:session-1',
      runId: 'run-1',
      seq: 1,
      message: { role: 'assistant', content: 'hello' },
    });
    await supervisor.handleEngineEvent({
      type: 'turn.completed',
      sessionKey: 'agent:main:session-1',
      runId: 'run-1',
      seq: 2,
    });

    expect(events.map((value) => value.type)).toEqual([
      'run.dispatching', 'run.accepted', 'message.delta', 'run.completed',
    ]);
    expect(events.map((value) => value.sequence)).toEqual([1, 2, 3, 4]);
    expect(supervisor.get('agent:main:session-1')).toMatchObject({
      phase: 'completed',
      runId: 'run-1',
      sequence: 4,
    });
    expect(repository.upsert).toHaveBeenCalled();
  });

  it('hydrates active runs into a new recovery epoch after main restart', async () => {
    vi.useFakeTimers();
    try {
      repository.listActive.mockResolvedValueOnce([{
        protocolVersion: 1,
        sessionKey: 'agent:main:recover',
        runId: 'run-recover',
        idempotencyKey: 'message-recover',
        engineType: 'openclaw',
        phase: 'running',
        epoch: 4,
        sequence: 12,
        startedAt: 100,
        lastEventAt: 200,
        terminalAt: null,
        error: null,
        acceptanceResult: { runId: 'run-recover' },
        updatedAt: 200,
      }]);
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      await supervisor.initialize();
      expect(supervisor.get('agent:main:recover')).toMatchObject({
        phase: 'reconciling', epoch: 5, sequence: 0,
      });
      expect(supervisor.listActive()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects duplicate engine events by run and source sequence', async () => {
    const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
    const events: CanonicalChatEvent[] = [];
    supervisor.on('event', (value) => events.push(value));
    const incoming = {
      type: 'turn.started' as const,
      sessionKey: 'agent:main:session-2',
      runId: 'run-2',
      seq: 1,
    };
    await supervisor.handleEngineEvent(incoming);
    await supervisor.handleEngineEvent(incoming);
    expect(events).toHaveLength(1);
  });

  it('keeps distinct no-sequence deltas while deduping identical payloads', async () => {
    const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
    const events: CanonicalChatEvent[] = [];
    supervisor.on('event', (value) => events.push(value));
    const base = { sessionKey: 'agent:main:session-noseq', runId: 'run-noseq' };
    await supervisor.handleEngineEvent({ ...base, type: 'message.delta', message: { content: 'a' } });
    await supervisor.handleEngineEvent({ ...base, type: 'message.delta', message: { content: 'b' } });
    await supervisor.handleEngineEvent({ ...base, type: 'message.delta', message: { content: 'b' } });
    expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(2);
  });

  it('projects current-turn reasoning and tool records from live OpenClaw history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T05:10:00.000Z'));
    try {
      const startedAt = Date.now();
      const getHistory = vi.fn(async () => ({
        success: true,
        result: {
          // Matches OpenClaw chat.history: it exposes transcript data without
          // the optional runtime isRunning flag.
          messages: [
            { role: 'user', content: '上海天气', timestamp: startedAt },
            {
              id: 'assistant-process-1',
              role: 'assistant',
              timestamp: startedAt + 10,
              content: [
                { type: 'thinking', thinking: '先分批查询。' },
                { type: 'tool_use', id: 'tool-1', name: 'exec', input: { command: 'weather' } },
              ],
            },
            {
              id: 'tool-result-1',
              role: 'toolresult',
              toolCallId: 'tool-1',
              timestamp: startedAt + 20,
              content: '晴天',
            },
          ],
        },
      }));
      engine.getAdapterForSession.mockResolvedValue({ getHistory });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));
      await supervisor.begin({
        sessionKey: 'agent:main:session-live-history',
        idempotencyKey: 'message-live-history',
        engineType: 'openclaw',
      });
      await supervisor.accepted({
        sessionKey: 'agent:main:session-live-history',
        idempotencyKey: 'message-live-history',
        runId: 'run-live-history',
        engineType: 'openclaw',
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'tool.updated')).toHaveLength(1);
      expect(events.find((event) => event.type === 'message.delta')?.payload).toMatchObject({
        id: 'assistant-process-1',
      });

      await vi.advanceTimersByTimeAsync(2_000);
      expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'tool.updated')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a run alive when a delta arrives during the error recovery grace period', async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));
      await supervisor.handleEngineEvent({
        type: 'turn.started', sessionKey: 'agent:main:session-3', runId: 'run-3', seq: 1,
      });
      await supervisor.handleEngineEvent({
        type: 'turn.failed', sessionKey: 'agent:main:session-3', runId: 'run-3', errorMessage: 'transient', seq: 2,
      });
      await supervisor.handleEngineEvent({
        type: 'message.delta', sessionKey: 'agent:main:session-3', runId: 'run-3', message: { content: 'recovered' }, seq: 3,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(events.some((event) => event.type === 'run.failed')).toBe(false);
      expect(supervisor.get('agent:main:session-3')?.phase).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('only terminalizes an OpenClaw final when output no longer trails a tool use', async () => {
    const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
    await supervisor.handleEngineEvent({
      type: 'turn.started', sessionKey: 'agent:main:session-4', runId: 'run-4', seq: 1,
    });
    await supervisor.handleEngineEvent({
      type: 'message.final',
      sessionKey: 'agent:main:session-4',
      runId: 'run-4',
      seq: 2,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will check.' },
          { type: 'tool_use', name: 'search' },
        ],
      },
    });
    expect(supervisor.get('agent:main:session-4')?.phase).toBe('running');
    await supervisor.handleEngineEvent({
      type: 'message.final',
      sessionKey: 'agent:main:session-4',
      runId: 'run-4',
      seq: 3,
      message: {
        role: 'assistant',
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'Finished.' }],
      },
    });
    expect(supervisor.get('agent:main:session-4')?.phase).toBe('completed');
  });

  it('waits for the current transcript turn before history reconciliation completes', async () => {
    vi.useFakeTimers();
    try {
      const getHistory = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          result: { isRunning: false, messages: [{ role: 'assistant', content: 'old answer' }] },
        })
        .mockResolvedValueOnce({
          success: true,
          result: {
            isRunning: false,
            messages: [
              { role: 'user', content: 'new question' },
              { role: 'assistant', content: 'new answer' },
            ],
          },
        });
      engine.getAdapterForSession.mockResolvedValue({ getHistory });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      await supervisor.begin({
        sessionKey: 'agent:main:session-reconcile',
        idempotencyKey: 'message-reconcile',
        engineType: 'openclaw',
      });
      await supervisor.rejected({
        sessionKey: 'agent:main:session-reconcile',
        idempotencyKey: 'message-reconcile',
        error: 'transport uncertain',
        uncertain: true,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(supervisor.get('agent:main:session-reconcile')?.phase).toBe('reconciling');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(supervisor.get('agent:main:session-reconcile')?.phase).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });
});
