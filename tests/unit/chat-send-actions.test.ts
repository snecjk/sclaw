import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialChatDataState } from '@/stores/chat/initial-state';
import type { ChatState } from '@/stores/chat/types';
import type { ChatSet } from '@/stores/chat/store-api';

vi.mock('@/stores/chat/resolve-send-target', () => ({
  resolveSendTarget: vi.fn(async () => ({
    sessionKey: 'agent:main:main',
    engineType: 'openclaw',
    dingTalkRpcExtras: {},
  })),
}));
vi.mock('@/stores/chat/prepare-send-context', () => ({
  prepareSendContext: vi.fn(async ({ trimmedText }: { trimmedText: string }) => ({
    displayText: trimmedText,
    messageWithContext: trimmedText,
  })),
}));
vi.mock('@/stores/chat/optimistic-turn', () => ({
  insertOptimisticUserTurn: vi.fn(() => ({ id: 'message-1', role: 'user', content: 'hello' })),
}));
vi.mock('@/stores/chat/media-preview-cache', () => ({ cacheUploadedAttachments: vi.fn() }));
vi.mock('@/stores/chat/dispatch-chat-request', () => ({ dispatchChatRequest: vi.fn() }));
vi.mock('@/lib/skill-plaza-resolve', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/skill-plaza-resolve')>(),
  resolveSkillPrompt: vi.fn(async (slug: string) => ({
    defaultPrompt: `Prompt for ${slug}`,
    title: slug,
  })),
}));

import { dispatchChatRequest } from '@/stores/chat/dispatch-chat-request';
import { prepareSendContext } from '@/stores/chat/prepare-send-context';
import { insertOptimisticUserTurn } from '@/stores/chat/optimistic-turn';
import { createSendActions } from '@/stores/chat/send-actions';
import { clearSendAttemptLocksForTests } from '@/stores/chat/send-attempt-lock';
import { useGatewayStore } from '@/stores/gateway';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';

function createHarness(normalize?: (args: unknown[]) => { text: string } & Record<string, unknown>) {
  let state = {
    ...initialChatDataState,
    newSession: vi.fn(),
  } as ChatState;
  const get = () => state;
  const set: ChatSet = (partial) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const actions = createSendActions(set, get, {
    normalizeSendMessageOptions: (args) => {
      if (normalize) return normalize(args) as ReturnType<typeof normalize>;
      const [first] = args;
      if (first && typeof first === 'object') return first as { text: string };
      return { text: 'hello' };
    },
    resolveMainSessionKeyForAgent: () => null,
    buildSessionSwitchPatch: () => ({}),
    resolveEngineTypeForSession: () => 'openclaw',
  });
  return { actions, get };
}

