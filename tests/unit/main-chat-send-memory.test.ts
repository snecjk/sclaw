import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearChatSendIdempotencyForTests } from '../../electron/api/routes/chat-send-idempotency';

const {
  prepareMock,
  beginMock,
  bindMock,
  rejectMock,
  runtimeBeginMock,
  runtimeAcceptedMock,
  runtimeRejectedMock,
  upsertPendingMock,
  markAcceptedMock,
  markRejectedMock,
  getSettingMock,
} = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  beginMock: vi.fn(),
  bindMock: vi.fn(),
  rejectMock: vi.fn(),
  runtimeBeginMock: vi.fn(),
  runtimeAcceptedMock: vi.fn(),
  runtimeRejectedMock: vi.fn(),
  upsertPendingMock: vi.fn(),
  markAcceptedMock: vi.fn(),
  markRejectedMock: vi.fn(),
  getSettingMock: vi.fn(),
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('../../electron/services/agent-memory-context-service', () => ({
  agentMemoryContextService: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

vi.mock('../../electron/services/memory-turn-coordinator', () => ({
  getMemoryTurnCoordinator: () => ({ begin: beginMock, bind: bindMock, reject: rejectMock }),
}));

vi.mock('../../electron/services/chat-runtime-supervisor', () => ({
  getChatRuntimeSupervisor: () => ({
    begin: runtimeBeginMock,
    accepted: runtimeAcceptedMock,
    rejected: runtimeRejectedMock,
  }),
}));

vi.mock('../../electron/db/repositories/chat-user-turn-composition-repository', () => ({
  getChatUserTurnCompositionRepository: () => ({
    upsertPending: upsertPendingMock,
    markAccepted: markAcceptedMock,
    markRejected: markRejectedMock,
  }),
}));

import { runMainChatSend } from '../../electron/services/chat-send-service';

describe('runMainChatSend memory boundary', () => {
  beforeEach(() => {
    clearChatSendIdempotencyForTests();
    vi.clearAllMocks();
    prepareMock.mockResolvedValue({
      preference: '<!-- StoClaw-Agent-Memory -->\n偏好\n<!-- StoClaw-Agent-Memory -->',
      execution: '<!-- StoClaw-Agent-Execution-Memory -->\n经验\n<!-- StoClaw-Agent-Execution-Memory -->',
      injectedExecutionMemories: [{ memoryId: 'e1', memory: '经验' }],
      displayMemories: [
        { kind: 'preference', memory: '偏好简洁输出' },
        { kind: 'execution', memory: '使用 sai-cli 查询' },
      ],
    });
    bindMock.mockResolvedValue(undefined);
    upsertPendingMock.mockResolvedValue(undefined);
    markAcceptedMock.mockResolvedValue(undefined);
    markRejectedMock.mockResolvedValue(undefined);
    runtimeBeginMock.mockImplementation(async (
      input: { sessionKey: string; idempotencyKey: string; engineType: 'openclaw' | 'claude' },
    ) => ({
      kind: 'created',
      snapshot: {
        ...input,
        protocolVersion: 1,
        runId: null,
        runtimePolicy: { origin: 'interactive', deadlineAt: null },
        phase: 'dispatching',
        epoch: 1,
        sequence: 1,
        startedAt: 1,
        lastEventAt: 1,
        terminalAt: null,
        error: null,
        acceptanceResult: null,
        updatedAt: 1,
      },
    }));
    getSettingMock.mockResolvedValue(true);
  });

  it('injects OpenClaw memory into the gateway message and binds the returned run', async () => {
    const dispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-1' } });
    const prepareInjection = vi.fn((params, memory) => ({
      ...params,
      message: `${params.message}\n\n${memory.preference}\n\n${memory.execution}`,
    }));
    const result = await runMainChatSend({} as never, {
      sessionKey: 'agent:main:main',
      message: '最终消息',
      sourceText: '原始问题',
      idempotencyKey: 'id-1',
      engineType: 'openclaw',
    }, prepareInjection, dispatch);
    expect(result.success).toBe(true);
    expect(prepareMock).toHaveBeenCalledWith('原始问题');
    expect(runtimeBeginMock).toHaveBeenCalledWith(expect.objectContaining({
      displayText: '原始问题',
    }));
    expect(prepareInjection).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('StoClaw-Agent-Execution-Memory'),
    }));
    expect(bindMock).toHaveBeenCalledWith({ sessionKey: 'agent:main:main', idempotencyKey: 'id-1', runId: 'run-1' });
  });

  it('emits live memory preparation progress with renderer-safe memory content', async () => {
    const emit = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-progress' } });

    await runMainChatSend({ emit } as never, {
      sessionKey: 'agent:main:progress',
      message: '查询数据',
      sourceText: '查询数据',
      idempotencyKey: 'progress-id',
      engineType: 'openclaw',
    }, (params) => params, dispatch);

    const emittedText = emit.mock.calls.map(([, payload]) => JSON.stringify(payload)).join('\n');
    expect(emittedText).toContain('正在检索相关记忆…');
    expect(emittedText).toContain('已检索到相关记忆');
    expect(emittedText).toContain('偏好简洁输出');
    expect(emittedText).toContain('使用 sai-cli 查询');
    expect(emittedText).not.toContain('StoClaw-Agent-Memory');
  });

  it('merges Claude memory into the existing system prompt without changing the message', async () => {
    const dispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-2' } });
    const prepareInjection = vi.fn((params, memory) => ({
      ...params,
      systemPromptAppend: [params.systemPromptAppend, memory.preference, memory.execution].filter(Boolean).join('\n\n'),
    }));
    await runMainChatSend({} as never, {
      sessionKey: 'agent:claude:main',
      message: '最终消息',
      sourceText: '原始问题',
      idempotencyKey: 'id-2',
      engineType: 'claude',
      systemPromptAppend: '已有系统提示',
    }, prepareInjection, dispatch);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      message: '最终消息',
      systemPromptAppend: expect.stringMatching(/^已有系统提示[\s\S]*偏好[\s\S]*经验/),
    }));
  });

  it('coalesces duplicate sends before retrieval and dispatch', async () => {
    const dispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-3' } });
    const prepareInjection = vi.fn((params) => params);
    const input = {
      sessionKey: 'agent:main:main', message: '消息', sourceText: '问题内容',
      idempotencyKey: 'same-id', engineType: 'openclaw' as const,
    };
    const [first, second] = await Promise.all([
      runMainChatSend({} as never, input, prepareInjection, dispatch),
      runMainChatSend({} as never, input, prepareInjection, dispatch),
    ]);
    expect(first).toEqual(second);
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not prepare memory or dispatch when runtime persistence is unavailable', async () => {
    runtimeBeginMock.mockResolvedValueOnce({
      kind: 'unavailable',
      error: 'CHAT_RUNTIME_UNAVAILABLE: sqlite unavailable',
    });
    const dispatch = vi.fn();
    const result = await runMainChatSend({} as never, {
      sessionKey: 'agent:main:main',
      message: '消息',
      idempotencyKey: 'unavailable-id',
      engineType: 'openclaw',
    }, vi.fn((params) => params), dispatch);

    expect(result).toEqual({ success: false, error: 'CHAT_RUNTIME_UNAVAILABLE: sqlite unavailable' });
    expect(prepareMock).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('skips memory read and write when memoryPolicy requests isolation', async () => {
    const dispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-bridge' } });
    const prepareInjection = vi.fn((params) => params);
    await runMainChatSend({} as never, {
      sessionKey: 'agent:main:bridge-ai:demo:c1',
      message: 'bridge prompt',
      sourceText: 'bridge prompt',
      idempotencyKey: 'bridge-id',
      engineType: 'openclaw',
      memoryPolicy: { skipRead: true, skipWrite: true },
    }, prepareInjection, dispatch);

    expect(prepareMock).not.toHaveBeenCalled();
    expect(beginMock).not.toHaveBeenCalled();
    expect(bindMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('skips remote memory retrieval when personalized memory is disabled', async () => {
    getSettingMock.mockResolvedValue(false);
    const emit = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-no-memory' } });
    const prepareInjection = vi.fn((params) => params);

    await runMainChatSend({ emit } as never, {
      sessionKey: 'agent:main:no-memory',
      message: '查询数据',
      sourceText: '查询数据',
      idempotencyKey: 'no-memory-id',
      engineType: 'openclaw',
    }, prepareInjection, dispatch);

    expect(getSettingMock).toHaveBeenCalledWith('personalizedMemoryEnabled');
    expect(prepareMock).not.toHaveBeenCalled();
    expect(prepareInjection).toHaveBeenCalledWith(
      expect.anything(),
      { injectedExecutionMemories: [] },
    );
    expect(beginMock).toHaveBeenCalledWith(expect.objectContaining({ memories: [] }));
    expect(emit).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('persists a structured turn only after preflight and tracks dispatch status', async () => {
    const normalizedTurn = {
      composition: { version: 1 as const, segments: [{ type: 'text' as const, text: '查询' }] },
      modelSegments: [{ type: 'text' as const, text: '查询' }],
      displayText: '查询',
      sourceText: '查询',
      modelText: '查询',
      attachments: [],
      selectedSkillSlugs: [],
      workflows: [],
      legacy: false,
    };
    const acceptedDispatch = vi.fn().mockResolvedValue({ success: true, result: { runId: 'run-sidecar' } });
    await runMainChatSend({} as never, {
      sessionKey: 'pi:main:sidecar',
      message: '查询',
      idempotencyKey: 'sidecar-accepted',
      engineType: 'pi',
      normalizedTurn,
    }, (params) => params, acceptedDispatch);

    expect(upsertPendingMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'pi:main:sidecar', idempotencyKey: 'sidecar-accepted', turn: normalizedTurn,
    }));
    expect(markAcceptedMock).toHaveBeenCalledWith(
      'pi:main:sidecar', 'sidecar-accepted', 'run-sidecar',
    );

    const rejectedDispatch = vi.fn().mockResolvedValue({ success: false, error: 'provider rejected' });
    await runMainChatSend({} as never, {
      sessionKey: 'pi:main:rejected',
      message: '查询',
      idempotencyKey: 'sidecar-rejected',
      engineType: 'pi',
      normalizedTurn,
    }, (params) => params, rejectedDispatch);
    expect(markRejectedMock).toHaveBeenCalledWith(
      'pi:main:rejected', 'sidecar-rejected', 'provider rejected',
    );
  });
});
