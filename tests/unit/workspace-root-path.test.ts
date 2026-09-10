import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { normalizeWorkspaceRootPath } from '../../electron/db/workspace-root-path';

describe('normalizeWorkspaceRootPath', () => {
  it('resolves trailing slashes to the same folder', () => {
    expect(normalizeWorkspaceRootPath('/tmp/project-a/')).toBe(resolve('/tmp/project-a'));
    expect(normalizeWorkspaceRootPath('/tmp/project-a')).toBe(resolve('/tmp/project-a'));
  });

  it('returns empty for blank input', () => {
    expect(normalizeWorkspaceRootPath('   ')).toBe('');
  });
});
