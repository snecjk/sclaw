import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useContentHeader } from '@/components/layout/content-header-context';
import { ChatConversationColumn } from '@/components/chat/chat-conversation-column';
import { ChatFilesPanel } from './components/chat-files-panel';
import { ChatMessageSearchPanel } from './components/chat-message-search-panel';
import { ContactList } from './components/contact-list';
import { ConversationList } from './components/conversation-list';
import { ComposeBar } from './components/compose-bar';
import { ConversationToolbar } from './components/conversation-toolbar';
import { CreateGroupDialog } from './components/create-group-dialog';
import { MessagesEmptyState } from './components/empty-state';
import { OpenIMStatusBanner } from './components/openim-status-banner';
import { MessagesLeftTabs } from './components/messages-left-tabs';
import { MessagesListResizeHandle } from './components/messages-list-resize-handle';
import { ImGlobalSearch } from './components/im-global-search';
import { ImHeaderPlusMenu } from './components/im-header-plus-menu';
import { MessagePanel } from './components/message-panel';
import { SendArtifactDialog } from './components/send-artifact-dialog';
import { useMessagesListResize } from './hooks/use-messages-list-resize';
import { useOpenIMContacts } from './hooks/use-openim-contacts';
import { useOpenIMMessages } from './hooks/use-openim-messages';
import { MESSAGES_LIST_DEFAULT_WIDTH } from './lib/messages-list-resize-metrics';
import {
  messagesSubheaderBorderClass,
  messagesSubheaderHeightClass,
} from './lib/messages-subheader-metrics';
import {
  MOCK_ARTIFACTS,
  MOCK_CHAT_FILES,
  MOCK_COLLEAGUES,
  MOCK_CONVERSATIONS,
  MOCK_DIGITAL_EMPLOYEES,
  MOCK_GROUPS,
  MOCK_MESSAGES_BY_CONVERSATION,
  MOCK_ORG_DEPARTMENTS,
  MOCK_ORG_MEMBERS,
} from './mock-data';
import type { IMContact, IMOrgMember, MessagesLeftTab } from './types';

