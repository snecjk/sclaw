import { afterEach, describe, expect, it, vi } from 'vitest';

const { writePendingMock } = vi.hoisted(() => ({
  writePendingMock: vi.fn(async () => undefined),
}));

vi.mock('../../electron/utils/dingtalk-mention-pending', () => ({
  writeDingTalkMentionPending: (...args: unknown[]) => writePendingMock(...args),
}));

describe('preprocessChatSendParams', () => {
  afterEach(() => {
    writePendingMock.mockClear();
  });

  it('strips dingTalkMentions before gateway rpc', async () => {
    const { preprocessChatSendParams } = await import('../../electron/utils/dingtalk-mention-send');
    const result = await preprocessChatSendParams({
      sessionKey: 'agent:main:abc',
      message: '@李峥 你好',
      deliver: false,
      idempotencyKey: 'key-1',
      dingTalkMentions: [
        { type: 'user', displayName: '李峥', userId: 'uid-1' },
      ],
    }) as Record<string, unknown>;

    expect(result.dingTalkMentions).toBeUndefined();
    expect(result.sessionKey).toBe('agent:main:abc');
    expect(String(result.message)).toContain('[STOCLAW:DINGTALK_RECIPIENTS:v1]');
    expect(String(result.message)).toContain('用户消息：\n@李峥 你好');
    expect(writePendingMock).toHaveBeenCalledOnce();
  });

  it('injects file workflow when mentions and non-image attachments are present', async () => {
    const { preprocessChatSendParams } = await import('../../electron/utils/dingtalk-mention-send');
    const result = await preprocessChatSendParams({
      sessionKey: 'agent:main:abc',
      message: '@自研 Claw 发文件\n\n[media attached: /tmp/a.js (text/javascript) | /tmp/a.js]',
      dingTalkMentions: [
        { type: 'group', displayName: '自研 Claw', openConversationId: 'cid-1' },
      ],
      dingTalkSendFileIntent: true,
      dingTalkAttachedFiles: [{
        fileName: 'a.js',
        filePath: '/tmp/a.js',
        mimeType: 'text/javascript',
      }],
    }) as Record<string, unknown>;

    expect(String(result.message)).toContain('钉盘流程');
    expect(result.dingTalkAttachedFiles).toBeUndefined();
  });

  it('passes through regular messages unchanged', async () => {
    const { preprocessChatSendParams } = await import('../../electron/utils/dingtalk-mention-send');
    const input = {
      sessionKey: 'agent:main:abc',
      message: '帮我写周报',
      deliver: false,
      idempotencyKey: 'key-2',
    };
    const result = await preprocessChatSendParams(input);

    expect(result).toEqual(input);
    expect(writePendingMock).not.toHaveBeenCalled();
  });
});
