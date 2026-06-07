import {
  buildDingTalkFileSendWorkflowContext,
  shouldIncludeDingTalkFileSendWorkflow,
  type DingTalkAttachedFileHint,
} from './dingtalk-file-send';
import {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from './dingtalk-mention';

export type { DingTalkAttachedFileHint };
export { shouldIncludeDingTalkFileSendWorkflow };

export { DINGTALK_RECIPIENTS_MARKER, hasResolvedDingTalkMentions };
export type { DingTalkMention };

function buildRecipientPayload(mentions: DingTalkMention[]) {
  return mentions.map((mention) => {
    if (mention.type === 'user') {
      return {
        type: 'user' as const,
        displayName: mention.displayName,
        userId: mention.userId,
        corpId: mention.corpId,
      };
    }
    return {
      type: 'group' as const,
      displayName: mention.displayName,
      openConversationId: mention.openConversationId,
      corpId: mention.corpId,
    };
  });
}

function buildSendCommandHints(mentions: DingTalkMention[]): string[] {
  return mentions.flatMap((mention) => {
    if (mention.type === 'user' && mention.userId) {
      return [
        `- ${mention.displayName}: dws chat message send --user ${mention.userId} --text "<MESSAGE>" --format json`,
      ];
    }
    if (mention.type === 'group' && mention.openConversationId) {
      return [
        `- ${mention.displayName}: dws chat message send --group ${mention.openConversationId} --text "<MESSAGE>" --format json`,
      ];
    }
    return [];
  });
}

export function messageHasDingTalkRecipientContext(message: string): boolean {
  return message.includes(DINGTALK_RECIPIENTS_MARKER)
    || message.includes('<!-- StoClaw-DingTalk-Recipients: do-not-search -->')
    || message.includes('## StoClaw DingTalk Recipients');
}

/** Strip injected DingTalk recipient blocks for chat UI display. */
export function stripDingTalkMentionContextForDisplay(message: string): string {
  if (!messageHasDingTalkRecipientContext(message)) return message;

  const userMsgMarker = '\n用户消息：\n';
  const markerIndex = message.indexOf(userMsgMarker);
  if (markerIndex >= 0) {
    return message.slice(markerIndex + userMsgMarker.length).trim();
  }

  const legacySplit = message.split('\n---\n');
  if (legacySplit.length >= 2) {
    return legacySplit[legacySplit.length - 1].replace(/^用户消息：\n?/, '').trim();
  }

  return message;
}

export interface DingTalkMentionContextOptions {
  sendFileIntent?: boolean;
  attachedFiles?: DingTalkAttachedFileHint[];
}

export function buildDingTalkMentionSystemContext(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  const recipients = buildRecipientPayload(mentions);
  const sendCommandHints = buildSendCommandHints(mentions);
  const jsonBlock = JSON.stringify(
    {
      version: 1,
      source: 'stoclaw-input-mention',
      recipients,
    },
    null,
    2,
  );

  return [
    DINGTALK_RECIPIENTS_MARKER,
    '```json',
    jsonBlock,
    '```',
    '',
    '## StoClaw DingTalk Recipients（输入框 @ 已选定）',
    '',
    '以上 JSON 中的 userId / openConversationId 由用户在 StoClaw 输入框通过 @ 搜索并**手动选定**，与显示名一一对应，可直接用于发送。',
    '',
    '**必须遵守：**',
    '1. **禁止**对 JSON 内收件人执行 `dws contact user search`、`dws aisearch person` 或任何搜人/搜群命令',
    '2. **禁止**使用 OpenClaw `message` 工具（channel=dingtalk）或把 displayName 当作 target',
    '3. **必须**使用 `dws chat message send`，收件人参数只能取自 JSON（`--user` / `--group`）',
    '4. 发送前可与用户确认正文，或使用 `--dry-run`',
    '',
    '预填命令（将 `<MESSAGE>` 替换为实际正文后执行）：',
    ...sendCommandHints,
    ...(options?.sendFileIntent
      ? [buildDingTalkFileSendWorkflowContext(mentions, options.attachedFiles)]
      : []),
  ].join('\n');
}

/**
 * Wraps the user message with machine-readable DingTalk recipient metadata.
 * Recipients are placed at the top so the agent sees IDs before acting.
 */
export function appendDingTalkMentionContext(
  text: string,
  mentions?: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  if (!hasResolvedDingTalkMentions(mentions)) return text;

  const header = [
    buildDingTalkMentionSystemContext(mentions!, options),
    '',
    '---',
    '',
    '用户消息：',
    text,
  ].join('\n');

  return header;
}

export function ensureChatSendMessageWithDingTalkMentions(
  message: string,
  mentions?: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  if (!hasResolvedDingTalkMentions(mentions)) return message;
  if (messageHasDingTalkRecipientContext(message)) return message;
  return appendDingTalkMentionContext(message, mentions, options);
}

/** IPC/Main-only metadata; stripped before OpenClaw Gateway chat.send. */
export function buildDingTalkMentionRpcExtras(
  mentions?: DingTalkMention[],
  attachedFiles?: DingTalkAttachedFileHint[],
): Record<string, unknown> | undefined {
  if (!hasResolvedDingTalkMentions(mentions)) return undefined;

  const extras: Record<string, unknown> = { dingTalkMentions: mentions! };
  if (shouldIncludeDingTalkFileSendWorkflow(mentions, attachedFiles)) {
    extras.dingTalkSendFileIntent = true;
    extras.dingTalkAttachedFiles = attachedFiles!.filter((file) => !file.mimeType.startsWith('image/'));
  }
  return extras;
}
