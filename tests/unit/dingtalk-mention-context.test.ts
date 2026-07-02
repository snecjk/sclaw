import { describe, expect, it } from 'vitest';
import {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  ensureChatSendMessageWithDingTalkMentions,
  hasResolvedDingTalkMentions,
  stripDingTalkMentionContextForDisplay,
} from '../../shared/dingtalk-mention-context';

describe('dingtalk mention context', () => {
  it('wraps user message with json recipients at the top', () => {
    const message = appendDingTalkMentionContext('给他们发：你好', [
      { type: 'user', displayName: '谷研硕', userId: 'uid-1' },
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
    ]);

    expect(message.startsWith('[STOCLAW:DINGTALK_RECIPIENTS:v1]')).toBe(true);
    expect(message).toContain('"userId": "uid-1"');
    expect(message).toContain('"userId": "uid-2"');
    expect(message).toContain('dws chat message send --user uid-1');
    expect(message).toContain('dws chat message send --user uid-2');
    expect(message).toContain('禁止');
    expect(message).toContain('用户消息：\n给他们发：你好');
  });

  it('skips wrapping when mentions lack ids', () => {
    const text = '@谷研硕 你好';
    expect(appendDingTalkMentionContext(text, [
      { type: 'user', displayName: '谷研硕' },
    ])).toBe(text);
    expect(hasResolvedDingTalkMentions([
      { type: 'user', displayName: '谷研硕' },
    ])).toBe(false);
  });

  it('does not double-wrap when marker already exists', () => {
    const wrapped = appendDingTalkMentionContext('你好', [
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
    ]);
    const mentions = [{ type: 'user' as const, displayName: '李峥', userId: 'uid-2' }];
    expect(ensureChatSendMessageWithDingTalkMentions(wrapped, mentions)).toBe(wrapped);
  });

  it('strips injected block for chat display', () => {
    const wrapped = appendDingTalkMentionContext('@李峥 你好你好', [
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
    ]);
    expect(stripDingTalkMentionContextForDisplay(wrapped)).toBe('@李峥 你好你好');
  });

  it('returns empty when only the system marker is present', () => {
    expect(stripDingTalkMentionContextForDisplay('[STOCLAW:DINGTALK_RECIPIENTS:v1]\n')).toBe('');
  });

  it('builds rpc extras only for resolved mentions', () => {
    const mentions = [
      { type: 'user' as const, displayName: '李峥', userId: 'uid-2' },
    ];
    expect(buildDingTalkMentionRpcExtras(mentions)).toEqual({ dingTalkMentions: mentions });
    expect(buildDingTalkMentionRpcExtras(undefined)).toBeUndefined();
  });

  it('adds file workflow extras only when mentions and non-image attachments coexist', () => {
    const mentions = [{ type: 'group' as const, displayName: '自研 Claw', openConversationId: 'cid-1' }];
    const files = [{
      fileName: 'config.js',
      filePath: '/tmp/config.js',
      mimeType: 'text/javascript',
    }];
    const wrapped = appendDingTalkMentionContext('发给群', mentions, { sendFileIntent: true, attachedFiles: files });
    expect(wrapped).toContain('钉盘流程');
    expect(wrapped).toContain('drive upload');
    expect(buildDingTalkMentionRpcExtras(mentions, files)).toEqual({
      dingTalkMentions: mentions,
      dingTalkSendFileIntent: true,
      dingTalkAttachedFiles: files,
    });
    expect(buildDingTalkMentionRpcExtras(mentions, [{
      fileName: 'a.png',
      filePath: '/tmp/a.png',
      mimeType: 'image/png',
    }])).toEqual({ dingTalkMentions: mentions });
  });
});
