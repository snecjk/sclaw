import { MessageReceiveOptType, MessageStatus, MessageType, SessionType } from '@openim/wasm-client-sdk';
import type {
  ConversationItem,
  GroupMessageReceiptInfo,
  MessageItem,
  ReceiptInfo,
} from '@openim/wasm-client-sdk';
import type { IMConversation, IMMessage, IMMessageReadStatus } from '@/pages/Messages/types';
import { parseImRichPayload } from './im-rich-html';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatSdkTimestamp(ms: number): string {
  if (!ms) return '';
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function avatarLabelFromName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : '?';
}

function isNotificationMessage(contentType: MessageType): boolean {
  return contentType >= MessageType.FriendAdded;
}

function looksLikeRawJson(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function extractMessageText(message: MessageItem): string {
  if (message.textElem?.content) return message.textElem.content;
  if (message.atTextElem?.text) return message.atTextElem.text;
  if (message.advancedTextElem?.text) return message.advancedTextElem.text;
  if (message.quoteElem?.text) return message.quoteElem.text;
  // Friend/group notification payloads are raw JSON — never show them in UI.
  if (isNotificationMessage(message.contentType)) {
    return '';
  }
  if (message.notificationElem?.detail && !looksLikeRawJson(message.notificationElem.detail)) {
    return message.notificationElem.detail;
  }
  if (message.content && !looksLikeRawJson(message.content)) {
    return message.content;
  }
  if (message.contentType === MessageType.PictureMessage) return '[图片]';
  if (message.contentType === MessageType.FileMessage) return '[文件]';
  if (message.contentType === MessageType.VideoMessage) return '[视频]';
  if (message.contentType === MessageType.VoiceMessage) return '[语音]';
  if (message.contentType === MessageType.CustomMessage) {
    const rich = parseImRichPayload(message.customElem?.data);
    if (rich) return rich.plainText || '[图文]';
  }
  return '';
}

function parseLatestMsgPreview(latestMsg: string): string {
  if (!latestMsg) return '';
  try {
    const parsed = JSON.parse(latestMsg) as MessageItem;
    if (isNotificationMessage(parsed.contentType)) return '';
    const text = extractMessageText(parsed);
    return looksLikeRawJson(text) ? '' : text;
  } catch {
    return looksLikeRawJson(latestMsg) ? '' : latestMsg;
  }
}

function mapConversationType(conversationType: SessionType): IMConversation['type'] {
  return conversationType === SessionType.Single ? 'single' : 'group';
}

function mapReadStatus(message: MessageItem): IMMessageReadStatus | undefined {
  if (message.status === MessageStatus.Sending) return 'sending';

  const groupInfo = message.attachedInfoElem?.groupHasReadInfo;
  if (groupInfo && (groupInfo.groupMemberCount > 0 || groupInfo.hasReadCount > 0 || groupInfo.unreadCount > 0)) {
    return groupInfo.hasReadCount > 0 ? 'read' : 'sent';
  }

  if (message.isRead) return 'read';
  return 'sent';
}

function mapGroupReadReceipt(message: MessageItem): IMMessageGroupReadReceipt | undefined {
  const groupInfo = message.attachedInfoElem?.groupHasReadInfo;
  if (!groupInfo) return undefined;

  const memberCount = groupInfo.groupMemberCount
    || (groupInfo.hasReadCount + groupInfo.unreadCount)
    || 0;
  if (memberCount <= 0 && groupInfo.hasReadCount <= 0) return undefined;

  return {
    readCount: groupInfo.hasReadCount,
    memberCount: memberCount > 0 ? memberCount : Math.max(groupInfo.hasReadCount, 1),
  };
}

export function mapSdkConversationToUI(item: ConversationItem): IMConversation {
  return {
    id: item.conversationID,
    type: mapConversationType(item.conversationType),
    name: item.showName || item.userID || item.groupID || item.conversationID,
    avatarLabel: avatarLabelFromName(item.showName || item.userID || item.groupID || '?'),
    lastMessage: parseLatestMsgPreview(item.latestMsg),
    lastTime: formatSdkTimestamp(item.latestMsgSendTime),
    unread: item.unreadCount,
    pinned: item.isPinned,
    muted: item.recvMsgOpt === MessageReceiveOptType.NotNotify,
  };
}

export function mapSdkMessagesToUI(messages: MessageItem[], loginUserID: string): IMMessage[] {
  return messages
    .slice()
    .sort((left, right) => (left.sendTime || left.createTime) - (right.sendTime || right.createTime))
    // Hide SDK notification/system payloads (raw JSON friend/group events).
    .filter((message) => !isNotificationMessage(message.contentType))
    .map((message) => mapSdkMessageToUI(message, loginUserID))
    .filter((message) => message.content || message.mediaUrl || message.richHtml);
}

export function mapSdkMessageToUI(message: MessageItem, loginUserID: string): IMMessage {
  const isSelf = message.sendID === loginUserID;
  const isSystem = isNotificationMessage(message.contentType);

  const mapped: IMMessage = {
    id: message.clientMsgID || message.serverMsgID,
    role: isSystem ? 'system' : isSelf ? 'self' : 'other',
    senderName: message.senderNickname,
    senderAvatarLabel: avatarLabelFromName(message.senderNickname || message.sendID),
    contentType: 'text',
    content: extractMessageText(message),
    time: formatSdkTimestamp(message.sendTime || message.createTime),
  };

  if (message.contentType === MessageType.PictureMessage) {
    mapped.contentType = 'image';
    const snapshot = message.pictureElem?.snapshotPicture?.url;
    const big = message.pictureElem?.bigPicture?.url;
    const source = message.pictureElem?.sourcePicture?.url;
    // List bubble prefers smaller snapshot; lightbox prefers full-size.
    mapped.mediaUrl = snapshot || big || source;
    mapped.previewUrl = source || big || snapshot;
    mapped.content = '[图片]';
  } else if (message.contentType === MessageType.CustomMessage) {
    const rich = parseImRichPayload(message.customElem?.data);
    if (rich) {
      mapped.contentType = 'rich';
      mapped.richHtml = rich.html;
      mapped.content = rich.plainText || '[图文]';
    }
  } else if (message.contentType === MessageType.FileMessage) {
    mapped.contentType = 'file';
    mapped.fileName = message.fileElem?.fileName;
    mapped.content = message.fileElem?.fileName ?? '[文件]';
  }

  if (isSelf && !isSystem) {
    mapped.readStatus = mapReadStatus(message);
    mapped.groupReadReceipt = mapGroupReadReceipt(message);
  }

  return mapped;
}

export function applyC2CReadReceiptToMessages(
  messages: IMMessage[],
  receipts: ReceiptInfo[],
): IMMessage[] {
  const readIds = new Set(
    receipts.flatMap((receipt) => receipt.msgIDList ?? []),
  );
  if (readIds.size === 0) return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== 'self' || !readIds.has(message.id)) return message;
    if (message.readStatus === 'read') return message;
    changed = true;
    return { ...message, readStatus: 'read' as const };
  });
  return changed ? next : messages;
}

