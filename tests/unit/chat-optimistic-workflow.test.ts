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
vi.mock('@/stores/chat/media-preview-cache', () => ({ cacheUploadedAttachments: vi.fn() }));
vi.mock('@/stores/chat/dispatch-chat-request', () => ({ dispatchChatRequest: vi.fn() }));

import { dispatchChatRequest } from '@/stores/chat/dispatch-chat-request';
import { createSendActions } from '@/stores/chat/send-actions';
import { clearSendAttemptLocksForTests } from '@/stores/chat/send-attempt-lock';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { getSessionDisplayMessages } from '@/stores/chat/display-selectors';

const SESSION_KEY = 'agent:main:main';

function createHarness() {
  let state = {
    ...initialChatDataState,
    currentSessionKey: SESSION_KEY,
    newSession: vi.fn(),
    clearPendingWorkflow: vi.fn(),
  } as ChatState;
  const get = () => state;
  const set: ChatSet = (partial) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const actions = createSendActions(set, get, {
    normalizeSendMessageOptions: (args) => {
      const [first] = args;
      if (first && typeof first === 'object') return first as never;
      return { text: String(first) } as never;
    },
    resolveMainSessionKeyForAgent: () => null,
    buildSessionSwitchPatch: () => ({}),
    resolveEngineTypeForSession: () => 'openclaw',
  });
  return { actions, get };
}

describe('chat optimistic workflow-only send (real optimistic insert)', () => {
  beforeEach(() => {
    clearSendAttemptLocksForTests();
    const session = createClientSessionState();
    useChatRuntimeV2Store.setState({ sessionsByKey: { [SESSION_KEY]: session }, initialized: true });
    vi.mocked(dispatchChatRequest).mockReset();
  });

  it('surfaces the optimistic user turn with the workflow composer segment', async () => {
    vi.mocked(dispatchChatRequest).mockResolvedValue({ success: true, result: { runId: 'run-wf' } });
    const { actions } = createHarness();
    const gatewayText = '帮我执行 id 为：wf-1 的工作流 【日报】';

    await actions.sendMessage({
      text: '',
      gatewayText,
      workflows: [{ id: 'wf-1', name: '日报', source: 'mine' }],
      composerSegments: [{ type: 'workflow', id: 'wf-1', name: '日报', source: 'mine' }],
    });

    const display = getSessionDisplayMessages(SESSION_KEY);
    const userTurns = display.filter((m) => m.role === 'user');
    expect(userTurns.length).toBe(1);
    const wfSeg = userTurns[0]?._composerSegments?.find((s) => s.type === 'workflow');
    expect(wfSeg).toMatchObject({ id: 'wf-1', name: '日报' });
  });
});