describe('chat send action acceptance state', () => {
  beforeEach(() => {
    clearSendAttemptLocksForTests();
    useChatRuntimeV2Store.setState({ sessionsByKey: {}, initialized: true });
    vi.mocked(dispatchChatRequest).mockReset();
    vi.mocked(insertOptimisticUserTurn).mockReset().mockReturnValue({
      id: 'message-1',
      role: 'user',
      content: 'hello',
    } as ReturnType<typeof insertOptimisticUserTurn>);
    vi.mocked(prepareSendContext).mockReset().mockImplementation(async ({ trimmedText }) => ({
      displayText: trimmedText,
      messageWithContext: trimmedText,
    }));
  });

  it('fails immediately on an explicit Gateway rejection', async () => {
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: false, error: 'rejected' });
    const { actions } = createHarness();

    await actions.sendMessage({ text: 'hello' });

    expect(dispatchChatRequest).toHaveBeenCalledTimes(1);
  });

  it('allows only one preparation attempt per session', async () => {
    let finishPreparation!: (value: {
      claudeMemorySystemPrompt: undefined;
      displayText: string;
      messageWithContext: string;
    }) => void;
    vi.mocked(prepareSendContext).mockImplementationOnce(() => new Promise((resolve) => {
      finishPreparation = resolve;
    }));
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: true, result: { runId: 'run-1' } });
    const { actions } = createHarness();

    const first = actions.sendMessage({ text: 'hello' });
    await vi.waitFor(() => expect(prepareSendContext).toHaveBeenCalledTimes(1));
    await actions.sendMessage({ text: 'hello again' });

    expect(prepareSendContext).toHaveBeenCalledTimes(1);
    finishPreparation({
      claudeMemorySystemPrompt: undefined,
      displayText: 'hello',
      messageWithContext: 'hello',
    });
    await first;
    expect(dispatchChatRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps the active run bound when abort RPC fails', async () => {
    const { actions } = createHarness();
    const session = createClientSessionState();
    session.runtime = {
      phase: 'running', runId: 'run-active', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 1, startedAt: 1, lastEventAt: 1,
    };
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'agent:main:main': session } });
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockRejectedValueOnce(new Error('abort failed'));

    const stopped = await actions.abortRun();

    expect(stopped).toBe(false);
    expect(rpc).toHaveBeenCalledWith('chat.abort', expect.objectContaining({
      sessionKey: 'agent:main:main',
    }));
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:main:main']?.runtime?.runId).toBe('run-active');
    rpc.mockRestore();
  });

  it('clears the active run only after abort RPC succeeds', async () => {
    const { actions } = createHarness();
    const session = createClientSessionState();
    session.runtime = {
      phase: 'running', runId: 'run-active', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 1, startedAt: 1, lastEventAt: 1,
    };
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'agent:main:main': session } });
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValueOnce({});

    const abortPromise = actions.abortRun();
    await expect(abortPromise).resolves.toBe(true);
    expect(useChatRuntimeV2Store.getState().sessionsByKey['agent:main:main']?.runtime?.runId).toBe('run-active');
    rpc.mockRestore();
  });

  it('hydrates local runtime when Gateway reports no active run to abort', async () => {
    const { actions } = createHarness();
    const session = createClientSessionState();
    session.runtime = {
      phase: 'running', runId: 'run-stale', idempotencyKey: 'message-1', engineType: 'openclaw',
      epoch: 1, sequence: 14, startedAt: 1, lastEventAt: 1,
    };
    useChatRuntimeV2Store.setState({ sessionsByKey: { 'agent:main:main': session } });
    const hydrate = vi.spyOn(useChatRuntimeV2Store.getState(), 'hydrate').mockResolvedValueOnce();
    const rpc = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValueOnce({
      ok: true, aborted: false, runIds: [],
    });

    await expect(actions.abortRun()).resolves.toBe(true);

    expect(hydrate).toHaveBeenCalledWith('agent:main:main');
    hydrate.mockRestore();
    rpc.mockRestore();
  });

  it('allows workflow-only sends with empty display text', async () => {
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: true, result: { runId: 'run-wf' } });
    const { actions } = createHarness();
    const gatewayText = '帮我执行 id 为：wf-1 的工作流 【日报】';

    await actions.sendMessage({
      text: '',
      gatewayText,
      workflows: [{ id: 'wf-1', name: '日报', source: 'mine' }],
      composerSegments: [{ type: 'workflow', id: 'wf-1', name: '日报', source: 'mine' }],
    });

    expect(insertOptimisticUserTurn).toHaveBeenCalled();
    expect(prepareSendContext).toHaveBeenCalledWith(expect.objectContaining({
      trimmedText: gatewayText,
    }));
    expect(dispatchChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      message: gatewayText,
      sourceText: '日报',
    }));
  });

  it('still rejects completely empty sends', async () => {
    const { actions } = createHarness();

    await actions.sendMessage({ text: '   ' });

    expect(insertOptimisticUserTurn).not.toHaveBeenCalled();
    expect(dispatchChatRequest).not.toHaveBeenCalled();
  });

  it('sends explicit skill composition without prompt prefixes or transcript markers', async () => {
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: true, result: { runId: 'run-1' } });
    const { actions } = createHarness();

    await actions.sendMessage({
      text: '分析财报',
      skillMetas: [
        { slug: 'skill-a', title: '技能A' },
        { slug: 'skill-b', title: '技能B' },
      ],
    });

    expect(prepareSendContext).toHaveBeenCalledTimes(1);
    const baked = vi.mocked(prepareSendContext).mock.calls[0]![0].trimmedText;
    expect(baked).toBe('分析财报');
    expect(baked).not.toContain('Prompt for');
    expect(baked).not.toContain('SClaw-Skill');
    expect(dispatchChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      composition: {
        version: 1,
        segments: [
          { type: 'text', text: '分析财报' },
          { type: 'skill', slug: 'skill-a', title: '技能A' },
          { type: 'skill', slug: 'skill-b', title: '技能B' },
        ],
      },
    }));
  });
});
