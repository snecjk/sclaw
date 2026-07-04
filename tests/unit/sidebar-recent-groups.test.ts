import { describe, expect, it } from 'vitest';
import { buildSidebarRecentGroupSections } from '@/lib/sidebar-recent-groups';
import type { SidebarRecentGroup } from '@/stores/sidebar-recent-groups';

type TestSession = { key: string; label?: string };

const sessions: TestSession[] = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'c', label: 'C' },
  { key: 'd', label: 'D' },
];

const groups: SidebarRecentGroup[] = [
  { id: 'g2', name: 'Group 2', createdAt: 200, updatedAt: 200 },
  { id: 'g1', name: 'Group 1', createdAt: 100, updatedAt: 100 },
];

describe('buildSidebarRecentGroupSections', () => {
  it('sorts groups by createdAt ascending', () => {
    const { groupedSections } = buildSidebarRecentGroupSections({
      groups,
      sessionsSortedByRecent: sessions,
      sessionGroupByKey: {},
    });
    expect(groupedSections.map((s) => s.group.id)).toEqual(['g1', 'g2']);
  });

  it('keeps relative session order within each group', () => {
    const { groupedSections } = buildSidebarRecentGroupSections({
      groups,
      sessionsSortedByRecent: sessions,
      sessionGroupByKey: { a: 'g1', c: 'g1', b: 'g2' },
    });
    expect(groupedSections[0]?.sessions.map((s) => s.key)).toEqual(['a', 'c']);
    expect(groupedSections[1]?.sessions.map((s) => s.key)).toEqual(['b']);
  });

  it('puts unassigned sessions in ungroupedSessions preserving order', () => {
    const { ungroupedSessions } = buildSidebarRecentGroupSections({
      groups,
      sessionsSortedByRecent: sessions,
      sessionGroupByKey: { a: 'g1' },
    });
    expect(ungroupedSessions.map((s) => s.key)).toEqual(['b', 'c', 'd']);
  });

  it('treats unknown groupId as ungrouped', () => {
    const { ungroupedSessions, groupedSections } = buildSidebarRecentGroupSections({
      groups,
      sessionsSortedByRecent: sessions,
      sessionGroupByKey: { b: 'missing' },
    });
    expect(ungroupedSessions.map((s) => s.key)).toContain('b');
    expect(groupedSections.every((s) => s.sessions.length === 0)).toBe(true);
  });

  it('retains empty groups in groupedSections', () => {
    const { groupedSections } = buildSidebarRecentGroupSections({
      groups,
      sessionsSortedByRecent: sessions,
      sessionGroupByKey: {},
    });
    expect(groupedSections).toHaveLength(2);
    expect(groupedSections[0]?.sessions).toEqual([]);
    expect(groupedSections[1]?.sessions).toEqual([]);
  });
});

describe('useSidebarRecentGroupsStore behavior (via import)', () => {
  it('dissolveGroup removes group and ungroups sessions', async () => {
    const { useSidebarRecentGroupsStore } = await import('@/stores/sidebar-recent-groups');
    useSidebarRecentGroupsStore.setState({
      groups: [{ id: 'g1', name: 'G1', createdAt: 1, updatedAt: 1 }],
      sessionGroupByKey: { sk1: 'g1', sk2: 'g1' },
      expandedGroupIds: { g1: true },
    });
    useSidebarRecentGroupsStore.getState().dissolveGroup('g1');
    const state = useSidebarRecentGroupsStore.getState();
    expect(state.groups).toEqual([]);
    expect(state.sessionGroupByKey).toEqual({});
    expect(state.expandedGroupIds).toEqual({});
  });

  it('removeSessionAssignment keeps empty group', async () => {
    const { useSidebarRecentGroupsStore } = await import('@/stores/sidebar-recent-groups');
    useSidebarRecentGroupsStore.setState({
      groups: [{ id: 'g1', name: 'G1', createdAt: 1, updatedAt: 1 }],
      sessionGroupByKey: { sk1: 'g1' },
      expandedGroupIds: {},
    });
    useSidebarRecentGroupsStore.getState().removeSessionAssignment('sk1');
    const state = useSidebarRecentGroupsStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.sessionGroupByKey).toEqual({});
  });

  it('createGroupAndAssignSession rejects empty name', async () => {
    const { useSidebarRecentGroupsStore } = await import('@/stores/sidebar-recent-groups');
    useSidebarRecentGroupsStore.setState({ groups: [], sessionGroupByKey: {}, expandedGroupIds: {} });
    const id = useSidebarRecentGroupsStore.getState().createGroupAndAssignSession('   ', 'sk1');
    expect(id).toBeNull();
  });
});
