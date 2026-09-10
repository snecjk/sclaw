import type { FriendUserItem, GroupItem } from '@openim/wasm-client-sdk';
import type { IMContact, IMOrgMember } from '@/pages/Messages/types';

function avatarLabelFromName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : '?';
}

export function mapFriendToContact(friend: FriendUserItem): IMContact {
  return {
    id: friend.userID,
    kind: 'colleague',
    name: friend.remark || friend.nickname || friend.userID,
    avatarLabel: avatarLabelFromName(friend.remark || friend.nickname || friend.userID),
    subtitle: friend.remark && friend.remark !== friend.nickname ? friend.nickname : undefined,
  };
}

export function mapGroupToContact(group: GroupItem): IMContact {
  return {
    id: group.groupID,
    kind: 'group',
    name: group.groupName || group.groupID,
    avatarLabel: avatarLabelFromName(group.groupName || group.groupID),
    subtitle: group.memberCount ? `${group.memberCount} 人` : undefined,
    memberCount: group.memberCount,
  };
}

export function mapFriendsToContacts(friends: FriendUserItem[]): IMContact[] {
  return friends.map(mapFriendToContact);
}

export function mapGroupsToContacts(groups: GroupItem[]): IMContact[] {
  return groups.map(mapGroupToContact);
}

export function mapContactsToOrgMembers(contacts: IMContact[]): IMOrgMember[] {
  return contacts
    .filter((contact) => contact.kind === 'colleague')
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.subtitle ?? '',
      departmentId: 'friends',
      avatarLabel: contact.avatarLabel,
    }));
}
