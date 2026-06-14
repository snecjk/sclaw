import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DINGTALK_RECIPIENTS_MARKER } from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-mention-context';
import type { OpenClawPluginApi } from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/api.js';

const { readDingTalkMentionPending, clearDingTalkMentionPending } = vi.hoisted(() => ({
  readDingTalkMentionPending: vi.fn(),
  clearDingTalkMentionPending: vi.fn(),
}));

vi.mock('../../sto-plugin/openclaw/sto-dingtalk-send-guard/dingtalk-mention-pending.js', () => ({
  readDingTalkMentionPending,
  clearDingTalkMentionPending,
}));

import register from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/index.js';

describe('sto-dingtalk-send-guard before_prompt_build', () => {
  type HookHandler = (...args: unknown[]) => unknown;
  const hooks: Record<string, HookHandler> = {};

  function buildApi() {
    for (const key of Object.keys(hooks)) delete hooks[key];

    return {
      pluginConfig: {},
      config: {},
      id: 'sto-dingtalk-send-guard',
      name: '钉钉发送防护',
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      on: vi.fn((hookName: string, handler: HookHandler) => {
        hooks[hookName] = handler;
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    readDingTalkMentionPending.mockReset();
    clearDingTalkMentionPending.mockReset();
  });

  it('injects DingTalk mention context from pending cache', async () => {
    readDingTalkMentionPending.mockResolvedValue({
      sessionKey: 'sess-1',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '你好',
      writtenAt: Date.now(),
    });
    clearDingTalkMentionPending.mockResolvedValue(undefined);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: '你好', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-1', trigger: 'user' },
    );

    expect(readDingTalkMentionPending).toHaveBeenCalledWith('sess-1');
    expect(clearDingTalkMentionPending).toHaveBeenCalledWith('sess-1');
    expect(result?.appendSystemContext).toContain(DINGTALK_RECIPIENTS_MARKER);
    expect(result?.appendSystemContext).toContain('u-001');
    expect(result?.appendSystemContext).toContain('张三');
  });

  it('returns undefined when no pending mention cache exists', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: 'hello', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-empty', trigger: 'user' },
    );

    expect(result).toBeUndefined();
    expect(clearDingTalkMentionPending).not.toHaveBeenCalled();
  });
});
