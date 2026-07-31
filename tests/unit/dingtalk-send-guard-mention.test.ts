import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DINGTALK_RECIPIENTS_MARKER } from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-send/dingtalk-mention';
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
      registerTool: vi.fn(),
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
      { prompt: '总结一下和他的聊天', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-1', trigger: 'user' },
    );

    expect(readDingTalkMentionPending).toHaveBeenCalledWith('sess-1');
    expect(clearDingTalkMentionPending).toHaveBeenCalledWith('sess-1');
    expect(result?.appendSystemContext).toContain(DINGTALK_RECIPIENTS_MARKER);
    expect(result?.appendSystemContext).toContain('u-001');
    expect(result?.appendSystemContext).toContain('张三');
    expect(result?.appendSystemContext).toContain('本轮禁止发送');
    expect(result?.appendSystemContext).not.toContain('钉钉发送格式规则');
  });

  it('injects full send rules when @ turn has explicit send intent', async () => {
    readDingTalkMentionPending.mockResolvedValue({
      sessionKey: 'sess-send',
      mentions: [{ type: 'group', displayName: '开发群', openConversationId: 'cid-1' }],
      userText: '把总结发给这个群',
      writtenAt: Date.now(),
    });
    clearDingTalkMentionPending.mockResolvedValue(undefined);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: '把总结发给这个群', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-send', trigger: 'user' },
    );

    expect(result?.appendSystemContext).toContain('用户已明确要求发送');
    expect(result?.appendSystemContext).toContain('钉钉发送格式规则');
    expect(result?.appendSystemContext).toContain('dws chat message send --group cid-1');
  });

  it('still injects oral send guard when no pending mention cache exists', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: 'hello', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-empty', trigger: 'user' },
    );

    expect(result?.appendSystemContext).toContain('口头点名发送护栏');
    expect(clearDingTalkMentionPending).not.toHaveBeenCalled();
  });

  it('injects share_to_dingtalk prompt only for share-intent turns without @ recipients', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: '把这段内容分享到钉钉', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-share', trigger: 'user' },
    );

    expect(result?.appendSystemContext).toContain('share_to_dingtalk');
    expect(result?.appendSystemContext).not.toContain(DINGTALK_RECIPIENTS_MARKER);
  });

  it('injects oral dws send rules for named recipient without @', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: '发一条上海明天的天气给文鹏', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-oral', trigger: 'user' },
    );

    expect(result?.appendSystemContext).toContain('口头点名发送护栏');
    expect(result?.appendSystemContext).toContain('dws 搜人/查群工具');
    expect(result?.appendSystemContext).toContain('禁止**调用 `share_to_dingtalk`');
    expect(result?.appendSystemContext).not.toContain('钉钉分享内置工具');
  });

  it('prefers oral dws rules over share picker when both patterns could match', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: '把天气发给文鹏', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-oral-share', trigger: 'user' },
    );

    expect(result?.appendSystemContext).toContain('口头点名发送护栏');
    expect(result?.appendSystemContext).not.toContain('钉钉分享内置工具');
  });

  it('does not inject share prompt when @ recipients are pending', async () => {
    readDingTalkMentionPending.mockResolvedValue({
      sessionKey: 'sess-1',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '分享到钉钉',
      writtenAt: Date.now(),
    });
    clearDingTalkMentionPending.mockResolvedValue(undefined);

    const api = buildApi();
    register.register(api as unknown as OpenClawPluginApi);

    const result = await hooks.before_prompt_build(
      { prompt: '分享到钉钉', messages: [] },
      { agentId: 'agent-1', sessionKey: 'sess-1', trigger: 'user' },
    );

    expect(result?.appendSystemContext).toContain(DINGTALK_RECIPIENTS_MARKER);
    expect(result?.appendSystemContext).not.toContain('share_to_dingtalk');
  });
});
