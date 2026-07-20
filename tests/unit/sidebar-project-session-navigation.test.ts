import { describe, expect, it } from 'vitest';
import {
  canRenameSidebarSession,
  handleSidebarSessionDoubleClick,
  sortProjectsByCreatedAt,
} from '../../src/lib/sidebar-project-session-navigation';
import { PROJECT_NEW_CHAT_DRAFT_KEY } from '../../src/stores/chat/types';
import type { WorkspaceDto } from '../../src/lib/session-catalog-api';

function workspace(
  id: string,
  createdAt: string,
): WorkspaceDto {
  return {
    id,
    name: id,
    rootPath: `/tmp/${id}`,
    isDefault: false,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('sidebar project and session navigation', () => {
  it('sorts projects by creation time descending without mutating input', () => {
    const input = [
      workspace('newest', '2026-07-17T03:00:00.000Z'),
      workspace('oldest', '2026-07-17T01:00:00.000Z'),
      workspace('middle', '2026-07-17T02:00:00.000Z'),
    ];

    expect(sortProjectsByCreatedAt(input).map(({ id }) => id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
    expect(input.map(({ id }) => id)).toEqual(['newest', 'oldest', 'middle']);
  });

  it('keeps invalid and equal timestamps in their original relative order', () => {
    const input = [
      workspace('missing-a', ''),
      workspace('same-a', '2026-07-17T01:00:00.000Z'),
      workspace('missing-b', 'invalid'),
      workspace('same-b', '2026-07-17T01:00:00.000Z'),
    ];

    expect(sortProjectsByCreatedAt(input).map(({ id }) => id)).toEqual([
      'same-a',
      'same-b',
      'missing-a',
      'missing-b',
    ]);
  });

  it('allows real sessions but rejects the project new-chat draft', () => {
    expect(canRenameSidebarSession('agent:main:session-1')).toBe(true);
    expect(canRenameSidebarSession(PROJECT_NEW_CHAT_DRAFT_KEY)).toBe(false);
  });

  it('starts rename on double-click behavior only for real sessions', () => {
    let renameCount = 0;
    const startRename = () => {
      renameCount += 1;
    };

    handleSidebarSessionDoubleClick('agent:main:session-1', startRename);
    handleSidebarSessionDoubleClick(PROJECT_NEW_CHAT_DRAFT_KEY, startRename);

    expect(renameCount).toBe(1);
  });
});
