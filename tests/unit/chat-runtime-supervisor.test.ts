import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  listActive: vi.fn(async () => []),
  prune: vi.fn(async () => undefined),
  upsert: vi.fn(async () => undefined),
  getByIdempotencyKey: vi.fn(async () => null),
  getLatestForSession: vi.fn(async () => null),
  getByOwner: vi.fn(async () => null),
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
    engine.getAdapterForSession.mockResolvedValue({
      chatCapabilities: {
        hasReliableRuntimeStatus: true,
        hasStructuredReasoningEvents: true,
        hasStructuredToolEvents: true,
        requiresHistoryProjection: false,
      },
      classifyFinalMessage: ({ message, phase }: { message?: unknown; phase?: string }) => {
        if (phase === 'completed') return 'completed';
        const content = message && typeof message === 'object'
          ? (message as { content?: unknown }).content
          : null;
        return Array.isArray(content) && content.some((block) => (
          block && typeof block === 'object' && (block as { type?: string }).type === 'tool_use'
        )) ? 'progress' : message == null ? 'awaiting_transcript' : 'completed';
      },
      inspectRun: vi.fn(async () => ({
        status: 'completed',
        transcriptRevision: 'stable',
        currentTurnMessages: [
          { role: 'user', content: 'question', timestamp: 1 },
          { id: 'assistant-1', role: 'assistant', content: 'hello', timestamp: 2 },
        ],
      })),
    });
  });

  it('publishes a monotonic canonical lifecycle and persists transitions', async () => {
    vi.useFakeTimers();
    try {
    const gateway = new EventEmitter() as GatewayManager;
    const supervisor = new ChatRuntimeSupervisor(gateway);
    const events: CanonicalChatEvent[] = [];
    supervisor.on('event', (value) => events.push(value));

    await supervisor.begin({
      sessionKey: 'agent:main:session-1',
      idempotencyKey: 'message-1',
      engineType: 'openclaw',
      displayText: 'question',
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
      message: { id: 'assistant-1', role: 'assistant', content: 'hello', timestamp: 2 },
    });
    await supervisor.handleEngineEvent({
      type: 'turn.completed',
      sessionKey: 'agent:main:session-1',
      runId: 'run-1',
      seq: 2,
    });
    await vi.advanceTimersByTimeAsync(300);

    expect(events.map((value) => value.type)).toEqual([
      'run.dispatching', 'run.accepted', 'message.delta', 'run.awaiting_transcript',
      'run.completed',
    ]);
    expect(events.map((value) => value.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(events[0]?.payload).toMatchObject({
      idempotencyKey: 'message-1',
      optimisticUserMessage: {
        id: 'message-1', role: 'user', content: 'question',
      },
    });
    expect(supervisor.get('agent:main:session-1')).toMatchObject({
      phase: 'completed',
      runId: 'run-1',
      sequence: 5,
      interruptCause: null,
    });
    expect(repository.upsert).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes transcript projection with a live event waiting on its adapter', async () => {
    vi.useFakeTimers();
    try {
      let resolveInspection!: (value: {
        status: 'completed';
        transcriptRevision: string;
        currentTurnMessages: Array<Record<string, unknown>>;
      }) => void;
      const firstInspection = new Promise<{
        status: 'completed';
        transcriptRevision: string;
        currentTurnMessages: Array<Record<string, unknown>>;
      }>((resolve) => { resolveInspection = resolve; });
      let resolveLiveAdapter!: (value: Record<string, unknown>) => void;
      const liveAdapter = new Promise<Record<string, unknown>>((resolve) => { resolveLiveAdapter = resolve; });
      const adapter = {
        chatCapabilities: { requiresHistoryProjection: false },
        classifyFinalMessage: ({ phase }: { phase?: string }) => (
          phase === 'completed' ? 'completed' as const : 'progress' as const
        ),
        inspectRun: vi.fn()
          .mockImplementationOnce(() => firstInspection)
          .mockResolvedValue({
            status: 'completed',
            transcriptRevision: 'stable',
            currentTurnMessages: [],
          }),
      };
      let adapterCalls = 0;
      engine.getAdapterForSession.mockImplementation(() => {
        adapterCalls += 1;
        return adapterCalls === 3 ? liveAdapter : Promise.resolve(adapter);
      });

      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (event) => events.push(event));
      await supervisor.begin({
        sessionKey: 'agent:main:serialized-settle',
        idempotencyKey: 'message-serialized-settle',
        engineType: 'openclaw',
      });
      await supervisor.handleEngineEvent({
        type: 'turn.completed',
        sessionKey: 'agent:main:serialized-settle',
        runId: 'run-serialized-settle',
        seq: 1,
      });
      await Promise.resolve();

      const liveEvent = supervisor.handleEngineEvent({
        type: 'message.delta',
        sessionKey: 'agent:main:serialized-settle',
        runId: 'run-serialized-settle',
        seq: 2,
        message: { id: 'live', role: 'assistant', content: 'live delta' },
      });
      await Promise.resolve();
      resolveInspection({
        status: 'completed',
        transcriptRevision: 'stable',
        currentTurnMessages: [
          { id: 'user', role: 'user', content: 'question', timestamp: Date.now() },
          { id: 'history', role: 'assistant', content: 'history projection' },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
      resolveLiveAdapter(adapter);
      await liveEvent;
      await vi.advanceTimersByTimeAsync(300);

      const sequences = events.map((event) => event.sequence);
      expect(new Set(sequences).size).toBe(sequences.length);
      expect(sequences).toEqual(sequences.map((_, index) => index + 1));
      expect(events.map((event) => event.type)).toEqual([
        'run.dispatching',
        'run.awaiting_transcript',
        'message.delta',
        'message.delta',
        'run.completed',
      ]);
      expect(supervisor.get('agent:main:serialized-settle')).toMatchObject({
        phase: 'completed', sequence: 5,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when persisted idempotency cannot be checked', async () => {
    repository.getByIdempotencyKey.mockRejectedValueOnce(new Error('sqlite unavailable'));
    const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
    const events: CanonicalChatEvent[] = [];
    supervisor.on('event', (event) => events.push(event));

    const result = await supervisor.begin({
      sessionKey: 'agent:main:fail-closed',
      idempotencyKey: 'message-fail-closed',
      engineType: 'openclaw',
    });

    expect(result).toMatchObject({ kind: 'unavailable' });
    expect(supervisor.get('agent:main:fail-closed')).toBeNull();
    expect(events).toEqual([]);
  });

  it('uses a six-hour hard deadline for an ordinary chat', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T08:00:00.000Z'));
    try {
      const startedAt = Date.now();
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);

      await supervisor.begin({
        sessionKey: 'agent:main:ordinary-six-hour-deadline',
        idempotencyKey: 'ordinary-message',
        engineType: 'claude',
      });

      expect(supervisor.get('agent:main:ordinary-six-hour-deadline')?.runtimePolicy).toMatchObject({
        origin: 'interactive',
        deadlineAt: startedAt + 6 * 60 * 60_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes transcript.updated after a pending terminal transcript settles late', async () => {
    vi.useFakeTimers();
    try {
      const inspectRun = vi.fn()
        .mockResolvedValueOnce({ status: 'completed', transcriptRevision: 'r1' })
        .mockResolvedValueOnce({ status: 'completed', transcriptRevision: 'r2' })
        .mockResolvedValueOnce({ status: 'completed', transcriptRevision: 'r3' })
        .mockResolvedValueOnce({ status: 'completed', transcriptRevision: 'r4' })
        .mockResolvedValueOnce({ status: 'completed', transcriptRevision: 'late' })
        .mockResolvedValueOnce({ status: 'completed', transcriptRevision: 'late' });
      engine.getAdapterForSession.mockResolvedValue({
        chatCapabilities: { requiresHistoryProjection: false },
        inspectRun,
      });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (event) => events.push(event));
      await supervisor.begin({
        sessionKey: 'agent:main:late-transcript',
        idempotencyKey: 'message-late-transcript',
        engineType: 'openclaw',
      });
      await supervisor.handleEngineEvent({
        type: 'turn.completed',
        sessionKey: 'agent:main:late-transcript',
        runId: 'run-late-transcript',
        seq: 1,
      });

      await vi.advanceTimersByTimeAsync(2_700);
      expect(events.find((event) => event.type === 'run.completed')?.payload).toMatchObject({
        transcriptPending: true,
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(events.at(-1)).toMatchObject({
        type: 'transcript.updated',
        payload: { transcriptRevision: 'late', confirmed: true },
      });
      expect(supervisor.get('agent:main:late-transcript')?.phase).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
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
        phase: 'reconciling', epoch: 5, sequence: 0, interruptCause: 'process_restart',
      });
      expect(supervisor.listActive()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a completed run terminal when acceptance arrives late', async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      await supervisor.begin({
        sessionKey: 'agent:main:late-acceptance',
        idempotencyKey: 'message-late',
        engineType: 'openclaw',
      });
      await supervisor.handleEngineEvent({
        type: 'turn.completed',
        sessionKey: 'agent:main:late-acceptance',
        runId: 'run-late',
        seq: 1,
      });
      await vi.advanceTimersByTimeAsync(300);
      const terminalSequence = supervisor.get('agent:main:late-acceptance')?.sequence;
      await supervisor.accepted({
        sessionKey: 'agent:main:late-acceptance',
        idempotencyKey: 'message-late',
        runId: 'run-late',
        engineType: 'openclaw',
        result: { runId: 'run-late' },
      });
      expect(supervisor.get('agent:main:late-acceptance')).toMatchObject({
        phase: 'completed',
        sequence: terminalSequence,
        acceptanceResult: { runId: 'run-late' },
      });
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

  it('aborts the engine and publishes interrupted when a policy deadline expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T05:10:00.000Z'));
    try {
      const abortRun = vi.fn(async () => ({ success: true }));
      engine.getAdapterForSession.mockResolvedValue({ abortRun });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));
      const deadlineAt = Date.now() + 500;

      await supervisor.begin({
        sessionKey: 'agent:main:scheduled-deadline',
        idempotencyKey: 'scheduled-message',
        engineType: 'openclaw',
        runtimePolicy: {
          origin: 'scheduled_task',
          ownerId: 'schedule-run-1',
          deadlineAt,
        },
      });
      await vi.advanceTimersByTimeAsync(500);

      expect(abortRun).toHaveBeenCalledWith(
        expect.objectContaining({ gatewayManager: expect.anything() }),
        { sessionKey: 'agent:main:scheduled-deadline', runId: undefined },
      );
      expect(supervisor.get('agent:main:scheduled-deadline')).toMatchObject({
        phase: 'interrupted',
        interruptCause: 'hard_deadline',
        runtimePolicy: { origin: 'scheduled_task', ownerId: 'schedule-run-1', deadlineAt },
      });
      expect(events.at(-1)).toMatchObject({
        type: 'run.interrupted',
        payload: { reason: 'hard-deadline' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('only terminalizes an OpenClaw final when output no longer trails a tool use', async () => {
    vi.useFakeTimers();
    try {
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
    expect(supervisor.get('agent:main:session-4')?.phase).toBe('awaiting_transcript');
    await vi.advanceTimersByTimeAsync(300);
    expect(supervisor.get('agent:main:session-4')?.phase).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
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

  it('does not recovery-timeout a long silent skill when transcript later completes', async () => {
    vi.useFakeTimers();
    try {
      const origin = Date.now();
      engine.getAdapterForSession.mockResolvedValue({
        chatCapabilities: {
          hasReliableRuntimeStatus: false,
          hasStructuredReasoningEvents: false,
          hasStructuredToolEvents: false,
          requiresHistoryProjection: true,
        },
        getHistory: vi.fn(async () => ({
          success: true,
          result: { messages: [], isRunning: false },
        })),
        inspectRun: vi.fn(async () => {
          if (Date.now() - origin < 200_000) return { status: 'unknown' };
          return {
            status: 'completed',
            transcriptRevision: 'skill-done',
            currentTurnMessages: [
              { role: 'user', content: 'run skill', timestamp: origin / 1000 },
              { role: 'assistant', content: '生成成功', timestamp: (origin + 200_000) / 1000 },
            ],
          };
        }),
      });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));

      await supervisor.begin({
        sessionKey: 'agent:main:session-skill',
        idempotencyKey: 'skill-1',
        engineType: 'openclaw',
        displayText: 'run skill',
      });
      await supervisor.accepted({
        sessionKey: 'agent:main:session-skill',
        idempotencyKey: 'skill-1',
        runId: 'run-skill',
        engineType: 'openclaw',
      });
      await supervisor.handleEngineEvent({
        type: 'turn.started',
        sessionKey: 'agent:main:session-skill',
        runId: 'run-skill',
        seq: 1,
      });

      await vi.advanceTimersByTimeAsync(200_000);
      expect(events.some((event) => (
        event.type === 'run.interrupted'
        && (event.payload as { reason?: string })?.reason === 'recovery-timeout'
      ))).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(events.some((event) => (
        event.type === 'run.interrupted'
        && (event.payload as { reason?: string })?.reason === 'recovery-timeout'
      ))).toBe(false);
      expect(supervisor.get('agent:main:session-skill')?.phase).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps recovery idle alive while history projection still shows progress', async () => {
    vi.useFakeTimers();
    try {
      let projected = 0;
      engine.getAdapterForSession.mockResolvedValue({
        chatCapabilities: {
          hasReliableRuntimeStatus: false,
          hasStructuredReasoningEvents: false,
          hasStructuredToolEvents: false,
          requiresHistoryProjection: true,
        },
        getHistory: vi.fn(async () => {
          projected += 1;
          const now = Date.now() / 1000;
          return {
            success: true,
            result: {
              isRunning: false,
              messages: [
                {
                  role: 'user',
                  content: 'run skill',
                  timestamp: now,
                  idempotencyKey: 'skill-progress-1',
                },
                { role: 'assistant', content: `progress ${projected}`, timestamp: now },
              ],
            },
          };
        }),
        inspectRun: vi.fn(async () => ({ status: 'unknown' })),
      });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));

      await supervisor.begin({
        sessionKey: 'agent:main:session-skill-progress',
        idempotencyKey: 'skill-progress-1',
        engineType: 'openclaw',
        displayText: 'run skill',
      });
      await supervisor.rejected({
        sessionKey: 'agent:main:session-skill-progress',
        idempotencyKey: 'skill-progress-1',
        error: 'transport uncertain',
        uncertain: true,
      });

      await vi.advanceTimersByTimeAsync(150_000);
      expect(events.some((event) => event.type === 'run.interrupted')).toBe(false);
      expect(supervisor.get('agent:main:session-skill-progress')?.phase).not.toBe('interrupted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a longer recovery idle window for embed browser chat sessions', async () => {
    vi.useFakeTimers();
    try {
      const embedSessionKey = 'agent:main:session-embed-app-teambition_com-root--conv1';
      engine.getAdapterForSession.mockResolvedValue({
        chatCapabilities: {
          hasReliableRuntimeStatus: true,
          hasStructuredReasoningEvents: true,
          hasStructuredToolEvents: true,
          requiresHistoryProjection: false,
        },
        getHistory: vi.fn(async () => ({ success: true, result: { messages: [], isRunning: false } })),
        inspectRun: vi.fn(async () => null),
      });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));

      await supervisor.begin({
        sessionKey: embedSessionKey,
        idempotencyKey: 'embed-message-1',
        engineType: 'openclaw',
        displayText: 'open page',
      });
      await supervisor.rejected({
        sessionKey: embedSessionKey,
        idempotencyKey: 'embed-message-1',
        error: 'transport uncertain',
        uncertain: true,
      });

      await vi.advanceTimersByTimeAsync(135_000);
      expect(events.some((event) => event.type === 'run.interrupted')).toBe(false);
      expect(supervisor.get(embedSessionKey)?.phase).not.toBe('completed');

      await vi.advanceTimersByTimeAsync(165_000);
      expect(events.some((event) => (
        event.type === 'run.interrupted'
        && (event.payload as { reason?: string })?.reason === 'recovery-timeout'
      ))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('interrupts a normal chat session after the default recovery idle window', async () => {
    vi.useFakeTimers();
    try {
      engine.getAdapterForSession.mockResolvedValue({
        chatCapabilities: {
          hasReliableRuntimeStatus: true,
          hasStructuredReasoningEvents: true,
          hasStructuredToolEvents: true,
          requiresHistoryProjection: false,
        },
        getHistory: vi.fn(async () => ({ success: true, result: { messages: [], isRunning: false } })),
        inspectRun: vi.fn(async () => null),
      });
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));

      await supervisor.begin({
        sessionKey: 'agent:main:session-normal',
        idempotencyKey: 'normal-message-1',
        engineType: 'openclaw',
        displayText: 'hello',
      });
      await supervisor.rejected({
        sessionKey: 'agent:main:session-normal',
        idempotencyKey: 'normal-message-1',
        error: 'transport uncertain',
        uncertain: true,
      });

      await vi.advanceTimersByTimeAsync(135_000);
      expect(events.some((event) => (
        event.type === 'run.interrupted'
        && (event.payload as { reason?: string })?.reason === 'recovery-timeout'
      ))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('extends rate-limit finalization grace for embed browser chat sessions', async () => {
    vi.useFakeTimers();
    try {
      const embedSessionKey = 'agent:main:session-embed-app-teambition_com-root--conv2';
      const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
      const events: CanonicalChatEvent[] = [];
      supervisor.on('event', (value) => events.push(value));

      await supervisor.handleEngineEvent({
        type: 'turn.started',
        sessionKey: embedSessionKey,
        runId: 'embed-run-2',
        seq: 1,
      });
      await supervisor.handleEngineEvent({
        type: 'turn.failed',
        sessionKey: embedSessionKey,
        runId: 'embed-run-2',
        errorMessage: '429 rate limit exceeded',
        seq: 2,
      });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(events.some((event) => event.type === 'run.failed')).toBe(false);

      await vi.advanceTimersByTimeAsync(75_000);
      expect(events.some((event) => event.type === 'run.failed')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('copies the prior interrupt cause onto the next dispatch so resume can read latest', async () => {
    const supervisor = new ChatRuntimeSupervisor(new EventEmitter() as GatewayManager);
    await supervisor.begin({
      sessionKey: 'agent:main:inherit',
      idempotencyKey: 'message-1',
      engineType: 'claude',
    });
    await supervisor.rejected({
      sessionKey: 'agent:main:inherit',
      idempotencyKey: 'message-1',
      error: 'iterator_eof',
    });
    expect(supervisor.get('agent:main:inherit')).toMatchObject({
      phase: 'failed',
      interruptCause: 'stream_closed',
    });

    await supervisor.begin({
      sessionKey: 'agent:main:inherit',
      idempotencyKey: 'message-2',
      engineType: 'claude',
    });
    expect(supervisor.get('agent:main:inherit')).toMatchObject({
      phase: 'dispatching',
      interruptCause: 'stream_closed',
    });
  });
});
