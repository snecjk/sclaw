import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_TILDE,
  getAgentWorkspaceTildePath,
  getLegacyAgentWorkspaceTildePath,
  migrateWorkspaceTildePath,
} from '../../shared/workspace-paths';

describe('workspace-paths', () => {
  it('uses shared default workspace for main agent', () => {
    expect(getAgentWorkspaceTildePath('main')).toBe(DEFAULT_WORKSPACE_TILDE);
    expect(getAgentWorkspaceTildePath('')).toBe(DEFAULT_WORKSPACE_TILDE);
  });

  it('uses managed workspace prefix for non-main agents', () => {
    expect(getAgentWorkspaceTildePath('research')).toBe('~/.stoclaw/workspace-research');
  });

  it('migrates legacy default workspace paths only', () => {
    expect(migrateWorkspaceTildePath('~/.stoclaw/openclaw/workspace')).toBe(DEFAULT_WORKSPACE_TILDE);
    expect(migrateWorkspaceTildePath('~/.stoclaw/openclaw/workspace-research')).toBe(
      '~/.stoclaw/workspace-research',
    );
    expect(migrateWorkspaceTildePath('/custom/workspace')).toBe('/custom/workspace');
    expect(migrateWorkspaceTildePath(null)).toBeNull();
  });

  it('exposes legacy paths for migration helpers', () => {
    expect(getLegacyAgentWorkspaceTildePath('main')).toBe('~/.stoclaw/openclaw/workspace');
    expect(getLegacyAgentWorkspaceTildePath('research')).toBe('~/.stoclaw/openclaw/workspace-research');
  });
});
