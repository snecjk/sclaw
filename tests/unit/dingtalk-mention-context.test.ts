import { describe, expect, it } from 'vitest';
import {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  buildDingTalkMentionSystemContext,
  buildDingTalkMentionSystemContextForScheduledTask,
  ensureChatSendMessageWithDingTalkMentions,
  looksLikeDingTalkDriveUploadIntent,
  looksLikeDingTalkMentionSendIntent,
  parseDingTalkRecipientsFromText,
  stripDingTalkMentionContextForDisplay,
  messageHasDingTalkRecipientContext,
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

describe('looksLikeDingTalkDriveUploadIntent', () => {
  it('detects explicit DingTalk Drive upload requests', () => {
    expect(looksLikeDingTalkDriveUploadIntent('把报告上传到钉盘')).toBe(true);
    expect(looksLikeDingTalkDriveUploadIntent('保存到钉钉云盘')).toBe(true);
    expect(looksLikeDingTalkDriveUploadIntent('用钉盘分享这个文件')).toBe(true);
  });

  it('does not treat negated or unrelated mentions as drive upload requests', () => {
    expect(looksLikeDingTalkDriveUploadIntent('不要上传到钉盘')).toBe(false);
    expect(looksLikeDingTalkDriveUploadIntent('介绍一下钉盘功能')).toBe(false);
  });

  it('matches command-style sends with arbitrary content before the target', () => {
    expect(looksLikeDingTalkMentionSendIntent(
      '看一下最近三日上海天气情况，发送天气数据和截图到群聊 @Claw客户端开发测试群',
    )).toBe(true);
    expect(looksLikeDingTalkMentionSendIntent('发送运行结果和截图至 @测试群')).toBe(true);
  });

  it('does not turn negated or descriptive send phrases into send intent', () => {
    expect(looksLikeDingTalkMentionSendIntent('不要发送天气截图到群聊 @测试群')).toBe(false);
    expect(looksLikeDingTalkMentionSendIntent('查看别人发送到群里的截图')).toBe(false);
  });
});

describe('dingtalk mention context', () => {
  it('wraps send-intent user message with recipients + send rules', () => {
    const message = appendDingTalkMentionContext('给他们发：你好', [
      { type: 'user', displayName: '谷研硕', userId: 'uid-1' },
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
    ]);

    expect(message.startsWith('[STOCLAW:DINGTALK_RECIPIENTS:v1]')).toBe(true);
    expect(message).toContain('## SClaw DingTalk Recipients（对话 @ 已选定对象）');
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
    expect(message).toContain('只在 SClaw 对话中回复');
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

  it('recognizes both SClaw and legacy StoClaw recipient headings', () => {
    expect(messageHasDingTalkRecipientContext('## SClaw DingTalk Recipients（对话 @ 已选定对象）')).toBe(true);
    expect(messageHasDingTalkRecipientContext('## StoClaw DingTalk Recipients（对话 @ 已选定对象）')).toBe(true);
  });

  it('builds rpc extras only for resolved mentions', () => {
    const mentions = [
      { type: 'user' as const, displayName: '李峥', userId: 'uid-2' },
    ];
    expect(buildDingTalkMentionRpcExtras(mentions)).toEqual({ dingTalkMentions: mentions });
    expect(buildDingTalkMentionRpcExtras(undefined)).toBeUndefined();
  });

  it('adds online-link workflow extras when mentions and image/file attachments coexist', () => {
    const mentions = [{ type: 'group' as const, displayName: '自研 Claw', openConversationId: 'cid-1' }];
    const files = [{
      fileName: 'config.js',
      filePath: '/tmp/config.js',
      mimeType: 'text/javascript',
    }];
    const wrapped = appendDingTalkMentionContext('发给群', mentions, { sendFileIntent: true, attachedFiles: files });
    expect(wrapped).toContain('在线链接流程');
    expect(wrapped).toContain('upload_file_to_temp_oss');
    expect(wrapped).toContain('![文件名](在线地址)');
    expect(wrapped).toContain('[文件名](在线地址)');
    expect(wrapped).toContain('1. 优先调用 Agent 工具');
    expect(buildDingTalkMentionRpcExtras(mentions, files)).toEqual({
      dingTalkMentions: mentions,
      dingTalkSendFileIntent: true,
      dingTalkAttachedFiles: files,
    });
    const imageFiles = [{
      fileName: 'a.png',
      filePath: '/tmp/a.png',
      mimeType: 'image/png',
    }];
    expect(buildDingTalkMentionRpcExtras(mentions, imageFiles)).toEqual({
      dingTalkMentions: mentions,
      dingTalkSendFileIntent: true,
      dingTalkAttachedFiles: imageFiles,
    });
  });

  it('uses DingTalk Drive directly when the user explicitly requests it', () => {
    const mentions = [{ type: 'user' as const, displayName: '张三', userId: 'u-1' }];
    const files = [{
      fileName: 'report.pdf',
      filePath: '/tmp/report.pdf',
      mimeType: 'application/pdf',
    }];
    const wrapped = appendDingTalkMentionContext(
      '把这个文件上传到钉盘再发给张三',
      mentions,
      { sendFileIntent: true, attachedFiles: files },
    );

    expect(wrapped).toContain('用户已明确要求上传到钉盘/钉钉云盘');
    expect(wrapped).toContain('禁止调用 `upload_file_to_temp_oss`');
    expect(wrapped).toContain('1. 调用 `dws drive upload');
    expect(wrapped).not.toContain('1. 优先调用 Agent 工具');
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
    expect(ctx).toContain('在线链接流程');
    expect(ctx).toContain('upload_file_to_temp_oss');
  });
});
