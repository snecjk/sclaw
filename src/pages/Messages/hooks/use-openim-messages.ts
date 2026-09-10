import { useCallback, useEffect, useRef, useState } from 'react';
import { CbEvents, MessageReceiveOptType, ViewType } from '@openim/wasm-client-sdk';
import type {
  ConversationItem,
  GroupMessageReceiptInfo,
  MessageItem,
  ReceiptInfo,
  WSEvent,
} from '@openim/wasm-client-sdk';
import { getOpenIMBaseConfig } from '@/lib/openim/config';
import { getIMSDK, isOpenIMReady } from '@/lib/openim/im-sdk';
import { openimLog } from '@/lib/openim/openim-log';
import type { OpenIMConnectionStatus as GlobalOpenIMStatus } from '@/lib/openim/types';
import { useOpenIMSessionStore } from '@/stores/openim-session';
import {
  appendUniqueMessage,
  applyC2CReadReceiptToMessages,
  applyGroupReadReceiptToMessages,
  mapSdkConversationToUI,
  mapSdkMessageToUI,
  mapSdkMessagesToUI,
  mergeConversationList,
  prependUniqueMessages,
} from '@/lib/openim/map-sdk-to-ui';
import { createMessageFromFilePath, sendMessageToConversation } from '@/lib/openim/send-attachment';
import { prepareAndSendRichHtml } from '@/lib/openim/send-rich';
import { sanitizeImRichHtml } from '@/lib/openim/im-rich-html';
import type { IMConversation, IMMessage } from '../types';

export type OpenIMConnectionStatus = 'mock' | 'connecting' | 'ready' | 'error';

function mapSessionStatus(status: GlobalOpenIMStatus): OpenIMConnectionStatus {
  if (status === 'disabled') return 'mock';
  return status;
}

const HISTORY_PAGE_SIZE = 50;

interface ConversationHistoryMeta {
  isEnd: boolean;
  loading: boolean;
}

interface UseOpenIMMessagesOptions {
  activeConversationId: string | null;
  mockConversations: IMConversation[];
  mockMessagesByConversation: Record<string, IMMessage[]>;
}

function resolveConversationID(
  message: MessageItem,
  conversations: Map<string, ConversationItem>,
  loginUserID: string,
): string | null {
  for (const [conversationID, conversation] of conversations) {
    if (conversation.groupID && message.groupID === conversation.groupID) {
      return conversationID;
    }
    if (!conversation.groupID) {
      const peerID = message.sendID === loginUserID ? message.recvID : message.sendID;
      if (conversation.userID === peerID) {
        return conversationID;
      }
    }
  }
  return null;
}

function cloneConversations(conversations: IMConversation[]): IMConversation[] {
  return conversations.map((item) => ({ ...item }));
}

function unwrapEventData<T>(payload: T | WSEvent<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as WSEvent<T>).data;
  }
  return payload as T;
}

function unwrapSdkListData<T>(data: unknown): T[] {
  if (!data) return [];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(data) ? data as T[] : [];
}

function updateConversationMessages(
  messagesByConversation: Record<string, IMMessage[]>,
  conversationID: string,
  updater: (messages: IMMessage[]) => IMMessage[],
): Record<string, IMMessage[]> {
  const current = messagesByConversation[conversationID] ?? [];
  return {
    ...messagesByConversation,
    [conversationID]: updater(current),
  };
}

