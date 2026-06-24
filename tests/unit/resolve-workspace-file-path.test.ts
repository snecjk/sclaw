import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockConfigDir = join(tmpdir(), `stoclaw-artifact-test-${process.pid}`);

vi.mock('../../electron/utils/paths', () => ({
  expandPath: (p: string) => p.replace(/^~(?=$|[/\\])/, mockConfigDir.split('/.stoclaw')[0] || '/Users/test'),
  getOpenClawConfigDir: () => mockConfigDir,
}));

describe('resolveWorkspaceFilePath', () => {
  afterEach(() => {
    rmSync(mockConfigDir, { recursive: true, force: true });
  });

  it('resolves files under workspace/outputs/', async () => {
    const workspace = join(mockConfigDir, 'workspace');
    const outputs = join(workspace, 'outputs');
    mkdirSync(outputs, { recursive: true });
    const actual = join(outputs, 'report_20260624.html');
    writeFileSync(actual, '<html></html>', 'utf8');

    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
    expect(resolveWorkspaceFilePath('outputs/report_20260624.html')).toBe(actual);
    expect(resolveWorkspaceFilePath(actual)).toBe(actual);
  });

  it('fuzzy-matches near-miss basename in outputs/', async () => {
    const workspace = join(mockConfigDir, 'workspace');
    const outputs = join(workspace, 'outputs');
    mkdirSync(outputs, { recursive: true });
    const actual = join(outputs, '申通快递股价分析_20260624.html');
    writeFileSync(actual, '<html></html>', 'utf8');

    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
    const requested = join(outputs, '申通快递股价分析报告_20260624.html');
    expect(resolveWorkspaceFilePath(requested)).toBe(actual);
  });

  it('rewrites legacy .openclaw path and finds file in outputs/', async () => {
    const workspace = join(mockConfigDir, 'workspace');
    const outputs = join(workspace, 'outputs');
    mkdirSync(outputs, { recursive: true });
    const actual = join(outputs, 'report_20260624.html');
    writeFileSync(actual, '<html></html>', 'utf8');

    const home = mockConfigDir.replace('/.stoclaw/openclaw', '') || '/Users/test';
    const legacy = `${home}/.openclaw/workspace/outputs/report_20260624.html`;

    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
    expect(resolveWorkspaceFilePath(legacy)).toBe(actual);
  });
});
