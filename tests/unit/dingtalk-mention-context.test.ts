import { describe, expect, it } from 'vitest';
import {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  buildDingTalkMentionSystemContext,
  buildDingTalkMentionSystemContextForScheduledTask,
  ensureChatSendMessageWithDingTalkMentions,
  looksLikeDingTalkMentionSendIntent,
  parseDingTalkRecipientsFromText,
  stripDingTalkMentionContextForDisplay,
} from '../../shared/dingtalk-prompts/dingtalk-mention-context';
import { hasResolvedDingTalkMentions } from '../../shared/dingtalk-send/dingtalk-mention';

describe('looksLikeDingTalkMentionSendIntent', () => {
  it('detects explicit send phrases', () => {
    expect(looksLikeDingTalkMentionSendIntent('发给张三')).toBe(true);
    expect(looksLikeDingTalkMentionSendIntent('把总结发给这个群')).toBe(true);
    expect(looksLikeDingTalkMentionSendIntent('给他们发：你好')).toBe(true);
  });

  it('rejects summarize / read-only phrases', () => {
    expect(looksLikeDingTalkMentionSendIntent('总结一下该群的聊天记录')).toBe(false);
    expect(looksLikeDingTalkMentionSendIntent('分析一下这个群最近讨论')).toBe(false);
    expect(looksLikeDingTalkMentionSendIntent('查看和李峥的聊天')).toBe(false);
    expect(looksLikeDingTalkMentionSendIntent('告诉我群里说了什么')).toBe(false);
  });
});

describe('dingtalk mention context', () => {
  it('wraps send-intent user message with recipients + send rules', () => {
    const message = appendDingTalkMentionContext('给他们发：你好', [
      { type: 'user', displayName: '谷研硕', userId: 'uid-1' },
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
    ]);

    expect(message.startsWith('[STOCLAW:DINGTALK_RECIPIENTS:v1]')).toBe(true);
    expect(message).toContain('"userId": "uid-1"');
    expect(message).toContain('"userId": "uid-2"');
    expect(message).toContain('dws chat message send --user uid-1');
    expect(message).toContain('dws chat message send --user uid-2');
    expect(message).toContain('用户已明确要求发送');
    expect(message).toContain('不要回头追问');
    expect(message).toContain('dws chat message list-direct --user <userId>');
    expect(message).toContain('发起即计');
  });

  it('for summarize-only @ turns, injects read-only block without send examples', () => {
    const message = appendDingTalkMentionContext('总结一下该群的聊天记录', [
      { type: 'group', displayName: 'Claw客户端开发群', openConversationId: 'cid-dev' },
    ]);

    expect(message).toContain('本轮禁止发送');
    expect(message).toContain('只在 StoClaw 对话中回复');
    expect(message).toContain('dws chat message list --group');
    expect(message).not.toContain('dws chat message send --group cid-dev');
    expect(message).not.toContain('钉钉发送格式规则');
    expect(message).not.toContain('发起即计');
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

describe('dingtalk mention context scenario split', () => {
  const mentions = [{ type: 'user' as const, displayName: '李峥', userId: 'uid-2' }];

  it('chat builder defaults to read-only (no send intent)', () => {
    const ctx = buildDingTalkMentionSystemContext(mentions);
    expect(ctx).toContain('本轮禁止发送');
    expect(ctx).toContain('dws chat message list-direct --user <userId>');
    expect(ctx).not.toContain('钉钉发送格式规则');
    expect(ctx).not.toContain('不要回头追问');
  });

  it('chat builder with explicitSendIntent includes send rules', () => {
    const ctx = buildDingTalkMentionSystemContext(mentions, { explicitSendIntent: true });
    expect(ctx).toContain('用户已明确要求发送');
    expect(ctx).toContain('不要回头追问');
    expect(ctx).toContain('钉钉发送格式规则');
  });

  it('scheduled-task builder makes send mandatory and drops read-history guidance', () => {
    const ctx = buildDingTalkMentionSystemContextForScheduledTask(mentions);
    expect(ctx).toContain('必须发送');
    expect(ctx).toContain('发送不是可选项');
    expect(ctx).toContain('指定即必发');
    expect(ctx).toContain('不要假设系统会自动发');
    expect(ctx).toContain('同一正文');
    expect(ctx).toContain('禁止回执上钉钉');
    expect(ctx).toContain('消息已发送至');
    expect(ctx).toContain('仅语法参考，非完整收件人清单');
    // 定时任务版规则 8（禁回执），不是对话版「成功后简短中文确认」
    expect(ctx).toContain('`--text` 只能是业务结果正文');
    expect(ctx).not.toContain('成功后简短中文确认即可');
    // 定时任务版去掉对话 @ 的"需明确意图"与"读历史/总结"段
    expect(ctx).not.toContain('不等于要求发送');
    expect(ctx).not.toContain('list-direct');
    expect(ctx).not.toContain('不要回头追问');
    // 收件人 JSON 块与发送格式规则仍共用
    expect(ctx).toContain('dws chat message send --user uid-2');
    expect(ctx).toContain('发起即计');
    expect(ctx).toContain('代发说明');
  });

  it('scheduled-task builder with workflowProgramDelivery forbids agent send and omits dws examples', () => {
    const ctx = buildDingTalkMentionSystemContextForScheduledTask(mentions, {
      workflowProgramDelivery: true,
    });
    expect(ctx).toContain('StoClaw DingTalk Recipients');
    expect(ctx).toContain('系统自动发送');
    expect(ctx).toContain('禁止 Agent 调用 `dws chat message send`');
    expect(ctx).not.toContain('指定即必发');
    expect(ctx).not.toContain('dws chat message send --user uid-2');
    expect(ctx).not.toContain('代发说明');
  });

  it('appendDingTalkMentionContext selects builder by scenario', () => {
    const st = appendDingTalkMentionContext('执行工作流', mentions, { scenario: 'scheduled-task' });
    expect(st).toContain('指定即必发');
    expect(st).not.toContain('本轮禁止发送');
    expect(st).toContain('用户消息：\n执行工作流');

    // 默认（不传 scenario）走 chat 版；无发送意图 → 只读
    const chat = appendDingTalkMentionContext('总结一下', mentions);
    expect(chat).toContain('本轮禁止发送');
    expect(chat).not.toContain('指定即必发');
    expect(chat).not.toContain('钉钉发送格式规则');
  });

  it('scheduled-task scenario still wraps files workflow context', () => {
    const files = [{
      fileName: 'config.js',
      filePath: '/tmp/config.js',
      mimeType: 'text/javascript',
    }];
    const ctx = appendDingTalkMentionContext('执行工作流', [
      { type: 'group' as const, displayName: '自研 Claw', openConversationId: 'cid-1' },
    ], { scenario: 'scheduled-task', sendFileIntent: true, attachedFiles: files });
    expect(ctx).toContain('指定即必发');
    expect(ctx).toContain('钉盘流程');
  });
});