export function useOpenIMMessages({
  activeConversationId,
  mockConversations,
  mockMessagesByConversation,
}: UseOpenIMMessagesOptions) {
  const baseConfig = getOpenIMBaseConfig();
  const sessionStatus = useOpenIMSessionStore((state) => state.status);
  const sessionError = useOpenIMSessionStore((state) => state.error);
  const sessionUserID = useOpenIMSessionStore((state) => state.userID);
  const totalUnread = useOpenIMSessionStore((state) => state.totalUnread);
  const setTotalUnread = useOpenIMSessionStore((state) => state.setTotalUnread);
  const retrySession = useOpenIMSessionStore((state) => state.retry);
  const connectionStatus = mapSessionStatus(sessionStatus);
  const [connectionError, setConnectionError] = useState<string | null>(sessionError);
  const [conversations, setConversations] = useState<IMConversation[]>(() => (
    baseConfig.enabled ? [] : cloneConversations(mockConversations)
  ));
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, IMMessage[]>>({});
  const [historyMetaByConversation, setHistoryMetaByConversation] = useState<
    Record<string, ConversationHistoryMeta>
  >({});
  const [loginUserID, setLoginUserID] = useState(sessionUserID ?? '');
  const sdkConversationsRef = useRef<Map<string, ConversationItem>>(new Map());
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const isSdkMode = connectionStatus === 'ready';

  const clearLocalUnread = useCallback((conversationID: string) => {
    setConversations((prev) => prev.map((item) => (
      item.id === conversationID ? { ...item, unread: 0 } : item
    )));
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!isOpenIMReady()) {
      openimLog('refreshConversations skipped: bootstrap incomplete');
      return;
    }
    const im = getIMSDK();
    if (!im) {
      openimLog('refreshConversations skipped: SDK not ready');
      return;
    }

    try {
      const [listResponse, unreadResponse] = await Promise.all([
        im.getAllConversationList(),
        im.getTotalUnreadMsgCount(),
      ]);
      const items = unwrapSdkListData<ConversationItem>(listResponse.data);
      sdkConversationsRef.current = new Map(items.map((item) => [item.conversationID, item]));
      const activeId = activeConversationIdRef.current;
      setConversations(items.map((item) => {
        const mapped = mapSdkConversationToUI(item);
        // Viewing a conversation should never keep a red unread badge.
        if (activeId && mapped.id === activeId) {
          return { ...mapped, unread: 0 };
        }
        return mapped;
      }));
      setTotalUnread(unreadResponse.data ?? 0);
      openimLog('refreshConversations', {
        count: items.length,
        totalUnread: unreadResponse.data ?? 0,
      });
    } catch (error) {
      openimLog('refreshConversations failed', error);
      throw error;
    }
  }, []);

  const markConversationRead = useCallback(async (conversationID: string) => {
    const im = getIMSDK();
    if (!im) return;

    // Optimistic UI clear — do not wait for SDK (IPC can lag).
    clearLocalUnread(conversationID);

    try {
      await im.markConversationMessageAsRead(conversationID);
      const unreadResponse = await im.getTotalUnreadMsgCount();
      setTotalUnread(unreadResponse.data ?? 0);
      openimLog('markConversationRead ok', { conversationID });
    } catch (error) {
      openimLog('markConversationRead failed', error);
    }
  }, [clearLocalUnread]);

  /** Group chats need explicit read receipts so senders can flip 未读 → 已读. */
  const sendGroupReadReceipts = useCallback(async (
    conversationID: string,
    clientMsgIDList: string[],
  ) => {
    const im = getIMSDK();
    const conversation = sdkConversationsRef.current.get(conversationID);
    if (!im || !conversation?.groupID || clientMsgIDList.length === 0) return;

    try {
      await im.sendGroupMessageReadReceipt({
        conversationID,
        clientMsgIDList,
      });
      openimLog('sendGroupReadReceipts ok', {
        conversationID,
        count: clientMsgIDList.length,
      });
    } catch (error) {
      openimLog('sendGroupReadReceipts failed', error);
    }
  }, []);

  const loadMessages = useCallback(async (conversationID: string, reset = true) => {
    const im = getIMSDK();
    if (!im) return;

    setHistoryMetaByConversation((prev) => ({
      ...prev,
      [conversationID]: {
        isEnd: reset ? false : prev[conversationID]?.isEnd ?? false,
        loading: true,
      },
    }));

    try {
      const response = await im.getAdvancedHistoryMessageList({
        conversationID,
        count: HISTORY_PAGE_SIZE,
        startClientMsgID: '',
        viewType: ViewType.History,
      });

      const messageList = response.data?.messageList ?? [];
      const mapped = mapSdkMessagesToUI(messageList, loginUserID);

      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationID]: mapped,
      }));
      setHistoryMetaByConversation((prev) => ({
        ...prev,
        [conversationID]: {
          isEnd: Boolean(response.data?.isEnd),
          loading: false,
        },
      }));

      const othersMsgIds = messageList
        .filter((item) => item.sendID && item.sendID !== loginUserID && item.clientMsgID)
        .map((item) => item.clientMsgID);
      void sendGroupReadReceipts(conversationID, othersMsgIds);
    } catch {
      setHistoryMetaByConversation((prev) => ({
        ...prev,
        [conversationID]: {
          isEnd: prev[conversationID]?.isEnd ?? false,
          loading: false,
        },
      }));
    }
  }, [loginUserID, sendGroupReadReceipts]);

  const loadMoreMessages = useCallback(async (conversationID: string) => {
    const im = getIMSDK();
    if (!im) return;

    const meta = historyMetaByConversation[conversationID];
    if (meta?.isEnd || meta?.loading) return;

    const currentMessages = messagesByConversation[conversationID] ?? [];
    const oldestMessageId = currentMessages[0]?.id ?? '';

    setHistoryMetaByConversation((prev) => ({
      ...prev,
      [conversationID]: {
        isEnd: prev[conversationID]?.isEnd ?? false,
        loading: true,
      },
    }));

    try {
      const response = await im.getAdvancedHistoryMessageList({
        conversationID,
        count: HISTORY_PAGE_SIZE,
        startClientMsgID: oldestMessageId,
        viewType: ViewType.History,
      });

      const messageList = response.data?.messageList ?? [];
      const mapped = mapSdkMessagesToUI(messageList, loginUserID);

      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationID]: prependUniqueMessages(prev[conversationID] ?? [], mapped),
      }));
      setHistoryMetaByConversation((prev) => ({
        ...prev,
        [conversationID]: {
          isEnd: Boolean(response.data?.isEnd),
          loading: false,
        },
      }));
    } catch {
      setHistoryMetaByConversation((prev) => ({
        ...prev,
        [conversationID]: {
          isEnd: prev[conversationID]?.isEnd ?? false,
          loading: false,
        },
      }));
    }
  }, [historyMetaByConversation, loginUserID, messagesByConversation]);

  const sendSdkMessage = useCallback(async (
    conversationID: string,
    message: MessageItem,
    optimistic?: IMMessage,
  ) => {
    const im = getIMSDK();
    const conversation = sdkConversationsRef.current.get(conversationID);
    if (!im || !conversation) return;

    if (optimistic) {
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationID]: appendUniqueMessage(prev[conversationID] ?? [], optimistic),
      }));
    }

    try {
      const sent = await sendMessageToConversation(im, conversation, message);
      if (!sent) return;

      const mapped = {
        ...mapSdkMessageToUI(sent, loginUserID),
        readStatus: 'sent' as const,
      };
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationID]: appendUniqueMessage(prev[conversationID] ?? [], mapped),
      }));
      void refreshConversations();
    } catch {
      if (optimistic) {
        setMessagesByConversation((prev) => updateConversationMessages(
          prev,
          conversationID,
          (messages) => messages.filter((item) => item.id !== optimistic.id),
        ));
      }
      throw new Error('send failed');
    }
  }, [loginUserID, refreshConversations]);

  useEffect(() => {
    setConnectionError(sessionError);
  }, [sessionError]);

  useEffect(() => {
    if (sessionUserID) {
      setLoginUserID(sessionUserID);
    }
  }, [sessionUserID]);

  useEffect(() => {
    openimLog('hook session', {
      enabled: baseConfig.enabled,
      sessionStatus,
      sessionUserID,
      inElectron: typeof window !== 'undefined' && Boolean(window.openIMRenderApi),
    });
  }, [baseConfig.enabled, sessionStatus, sessionUserID]);

  useEffect(() => {
    if (connectionStatus !== 'ready') {
      if (connectionStatus === 'mock') {
        openimLog('using mock conversations');
      }
      return;
    }

    void refreshConversations().catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await refreshConversations().catch((retryError) => {
        openimLog('refresh retry failed', retryError);
      });
    });
  }, [connectionStatus, refreshConversations]);

  const retryConnection = useCallback(() => {
    void (async () => {
      const im = getIMSDK();
      try {
        // Nudge long-conn / sync after friend-notification panics in openim-sdk-core.
        await im?.networkStatusChanged?.();
      } catch {
        // ignore
      }
      await retrySession();
      await refreshConversations().catch(() => undefined);
    })();
  }, [refreshConversations, retrySession]);

  // Recover missed conversation rows when the window becomes active again.
  useEffect(() => {
    if (connectionStatus !== 'ready') return;
    const onFocus = () => {
      void refreshConversations().catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [connectionStatus, refreshConversations]);

  useEffect(() => {
    const im = getIMSDK();
    if (!im || connectionStatus !== 'ready') return;

    const handleNewMessages = (payload: MessageItem[] | WSEvent<MessageItem[]>) => {
      const data = unwrapEventData(payload);
      const list = Array.isArray(data) ? data : [data];
      const activeId = activeConversationIdRef.current;
      let receivedInActive = false;
      const activeOthersMsgIds: string[] = [];

      for (const message of list) {
        const conversationID = resolveConversationID(message, sdkConversationsRef.current, loginUserID);
        if (activeId && conversationID === activeId) {
          receivedInActive = true;
          if (message.sendID && message.sendID !== loginUserID && message.clientMsgID) {
            activeOthersMsgIds.push(message.clientMsgID);
          }
        }
      }

      setMessagesByConversation((prev) => {
        let next = prev;
        for (const message of list) {
          const conversationID = resolveConversationID(message, sdkConversationsRef.current, loginUserID);
          if (!conversationID) continue;
          const mapped = mapSdkMessageToUI(message, loginUserID);
          // Skip friend/group notification payloads (raw JSON).
          if (!mapped.content && !mapped.mediaUrl) continue;
          next = {
            ...next,
            [conversationID]: appendUniqueMessage(next[conversationID] ?? [], mapped),
          };
        }
        return next;
      });

      if (receivedInActive && activeId) {
        // Viewing this chat — mark read so badge clears and peer gets C2C / group receipt.
        void markConversationRead(activeId);
        void sendGroupReadReceipts(activeId, activeOthersMsgIds);
      }
      void refreshConversations();
    };

    const handleConversationChanged = (payload: ConversationItem[] | WSEvent<ConversationItem[]>) => {
      const data = unwrapEventData(payload);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        sdkConversationsRef.current.set(item.conversationID, item);
      }
      const activeId = activeConversationIdRef.current;
      setConversations((prev) => {
        const merged = mergeConversationList(prev, items);
        if (!activeId) return merged;
        return merged.map((item) => (
          item.id === activeId ? { ...item, unread: 0 } : item
        ));
      });
    };

    const handleTotalUnreadChanged = (payload: number | WSEvent<number>) => {
      const data = unwrapEventData(payload);
      if (typeof data === 'number') {
        setTotalUnread(data);
      }
    };

    const handleSyncFinished = () => {
      void refreshConversations();
    };

    const handleFriendRelationChanged = () => {
      // Friend add/accept may arrive without a conversation event; re-pull list.
      void refreshConversations();
    };

    const handleC2CReadReceipt = (payload: ReceiptInfo[] | WSEvent<ReceiptInfo[]>) => {
      const data = unwrapEventData(payload);
      const receipts = Array.isArray(data) ? data : [data];
      openimLog('c2c read receipt', {
        count: receipts.length,
        msgIds: receipts.flatMap((item) => item.msgIDList ?? []),
      });
      // Apply across all loaded conversations — not only the active one.
      setMessagesByConversation((prev) => {
        const next: Record<string, IMMessage[]> = {};
        for (const [conversationID, messages] of Object.entries(prev)) {
          next[conversationID] = applyC2CReadReceiptToMessages(messages, receipts);
        }
        return next;
      });
    };

    const handleGroupReadReceipt = (
      payload: GroupMessageReceiptInfo | WSEvent<GroupMessageReceiptInfo>,
    ) => {
      const data = unwrapEventData(payload);
      const conversationID = data.conversationID;
      if (!conversationID) return;

      setMessagesByConversation((prev) => updateConversationMessages(
        prev,
        conversationID,
        (messages) => applyGroupReadReceiptToMessages(messages, data),
      ));
    };

    im.on(CbEvents.OnRecvNewMessages, handleNewMessages);
    im.on(CbEvents.OnConversationChanged, handleConversationChanged);
    im.on(CbEvents.OnNewConversation, handleConversationChanged);
    im.on(CbEvents.OnRecvC2CReadReceipt, handleC2CReadReceipt);
    im.on(CbEvents.OnRecvGroupReadReceipt, handleGroupReadReceipt);
    im.on(CbEvents.OnTotalUnreadMessageCountChanged, handleTotalUnreadChanged);
    im.on(CbEvents.OnSyncServerFinish, handleSyncFinished);
    im.on(CbEvents.OnSyncServerFailed, handleSyncFinished);
    im.on(CbEvents.OnFriendAdded, handleFriendRelationChanged);
    im.on(CbEvents.OnFriendApplicationAccepted, handleFriendRelationChanged);
    im.on(CbEvents.OnFriendDeleted, handleFriendRelationChanged);

    return () => {
      im.off(CbEvents.OnRecvNewMessages, handleNewMessages);
      im.off(CbEvents.OnConversationChanged, handleConversationChanged);
      im.off(CbEvents.OnNewConversation, handleConversationChanged);
      im.off(CbEvents.OnRecvC2CReadReceipt, handleC2CReadReceipt);
      im.off(CbEvents.OnRecvGroupReadReceipt, handleGroupReadReceipt);
      im.off(CbEvents.OnTotalUnreadMessageCountChanged, handleTotalUnreadChanged);
      im.off(CbEvents.OnSyncServerFinish, handleSyncFinished);
      im.off(CbEvents.OnSyncServerFailed, handleSyncFinished);
      im.off(CbEvents.OnFriendAdded, handleFriendRelationChanged);
      im.off(CbEvents.OnFriendApplicationAccepted, handleFriendRelationChanged);
      im.off(CbEvents.OnFriendDeleted, handleFriendRelationChanged);
    };
  }, [connectionStatus, loginUserID, markConversationRead, refreshConversations, sendGroupReadReceipts]);

  useEffect(() => {
    if (!isSdkMode || !activeConversationId) return;
    let cancelled = false;

    void (async () => {
      await loadMessages(activeConversationId, true);
      if (cancelled) return;
      // After history is visible, mark read so peer receives C2C receipt.
      await markConversationRead(activeConversationId);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConversationId, isSdkMode, loadMessages, markConversationRead]);

  const messages = activeConversationId
    ? (isSdkMode
      ? messagesByConversation[activeConversationId] ?? []
      : mockMessagesByConversation[activeConversationId] ?? [])
    : [];

  const activeHistoryMeta = activeConversationId
    ? historyMetaByConversation[activeConversationId]
    : undefined;

  const sendTextMessage = useCallback(async (text: string) => {
    if (!activeConversationId || !text.trim() || !isSdkMode) return;

    const im = getIMSDK();
    if (!im) return;

    const created = await im.createTextMessage(text.trim());
    const message = created.data;
    if (!message) return;

    const optimistic = {
      ...mapSdkMessageToUI(message, loginUserID),
      readStatus: 'sending' as const,
    };
    await sendSdkMessage(activeConversationId, message, optimistic);
  }, [activeConversationId, isSdkMode, loginUserID, sendSdkMessage]);

  const sendRichHtml = useCallback(async (html: string, blobFiles: Map<string, File>) => {
    if (!activeConversationId || !isSdkMode) return;

    const im = getIMSDK();
    const conversation = sdkConversationsRef.current.get(activeConversationId);
    if (!im || !conversation) return;

    const safePreviewHtml = sanitizeImRichHtml(html, { allowLocalImg: true });
    const optimisticId = `local-rich-${Date.now()}`;
    const optimistic: IMMessage = {
      id: optimisticId,
      role: 'self',
      contentType: 'rich',
      content: '[图文]',
      richHtml: safePreviewHtml,
      time: new Date().toISOString().slice(0, 19).replace('T', ' '),
      readStatus: 'sending',
    };
    setMessagesByConversation((prev) => ({
      ...prev,
      [activeConversationId]: appendUniqueMessage(prev[activeConversationId] ?? [], optimistic),
    }));

    try {
      const sent = await prepareAndSendRichHtml(im, conversation, html, blobFiles);
      if (!sent) {
        throw new Error('send rich empty');
      }
      const mapped = {
        ...mapSdkMessageToUI(sent, loginUserID),
        readStatus: 'sent' as const,
      };
      setMessagesByConversation((prev) => {
        const withoutOptimistic = (prev[activeConversationId] ?? []).filter((item) => item.id !== optimisticId);
        return {
          ...prev,
          [activeConversationId]: appendUniqueMessage(withoutOptimistic, mapped),
        };
      });
      void refreshConversations();
    } catch (error) {
      openimLog('sendRichHtml failed', error);
      setMessagesByConversation((prev) => updateConversationMessages(
        prev,
        activeConversationId,
        (messages) => messages.filter((item) => item.id !== optimisticId),
      ));
      throw error;
    }
  }, [activeConversationId, isSdkMode, loginUserID, refreshConversations]);

  const sendFilePaths = useCallback(async (filePaths: string[]) => {
    if (!activeConversationId || !isSdkMode || filePaths.length === 0) return;

    const im = getIMSDK();
    if (!im) return;

    for (const filePath of filePaths) {
      const message = await createMessageFromFilePath(im, filePath);
      if (!message) continue;

      const optimistic = {
        ...mapSdkMessageToUI(message, loginUserID),
        readStatus: 'sending' as const,
      };
      await sendSdkMessage(activeConversationId, message, optimistic);
    }
  }, [activeConversationId, isSdkMode, loginUserID, sendSdkMessage]);

  const togglePinConversation = useCallback(async (conversationID: string, pinned: boolean) => {
    if (!isSdkMode) return;
    const im = getIMSDK();
    if (!im) return;
    await im.pinConversation({ conversationID, isPinned: pinned });
    await refreshConversations();
  }, [isSdkMode, refreshConversations]);

  const toggleMuteConversation = useCallback(async (conversationID: string, muted: boolean) => {
    if (!isSdkMode) return;
    const im = getIMSDK();
    if (!im) return;
    await im.setConversationRecvMessageOpt({
      conversationID,
      opt: muted ? MessageReceiveOptType.NotNotify : MessageReceiveOptType.Normal,
    });
    await refreshConversations();
  }, [isSdkMode, refreshConversations]);

  return {
    connectionStatus,
    connectionError,
    isSdkMode,
    conversations,
    messages,
    loginUserID,
    totalUnread,
    sendTextMessage,
    sendRichHtml,
    sendFilePaths,
    loadMoreMessages: activeConversationId
      ? () => loadMoreMessages(activeConversationId)
      : undefined,
    hasMoreHistory: isSdkMode && Boolean(activeConversationId) && !activeHistoryMeta?.isEnd,
    loadingMoreHistory: Boolean(activeHistoryMeta?.loading),
    refreshConversations,
    retryConnection,
    togglePinConversation,
    toggleMuteConversation,
    setConversations,
  };
}