export function MessagesPage() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const params = useParams();
  const routeConversationId = params.conversationId ?? null;

  const [leftTab, setLeftTab] = useState<MessagesLeftTab>('conversations');
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);
  const [chatFilesPanelOpen, setChatFilesPanelOpen] = useState(false);
  const [chatSearchPanelOpen, setChatSearchPanelOpen] = useState(false);
  const [listWidth, setListWidth] = useState(MESSAGES_LIST_DEFAULT_WIDTH);
  const listPaneRef = useRef<HTMLElement>(null);
  const { startResize, adjustWidth, isResizing } = useMessagesListResize(listWidth, setListWidth, listPaneRef);

  const openConversation = useCallback((conversationId: string) => {
    navigate(`/messages/${conversationId}`);
  }, [navigate]);

  const activeConversationId = routeConversationId;
  const {
    connectionStatus,
    connectionError,
    isSdkMode,
    conversations,
    messages,
    sendRichHtml,
    loadMoreMessages,
    hasMoreHistory,
    loadingMoreHistory,
    loginUserID,
    refreshConversations,
    retryConnection,
    togglePinConversation,
    toggleMuteConversation,
    setConversations,
  } = useOpenIMMessages({
    activeConversationId,
    mockConversations: MOCK_CONVERSATIONS,
    mockMessagesByConversation: MOCK_MESSAGES_BY_CONVERSATION,
  });
  const {
    colleagues,
    groups,
    createGroupMembers,
    loadContacts,
    openContactChat,
    createGroup,
    globalSearch,
    searchConversationMessages,
  } = useOpenIMContacts({
    isSdkMode,
    mockColleagues: MOCK_COLLEAGUES,
    mockGroups: MOCK_GROUPS,
    onOpenConversation: openConversation,
    refreshConversations,
  });

  useEffect(() => {
    if (!isSdkMode) return;
    void loadContacts();
    void refreshConversations();
  }, [isSdkMode, leftTab, loadContacts, refreshConversations]);

  useEffect(() => {
    if (connectionStatus === 'error') {
      toast.error(connectionError
        ? `${t('im.connectFailed')}: ${connectionError}`
        : t('im.connectFailed'));
    }
  }, [connectionError, connectionStatus, t]);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  // Mock 模式：进入会话后标记已读
  useEffect(() => {
    if (isSdkMode || !activeConversationId) return;
    setConversations((prev) => prev.map((item) => (
      item.id === activeConversationId ? { ...item, unread: 0 } : item
    )));
  }, [activeConversationId, isSdkMode, setConversations]);

  const displayMessages = messages.length > 0 || isSdkMode
    ? messages
    : activeConversationId
      ? [
        {
          id: 'fallback',
          role: 'system' as const,
          contentType: 'text' as const,
          content: t('im.mockNoMessages'),
          time: '',
        },
      ]
      : [];

  const openContact = useCallback(async (contact: IMContact) => {
    if (contact.kind === 'digital_employee') {
      const existing = conversations.find((item) => item.id === `conv-${contact.id}`);
      if (existing) {
        openConversation(existing.id);
        return;
      }
      toast.message(t('im.mockContactOpened', { name: contact.name }));
      return;
    }

    if (isSdkMode) {
      try {
        const opened = await openContactChat(contact);
        if (opened) return;
      } catch (error) {
        const detail = error instanceof Error
          ? error.message
          : (error && typeof error === 'object' && 'errMsg' in error)
            ? String((error as { errMsg?: unknown }).errMsg ?? '')
            : t('im.connectFailed');
        toast.error(t('im.connectFailed'), { description: detail });
        return;
      }
    }

    const existing = conversations.find((item) => {
      if (contact.kind === 'group') {
        return item.type === 'group' && (item.id.includes(contact.id) || item.name === contact.name);
      }
      return item.type === 'single' && item.name === contact.name;
    });
    if (existing) {
      openConversation(existing.id);
      return;
    }
    toast.message(t('im.mockContactOpened', { name: contact.name }));
  }, [conversations, isSdkMode, openContactChat, openConversation, t]);

  const handlePickComposeImages = useCallback(async (): Promise<Array<File | string>> => {
    if (!isSdkMode) {
      toast.message(t('im.mockComposeAction', { action: t('im.attach') }));
      return [];
    }

    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        ],
      });
      if (result.canceled || !result.filePaths?.length) return [];
      return result.filePaths;
    } catch {
      toast.error(t('im.sendFileFailed'));
      return [];
    }
  }, [isSdkMode, t]);

  const handleSendRichHtml = useCallback(async (html: string, blobFiles: Map<string, File>) => {
    if (!isSdkMode) {
      toast.message(t('im.mockComposeAction', { action: t('im.send', { defaultValue: '发送' }) }));
      return;
    }
    try {
      await sendRichHtml(html, blobFiles);
    } catch (error) {
      const detail = error instanceof Error
        ? error.message
        : (error && typeof error === 'object' && 'errMsg' in error)
          ? String((error as { errMsg?: unknown }).errMsg ?? '')
          : '';
      toast.error(t('im.sendFileFailed'), detail ? { description: detail } : undefined);
    }
  }, [isSdkMode, sendRichHtml, t]);

  useContentHeader({
    title: t('im.title'),
    layoutMode: 'conversation',
    centerContent: (
      <ImGlobalSearch
        conversations={conversations}
        colleagues={colleagues}
        groups={groups}
        digitalEmployees={MOCK_DIGITAL_EMPLOYEES}
        onSelectConversation={openConversation}
        onSelectContact={openContact}
        remoteSearch={isSdkMode ? globalSearch : undefined}
      />
    ),
    chatActions: (
      <ImHeaderPlusMenu
        onAddFriend={() => toast.message(t('im.mockAddFriend'))}
        onCreateGroup={() => setCreateGroupDialogOpen(true)}
        onAddDigitalEmployee={() => {
          setLeftTab('contacts');
          toast.message(t('im.mockAddDigitalEmployee'));
        }}
      />
    ),
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <aside
        ref={listPaneRef}
        style={{ width: listWidth }}
        className="relative flex shrink-0 flex-col border-r border-[var(--sto-border-default)] bg-[var(--sto-surface-elevated)]"
      >
        <MessagesLeftTabs activeTab={leftTab} onChange={setLeftTab} />
        <OpenIMStatusBanner
          status={connectionStatus}
          error={connectionError}
          conversationCount={conversations.length}
          onRetry={connectionStatus === 'error' || connectionStatus === 'connecting' ? retryConnection : undefined}
        />

        {leftTab === 'conversations' ? (
          <ConversationList
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={openConversation}
          />
        ) : (
          <ContactList
            digitalEmployees={MOCK_DIGITAL_EMPLOYEES}
            colleagues={colleagues}
            groups={groups}
            onSelect={openContact}
          />
        )}
        <MessagesListResizeHandle
          valueNow={listWidth}
          isResizing={isResizing}
          onResizeStart={startResize}
          onKeyboardAdjust={adjustWidth}
        />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--sto-main-card-bg)]">
        <ChatConversationColumn variant="home" isSplitLayout={false}>
          {activeConversation ? (
            <>
              <ConversationToolbar
                conversation={activeConversation}
                onChatFiles={() => setChatFilesPanelOpen(true)}
                onAddMembers={() => setCreateGroupDialogOpen(true)}
                onSearchMessages={() => setChatSearchPanelOpen(true)}
                onTogglePin={isSdkMode ? () => {
                  void togglePinConversation(activeConversation.id, !activeConversation.pinned);
                } : undefined}
                onToggleMute={isSdkMode ? () => {
                  void toggleMuteConversation(activeConversation.id, !activeConversation.muted);
                } : undefined}
              />
              <MessagePanel
                title={activeConversation.name}
                messages={displayMessages}
                conversation={activeConversation}
                hasMoreHistory={hasMoreHistory}
                loadingMoreHistory={loadingMoreHistory}
                onLoadMore={loadMoreMessages}
              />
              <ComposeBar
                disabled={connectionStatus === 'connecting'}
                showAgentAction={activeConversation.type !== 'digital_employee'}
                onSendArtifact={() => setArtifactDialogOpen(true)}
                onSendRichHtml={handleSendRichHtml}
                onPickImageFiles={handlePickComposeImages}
              />
            </>
          ) : (
            <>
              <div
                className={cn(
                  'shrink-0 bg-[var(--sto-main-card-bg)]',
                  messagesSubheaderHeightClass,
                  messagesSubheaderBorderClass,
                )}
                aria-hidden
              />
              <MessagesEmptyState
                onStartChat={() => setLeftTab('contacts')}
                onCreateGroup={() => setCreateGroupDialogOpen(true)}
                onFindDigitalEmployee={() => {
                  setLeftTab('contacts');
                  openConversation('conv-agent-data');
                }}
              />
            </>
          )}
        </ChatConversationColumn>
      </section>

      <SendArtifactDialog
        open={artifactDialogOpen}
        artifacts={MOCK_ARTIFACTS}
        onOpenChange={setArtifactDialogOpen}
      />
      <CreateGroupDialog
        open={createGroupDialogOpen}
        departments={isSdkMode ? [] : MOCK_ORG_DEPARTMENTS}
        members={isSdkMode ? createGroupMembers : MOCK_ORG_MEMBERS}
        memberPickerMode={isSdkMode ? 'friends' : 'org'}
        onOpenChange={setCreateGroupDialogOpen}
        onConfirm={async (selectedMembers: IMOrgMember[], groupName?: string) => {
          if (isSdkMode) {
            const created = await createGroup(
              selectedMembers.map((member) => member.id),
              groupName,
            );
            if (created) {
              toast.success(
                groupName
                  ? t('im.groupCreatedWithName', { name: groupName })
                  : t('im.groupCreated'),
              );
            } else {
              toast.error(t('im.groupCreateFailed'));
            }
            return;
          }

          const names = selectedMembers.map((member) => member.name).join('、');
          toast.success(
            groupName
              ? t('im.mockGroupCreatedWithName', { name: groupName, members: names })
              : t('im.mockGroupCreated', { members: names }),
          );
        }}
      />
      <ChatFilesPanel
        open={chatFilesPanelOpen}
        files={MOCK_CHAT_FILES}
        onOpenChange={setChatFilesPanelOpen}
      />
      {activeConversation ? (
        <ChatMessageSearchPanel
          open={chatSearchPanelOpen}
          conversationName={activeConversation.name}
          messages={displayMessages}
          onOpenChange={setChatSearchPanelOpen}
          onSearchMessages={isSdkMode && activeConversationId
            ? (keyword) => searchConversationMessages(activeConversationId, keyword, loginUserID)
            : undefined}
        />
      ) : null}
    </div>
  );
}

export default MessagesPage;