export function applyGroupReadReceiptToMessages(
  messages: IMMessage[],
  receipt: GroupMessageReceiptInfo,
): IMMessage[] {
  const readInfoByMsgId = new Map(
    receipt.groupMessageReadInfo.map((item) => [item.clientMsgID, item]),
  );
  if (readInfoByMsgId.size === 0) return messages;

  return messages.map((message) => {
    const readInfo = readInfoByMsgId.get(message.id);
    if (!readInfo || message.role !== 'self') return message;

    const memberCount = readInfo.hasReadCount + readInfo.unreadCount;
    return {
      ...message,
      readStatus: readInfo.hasReadCount > 0 ? 'read' as const : message.readStatus,
      groupReadReceipt: {
        readCount: readInfo.hasReadCount,
        memberCount: memberCount > 0 ? memberCount : readInfo.hasReadCount,
      },
    };
  });
}

export function prependUniqueMessages(existing: IMMessage[], older: IMMessage[]): IMMessage[] {
  const existingIds = new Set(existing.map((item) => item.id));
  const uniqueOlder = older.filter((item) => !existingIds.has(item.id));
  return [...uniqueOlder, ...existing];
}

export function appendUniqueMessage(existing: IMMessage[], message: IMMessage): IMMessage[] {
  if (existing.some((item) => item.id === message.id)) {
    return existing.map((item) => (item.id === message.id ? message : item));
  }
  return [...existing, message];
}

export function mergeConversationList(
  current: IMConversation[],
  updates: ConversationItem[],
): IMConversation[] {
  const next = new Map(current.map((item) => [item.id, item]));
  for (const update of updates) {
    next.set(update.conversationID, mapSdkConversationToUI(update));
  }
  return Array.from(next.values()).sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.lastTime.localeCompare(a.lastTime);
  });
}
