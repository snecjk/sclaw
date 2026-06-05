import type { DingTalkAttachedFileHint } from '../../shared/dingtalk-file-send';
import {
  ensureChatSendMessageWithDingTalkMentions,
  hasResolvedDingTalkMentions,
  shouldIncludeDingTalkFileSendWorkflow,
  type DingTalkMention,
} from '../../shared/dingtalk-mention-context';
import { writeDingTalkMentionPending } from './dingtalk-mention-pending';

type ChatSendParams = Record<string, unknown> & {
  sessionKey?: string;
  message?: string;
  dingTalkMentions?: DingTalkMention[];
  dingTalkSendFileIntent?: boolean;
  dingTalkAttachedFiles?: DingTalkAttachedFileHint[];
};

function asDingTalkMentions(value: unknown): DingTalkMention[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const mentions = value.filter((item): item is DingTalkMention => {
    if (!item || typeof item !== 'object') return false;
    const record = item as DingTalkMention;
    return record.type === 'user' || record.type === 'group';
  });
  return mentions.length > 0 ? mentions : undefined;
}

function asAttachedFiles(value: unknown): DingTalkAttachedFileHint[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const files = value.filter((item): item is DingTalkAttachedFileHint => {
    if (!item || typeof item !== 'object') return false;
    const record = item as DingTalkAttachedFileHint;
    return typeof record.fileName === 'string'
      && typeof record.filePath === 'string'
      && typeof record.mimeType === 'string';
  });
  return files.length > 0 ? files : undefined;
}

/**
 * Inject DingTalk @ mention context into the Gateway message (Agent reads this),
 * stage pending metadata for the plugin, and strip IPC-only fields.
 * Chat UI strips the injected block on display — see stripDingTalkMentionContextForDisplay.
 */
export async function preprocessChatSendParams(params: unknown): Promise<unknown> {
  if (!params || typeof params !== 'object') return params;

  const chatParams = { ...(params as ChatSendParams) };
  const sessionKey = typeof chatParams.sessionKey === 'string' ? chatParams.sessionKey : '';
  const message = typeof chatParams.message === 'string' ? chatParams.message : '';
  const mentions = asDingTalkMentions(chatParams.dingTalkMentions);
  const attachedFiles = asAttachedFiles(chatParams.dingTalkAttachedFiles);
  const sendFileIntent = shouldIncludeDingTalkFileSendWorkflow(mentions, attachedFiles);

  // Gateway chat.send schema rejects unknown root properties.
  delete chatParams.dingTalkMentions;
  delete chatParams.dingTalkSendFileIntent;
  delete chatParams.dingTalkAttachedFiles;

  if (sessionKey && hasResolvedDingTalkMentions(mentions)) {
    chatParams.message = ensureChatSendMessageWithDingTalkMentions(message, mentions, {
      sendFileIntent,
      attachedFiles: sendFileIntent ? attachedFiles : undefined,
    });
    await writeDingTalkMentionPending(sessionKey, mentions!, message, {
      sendFileIntent,
      attachedFiles: sendFileIntent ? attachedFiles : undefined,
    });
  }

  return chatParams;
}
