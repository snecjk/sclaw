import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_TILDE,
  PROJECT_AGENT_RUNTIME_DIRNAME,
  buildProjectWorkspaceContextAgentsMdSection,
  buildWorkspaceArtifactOutputAgentsMdSection,
  buildWorkspaceArtifactOutputRule,
  getAgentWorkspaceTildePath,
  getLegacyAgentWorkspaceTildePath,
  getProjectRootFromAgentWorkspace,
  getWorkspaceArtifactOutputRelPath,
  mergeProjectWorkspaceContextSection,
  mergeWorkspaceArtifactOutputSection,
  migrateWorkspaceTildePath,
  resolveProjectAgentWorkspacePath,
  WORKSPACE_ARTIFACT_OUTPUT_BEGIN,
  WORKSPACE_ARTIFACT_OUTPUT_END,
  PROJECT_WORKSPACE_CONTEXT_BEGIN,
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

  it('resolves project agent workspace under .sclaw', () => {
    expect(resolveProjectAgentWorkspacePath('/tmp/project')).toBe('/tmp/project/.sclaw');
    expect(resolveProjectAgentWorkspacePath('/tmp/project/.sclaw')).toBe('/tmp/project/.sclaw');
    expect(getProjectRootFromAgentWorkspace('/tmp/project/.sclaw')).toBe('/tmp/project');
    expect(getProjectRootFromAgentWorkspace('/tmp/project')).toBeNull();
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
    expect(rule).toContain(`.sclaw/.claw-output`);
  });

  it('injects absolute project .claw-output and forbids writing to project root', () => {
    const rule = buildWorkspaceArtifactOutputRule(undefined, {
      workspaceAbsolutePath: String.raw`C:\Users\sto\Downloads\demo\.sclaw`,
    });
    expect(rule).toContain('C:/Users/sto/Downloads/demo/.sclaw/.claw-output/<文件名>');
    expect(rule).toContain('工作区根目录 `C:/Users/sto/Downloads/demo/.sclaw/`');
    expect(rule).toContain('用户项目根 `C:/Users/sto/Downloads/demo/`');
    expect(rule).toContain('outputs/');
  });

  it('builds durable AGENTS.md section with absolute .claw-output path', () => {
    const section = buildWorkspaceArtifactOutputAgentsMdSection('/tmp/project/.sclaw');
    expect(section).toContain('/tmp/project/.sclaw/.claw-output/<文件名>');
    expect(section).toContain('禁止写入工作区根目录 `/tmp/project/.sclaw/`');
    expect(section).toContain('禁止写入用户项目根 `/tmp/project/`');
  });

  it('merges project workspace context into AGENTS.md', () => {
    const merged = mergeProjectWorkspaceContextSection('# AGENTS\n', '/tmp/project/.sclaw');
    expect(merged).toContain(PROJECT_WORKSPACE_CONTEXT_BEGIN);
    expect(merged).toContain(PROJECT_AGENT_RUNTIME_DIRNAME);
    expect(merged).toContain('/tmp/project/');
    expect(buildProjectWorkspaceContextAgentsMdSection('/tmp/ws')).toContain('项目目录说明');
  });

  it('merges artifact section idempotently into AGENTS.md content', () => {
    const first = mergeWorkspaceArtifactOutputSection('# AGENTS\n', '/tmp/project/.sclaw');
    expect(first).toContain(WORKSPACE_ARTIFACT_OUTPUT_BEGIN);
    expect(first).toContain('/tmp/project/.sclaw/.claw-output/<文件名>');
    const second = mergeWorkspaceArtifactOutputSection(first, '/tmp/project-b/.sclaw');
    expect(second).toContain('/tmp/project-b/.sclaw/.claw-output/<文件名>');
    expect(second.indexOf(WORKSPACE_ARTIFACT_OUTPUT_BEGIN)).toBe(
      second.lastIndexOf(WORKSPACE_ARTIFACT_OUTPUT_BEGIN),
    );
    expect(second).toContain(WORKSPACE_ARTIFACT_OUTPUT_END);
  });
});
