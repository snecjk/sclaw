import type { DingTalkAttachedFileHint } from '../../shared/dingtalk-send/dingtalk-file-send';
import { shouldIncludeDingTalkFileSendWorkflow } from '../../shared/dingtalk-send/dingtalk-file-send';
import {
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from '../../shared/dingtalk-send/dingtalk-mention';
import { prepareDingTalkAgentTurnMessage } from '../../shared/dingtalk-send/dingtalk-recipient-message';
import { writeDingTalkMentionPending } from './dingtalk-mention-pending';
import { logger } from './logger';

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

function summarizeMentions(mentions?: DingTalkMention[]): Array<Record<string, unknown>> {
  return mentions?.map((mention) => ({
    type: mention.type,
    displayName: mention.displayName,
    hasUserId: Boolean(mention.userId?.trim()),
    hasOpenConversationId: Boolean(mention.openConversationId?.trim()),
    hasCorpId: Boolean(mention.corpId?.trim()),
  })) ?? [];
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
  const resolvedMentions = hasResolvedDingTalkMentions(mentions);

  logger.info('[dingtalk-mention] preprocess: parsed params', {
    sessionKey: sessionKey || '(none)',
    rawMentionCount: Array.isArray(chatParams.dingTalkMentions) ? chatParams.dingTalkMentions.length : 0,
    acceptedMentionCount: mentions?.length ?? 0,
    mentions: summarizeMentions(mentions),
    resolvedMentions,
    attachedFileCount: attachedFiles?.length ?? 0,
    sendFileIntent,
    messageLength: message.length,
  });

  // Gateway chat.send schema rejects unknown root properties.
  delete chatParams.dingTalkMentions;
  delete chatParams.dingTalkSendFileIntent;
  delete chatParams.dingTalkAttachedFiles;

  if (sessionKey && resolvedMentions) {
    chatParams.message = prepareDingTalkAgentTurnMessage(message, mentions, {
      sendFileIntent,
      attachedFiles: sendFileIntent ? attachedFiles : undefined,
    });
    await writeDingTalkMentionPending(sessionKey, mentions!, message, {
      sendFileIntent,
      attachedFiles: sendFileIntent ? attachedFiles : undefined,
    });
    logger.info('[dingtalk-mention] preprocess: injected context and wrote pending cache', {
      sessionKey,
      mentionCount: mentions!.length,
      sendFileIntent,
      attachedFileCount: sendFileIntent ? attachedFiles?.length ?? 0 : 0,
      injectedMessageLength: typeof chatParams.message === 'string' ? chatParams.message.length : 0,
    });
  } else if (Array.isArray((params as ChatSendParams).dingTalkMentions) && (params as ChatSendParams).dingTalkMentions!.length > 0) {
    logger.warn('[dingtalk-mention] preprocess: skipped injection for unresolved mentions or missing sessionKey', {
      sessionKey: sessionKey || '(none)',
      acceptedMentionCount: mentions?.length ?? 0,
      mentions: summarizeMentions(mentions),
      resolvedMentions,
    });
  }

  return chatParams;
}
