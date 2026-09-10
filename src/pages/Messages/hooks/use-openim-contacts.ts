import { useCallback, useEffect, useState } from 'react';
import { CbEvents, MessageType, SessionType } from '@openim/wasm-client-sdk';
import type { FriendUserItem } from '@openim/wasm-client-sdk';
import { getIMSDK } from '@/lib/openim/im-sdk';
import { mapSdkMessagesToUI } from '@/lib/openim/map-sdk-to-ui';
import {
  mapContactsToOrgMembers,
  mapFriendsToContacts,
  mapGroupsToContacts,
} from '@/lib/openim/map-contacts-to-ui';
import type { ImSearchResult } from '../components/im-global-search';
import type { IMContact, IMMessage } from '../types';

interface UseOpenIMContactsOptions {
  isSdkMode: boolean;
  mockColleagues: IMContact[];
  mockGroups: IMContact[];
  onOpenConversation: (conversationId: string) => void;
  refreshConversations: () => Promise<void>;
}

export function useOpenIMContacts({
  isSdkMode,
  mockColleagues,
  mockGroups,
  onOpenConversation,
  refreshConversations,
}: UseOpenIMContactsOptions) {
  const [colleagues, setColleagues] = useState<IMContact[]>(mockColleagues);
  const [groups, setGroups] = useState<IMContact[]>(mockGroups);

  const loadContacts = useCallback(async () => {
    const im = getIMSDK();
    if (!im) return;

    const [friendsResponse, groupsResponse] = await Promise.all([
      im.getFriendList(),
      im.getJoinedGroupList(),
    ]);

    setColleagues(mapFriendsToContacts(friendsResponse.data ?? []));
    setGroups(mapGroupsToContacts(groupsResponse.data ?? []));
    if (import.meta.env.DEV) {
      console.info('[OpenIM] loadContacts', {
        friends: friendsResponse.data?.length ?? 0,
        groups: groupsResponse.data?.length ?? 0,
      });
    }
  }, []);

  useEffect(() => {
    if (!isSdkMode) {
      setColleagues(mockColleagues);
      setGroups(mockGroups);
      return;
    }
    void loadContacts();
  }, [isSdkMode, loadContacts, mockColleagues, mockGroups]);

  useEffect(() => {
    if (!isSdkMode) return;
    const im = getIMSDK();
    if (!im) return;

    const refreshFriendsAndConversations = () => {
      void loadContacts();
      void refreshConversations();
    };

    const handleSyncFinished = () => {
      refreshFriendsAndConversations();
    };

    // Friend-application notifications can panic inside openim-sdk-core
    // (ServerFriendRequestToLocalFriendRequest). Even when callbacks still fire,
    // we must re-pull local friend + conversation lists so the UI catches up.
    im.on(CbEvents.OnSyncServerFinish, handleSyncFinished);
    im.on(CbEvents.OnSyncServerFailed, handleSyncFinished);
    im.on(CbEvents.OnFriendAdded, refreshFriendsAndConversations);
    im.on(CbEvents.OnFriendDeleted, refreshFriendsAndConversations);
    im.on(CbEvents.OnFriendInfoChanged, refreshFriendsAndConversations);
    im.on(CbEvents.OnFriendApplicationAccepted, refreshFriendsAndConversations);
    im.on(CbEvents.OnFriendApplicationAdded, refreshFriendsAndConversations);
    im.on(CbEvents.OnFriendApplicationRejected, refreshFriendsAndConversations);
    im.on(CbEvents.OnFriendApplicationDeleted, refreshFriendsAndConversations);

    return () => {
      im.off(CbEvents.OnSyncServerFinish, handleSyncFinished);
      im.off(CbEvents.OnSyncServerFailed, handleSyncFinished);
      im.off(CbEvents.OnFriendAdded, refreshFriendsAndConversations);
      im.off(CbEvents.OnFriendDeleted, refreshFriendsAndConversations);
      im.off(CbEvents.OnFriendInfoChanged, refreshFriendsAndConversations);
      im.off(CbEvents.OnFriendApplicationAccepted, refreshFriendsAndConversations);
      im.off(CbEvents.OnFriendApplicationAdded, refreshFriendsAndConversations);
      im.off(CbEvents.OnFriendApplicationRejected, refreshFriendsAndConversations);
      im.off(CbEvents.OnFriendApplicationDeleted, refreshFriendsAndConversations);
    };
  }, [isSdkMode, loadContacts, refreshConversations]);

  // Window focus / tab visible: recover after missed friend pushes or SDK listener panics.
  useEffect(() => {
    if (!isSdkMode) return;

    const refresh = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      void loadContacts();
      void refreshConversations();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isSdkMode, loadContacts, refreshConversations]);

  const openContactChat = useCallback(async (contact: IMContact): Promise<boolean> => {
    if (!isSdkMode || contact.kind === 'digital_employee') {
      return false;
    }

    const im = getIMSDK();
    if (!im) return false;

    const sessionType = contact.kind === 'group' ? SessionType.Group : SessionType.Single;
    const response = await im.getOneConversation({
      sourceID: contact.id,
      sessionType,
    });
    const conversationId = response.data?.conversationID;
    if (!conversationId) return false;

    await refreshConversations();
    onOpenConversation(conversationId);
    return true;
  }, [isSdkMode, onOpenConversation, refreshConversations]);

  const createGroup = useCallback(async (
    memberUserIDs: string[],
    groupName?: string,
  ): Promise<boolean> => {
    if (!isSdkMode || memberUserIDs.length < 2) return false;

    const im = getIMSDK();
    if (!im) return false;

    const response = await im.createGroup({
      memberUserIDs,
      groupInfo: {
        groupName: groupName?.trim() || '群聊',
      },
    });
    const groupID = response.data?.groupID;
    if (!groupID) return false;

    const conversationResponse = await im.getOneConversation({
      sourceID: groupID,
      sessionType: SessionType.Group,
    });

    await Promise.all([refreshConversations(), loadContacts()]);

    const conversationId = conversationResponse.data?.conversationID;
    if (conversationId) {
      onOpenConversation(conversationId);
    }
    return true;
  }, [isSdkMode, loadContacts, onOpenConversation, refreshConversations]);

  const globalSearch = useCallback(async (query: string): Promise<ImSearchResult[]> => {
    const keyword = query.trim();
    if (!isSdkMode || !keyword) return [];

    const im = getIMSDK();
    if (!im) return [];

    const [friendsResponse, groupsResponse] = await Promise.all([
      im.searchFriends({
        keywordList: [keyword],
        isSearchUserID: true,
        isSearchNickname: true,
        isSearchRemark: true,
      }),
      im.searchGroups({
        keywordList: [keyword],
        isSearchGroupID: true,
        isSearchGroupName: true,
      }),
    ]);

    const friendResults: ImSearchResult[] = (friendsResponse.data ?? []).map((friend) => ({
      id: `colleague:${friend.userID}`,
      kind: 'colleague',
      name: friend.remark || friend.nickname || friend.userID,
      subtitle: friend.nickname,
      avatarLabel: (friend.remark || friend.nickname || friend.userID).slice(0, 1),
      contact: mapFriendSearchToContact(friend),
    }));

    const groupResults: ImSearchResult[] = (groupsResponse.data ?? []).map((group) => ({
      id: `group:${group.groupID}`,
      kind: 'group',
      name: group.groupName || group.groupID,
      subtitle: group.memberCount ? `${group.memberCount} 人` : undefined,
      avatarLabel: (group.groupName || group.groupID).slice(0, 1),
      contact: mapGroupsToContacts([group])[0],
    }));

    return [...friendResults, ...groupResults];
  }, [isSdkMode]);

  const searchConversationMessages = useCallback(async (
    conversationID: string,
    keyword: string,
    loginUserID: string,
  ): Promise<IMMessage[]> => {
    const trimmed = keyword.trim();
    if (!isSdkMode || !trimmed) return [];

    const im = getIMSDK();
    if (!im) return [];

    const response = await im.searchLocalMessages({
      conversationID,
      keywordList: [trimmed],
      count: 50,
      messageTypeList: [
        MessageType.TextMessage,
        MessageType.AtTextMessage,
        MessageType.QuoteMessage,
        MessageType.PictureMessage,
        MessageType.FileMessage,
      ],
    });

    const items = response.data?.searchResultItems ?? response.data?.findResultItems ?? [];
    const target = items.find((item) => item.conversationID === conversationID) ?? items[0];
    if (!target?.messageList?.length) return [];

    return mapSdkMessagesToUI(target.messageList, loginUserID);
  }, [isSdkMode]);

  const createGroupMembers = isSdkMode
    ? mapContactsToOrgMembers(colleagues)
    : [];

  return {
    colleagues: isSdkMode ? colleagues : mockColleagues,
    groups: isSdkMode ? groups : mockGroups,
    createGroupMembers,
    loadContacts,
    openContactChat,
    createGroup,
    globalSearch,
    searchConversationMessages,
  };
}

function mapFriendSearchToContact(friend: FriendUserItem): IMContact {
  return mapFriendsToContacts([friend])[0];
}
