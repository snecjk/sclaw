import { describe, expect, it } from 'vitest';
import {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  ensureChatSendMessageWithDingTalkMentions,
  hasResolvedDingTalkMentions,
  parseDingTalkRecipientsFromText,
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
    // 规则4：明确发送意图（含"把总结发给他"等代词句式）须识别为要求发送；未要求时禁止追问是否发送。
    expect(message).toContain('把总结发给他');
    expect(message).toContain('也禁止追问');
    // 规则5：已明确要求发送时直接发，不得回头问"需要我发送吗"。
    expect(message).toContain('不要回头追问');
    expect(message).toContain('需要我发送吗');
    // 规则4：单聊历史查询用 list-direct --user <userId>（无需 jq），并明确禁止 list-all+userId 过滤。
    expect(message).toContain('dws chat message list-direct --user <userId>');
    expect(message).toContain('无需 jq 过滤');
    expect(message).toContain('senderOpenDingTalkId');
    expect(message).toContain('按 userId 过滤必然全空');
    // 规则4 群聊 list 同样必填 --time（不传返空、误判无记录），时间固定取最近一个月、不得自由发挥，
    // 且必须 --forward=true（forward=false 会取 --time 之前的老消息、必然返空），空结果禁止当总结发钉钉。
    expect(message).toContain('--group <openConversationId> --time "<1个月前>" --forward=true --limit 50');
    expect(message).toContain('固定取最近一个月');
    expect(message).toContain('date -v-1m');
    expect(message).toContain('勿用 `--forward=false`');
    expect(message).toContain('不传 `--time` 也会返回空 `messages: []`');
    expect(message).toContain('间隔几秒重试 1-2 次再判定');
    expect(message).toContain('禁止把"无聊天记录/暂无记录/无权限"当总结发到钉钉');
    // 单聊段同样有重试守则
    expect(message).toMatch(/单聊读取.*偶发返空.*间隔几秒重试/);
    // 规则11：限流改"发起即计"（失败也占窗口），并明确被挡后不得用 sh -c/heredoc/sai-cli 绕过。
    expect(message).toContain('发起即计');
    expect(message).toContain('失败/重试也占窗口');
    expect(message).toContain('被挡时禁止绕过');
    expect(message).toContain('套壳照样命中');
    expect(message).toContain('等满 20 秒再发');
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

  it('parses recipients from a stored prompt template', () => {
    const wrapped = appendDingTalkMentionContext('执行工作流', [
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
      { type: 'group', displayName: '自研 Claw', openConversationId: 'cid-1' },
    ]);
    const parsed = parseDingTalkRecipientsFromText(wrapped);
    expect(parsed).toEqual([
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
      { type: 'group', displayName: '自研 Claw', openConversationId: 'cid-1' },
    ]);
  });

  it('returns null when no recipient block is present', () => {
    expect(parseDingTalkRecipientsFromText('普通任务，无收件人')).toBeNull();
    expect(parseDingTalkRecipientsFromText('')).toBeNull();
  });

  it('returns null when the json block is malformed', () => {
    const text = '[STOCLAW:DINGTALK_RECIPIENTS:v1]\n```json\n{not valid json\n```\n用户消息：\nhi';
    expect(parseDingTalkRecipientsFromText(text)).toBeNull();
  });
});
