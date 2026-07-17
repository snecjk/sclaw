import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ID,
  isSessionInActiveWorkspace,
} from '@/stores/session-catalog';

describe('isSessionInActiveWorkspace', () => {
  const map = {
    'agent:main:session-1': DEFAULT_WORKSPACE_ID,
    'agent:main:session-2': 'project-a',
  };

  it('shows default-workspace sessions in global chat context', () => {
    expect(isSessionInActiveWorkspace('agent:main:session-1', null, map)).toBe(true);
    expect(isSessionInActiveWorkspace('agent:main:session-2', null, map)).toBe(false);
  });

  it('shows only bound sessions when a project is selected', () => {
    expect(isSessionInActiveWorkspace('agent:main:session-2', 'project-a', map)).toBe(true);
    expect(isSessionInActiveWorkspace('agent:main:session-1', 'project-a', map)).toBe(false);
  });

  it('treats unknown sessions as default workspace', () => {
    expect(isSessionInActiveWorkspace('agent:main:session-new', null, map)).toBe(true);
    expect(isSessionInActiveWorkspace('agent:main:session-new', 'project-a', map)).toBe(false);
  });
});
