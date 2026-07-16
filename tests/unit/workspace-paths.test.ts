import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_TILDE,
  buildWorkspaceArtifactOutputRule,
  getAgentWorkspaceTildePath,
  getLegacyAgentWorkspaceTildePath,
  getWorkspaceArtifactOutputRelPath,
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

  it('joins workspace artifact output path with forward slashes', () => {
    expect(getWorkspaceArtifactOutputRelPath('C:\\Users\\sto\\ws')).toBe(
      'C:/Users/sto/ws/.claw-output',
    );
    expect(getWorkspaceArtifactOutputRelPath('/tmp/ws', 'report.html')).toBe(
      '/tmp/ws/.claw-output/report.html',
    );
  });

  it('mentions .claw-output and forbids legacy openclaw workspace in artifact rule', () => {
    const rule = buildWorkspaceArtifactOutputRule();
    expect(rule).toContain('.claw-output');
    expect(rule).toContain('~/.stoclaw/openclaw/workspace');
    expect(rule).toContain('file:///C:/');
  });

  it('injects absolute project .claw-output and forbids writing to project root', () => {
    const rule = buildWorkspaceArtifactOutputRule(undefined, {
      workspaceAbsolutePath: String.raw`C:\Users\sto\Downloads\demo`,
    });
    expect(rule).toContain('C:/Users/sto/Downloads/demo/.claw-output/<文件名>');
    expect(rule).toContain('禁止写入工作区根目录 `C:/Users/sto/Downloads/demo/`');
  });
});
