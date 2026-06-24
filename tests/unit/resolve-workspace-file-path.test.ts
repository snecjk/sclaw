import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockConfigDir = join(tmpdir(), `stoclaw-artifact-test-${process.pid}`);

vi.mock('../../electron/utils/paths', () => ({
  expandPath: (p: string) => p.replace(/^~(?=$|[/\\])/, mockConfigDir.split('/.stoclaw')[0] || '/Users/test'),
  getOpenClawConfigDir: () => mockConfigDir,
  getLegacyOpenClawWorkspaceRoot: () => {
    const home = mockConfigDir.replace('/.stoclaw/openclaw', '') || '/Users/test';
    return `${home}/.openclaw/workspace`;
  },
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

  it('prefers exact legacy match over stoclaw fuzzy near-miss', async () => {
    const home = mockConfigDir.replace('/.stoclaw/openclaw', '') || '/Users/test';
    const stoclawOutputs = join(mockConfigDir, 'workspace', 'outputs');
    const legacyOutputs = join(home, '.openclaw', 'workspace', 'outputs');
    mkdirSync(stoclawOutputs, { recursive: true });
    mkdirSync(legacyOutputs, { recursive: true });

    writeFileSync(join(stoclawOutputs, '申通快递股价分析_20260624.html'), '<html>old</html>', 'utf8');
    const exactLegacy = join(legacyOutputs, '申通快递股价分析报告_20260624.html');
    writeFileSync(exactLegacy, '<html>exact</html>', 'utf8');

    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
    const requested = join(mockConfigDir, 'workspace', 'outputs', '申通快递股价分析报告_20260624.html');
    expect(resolveWorkspaceFilePath(requested)).toBe(exactLegacy);
  });

  describe('Windows-style path strings', () => {
    it('resolves C:/ drive paths via workspace basename search', async () => {
      const clawOutput = join(mockConfigDir, 'workspace', '.claw-output');
      mkdirSync(clawOutput, { recursive: true });
      const actual = join(clawOutput, 'report_20260624.html');
      writeFileSync(actual, '<html></html>', 'utf8');

      const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
      const requested = 'C:/Users/sto/.stoclaw/openclaw/workspace/.claw-output/report_20260624.html';
      expect(resolveWorkspaceFilePath(requested)).toBe(actual);
    });

    it('rewrites C:/ legacy .openclaw path and finds file under stoclaw outputs', async () => {
      const outputs = join(mockConfigDir, 'workspace', 'outputs');
      mkdirSync(outputs, { recursive: true });
      const actual = join(outputs, 'report_20260624.html');
      writeFileSync(actual, '<html></html>', 'utf8');

      const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
      expect(
        resolveWorkspaceFilePath('C:/Users/sto/.openclaw/workspace/outputs/report_20260624.html'),
      ).toBe(actual);
    });

    it('rewrites Windows backslash legacy path and finds file under stoclaw outputs', async () => {
      const outputs = join(mockConfigDir, 'workspace', 'outputs');
      mkdirSync(outputs, { recursive: true });
      const actual = join(outputs, 'report_20260624.html');
      writeFileSync(actual, '<html></html>', 'utf8');

      const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
      expect(
        resolveWorkspaceFilePath('C:\\Users\\sto\\.openclaw\\workspace\\outputs\\report_20260624.html'),
      ).toBe(actual);
    });

    it('resolves file:///C:/ Windows links to workspace files', async () => {
      const clawOutput = join(mockConfigDir, 'workspace', '.claw-output');
      mkdirSync(clawOutput, { recursive: true });
      const actual = join(clawOutput, 'dashboard.html');
      writeFileSync(actual, '<html></html>', 'utf8');

      const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
      expect(
        resolveWorkspaceFilePath('file:///C:/Users/sto/.stoclaw/openclaw/workspace/.claw-output/dashboard.html'),
      ).toBe(actual);
    });

    it('prefers exact legacy match when request uses C:/ stoclaw path', async () => {
      const home = mockConfigDir.replace('/.stoclaw/openclaw', '') || '/Users/test';
      const stoclawOutputs = join(mockConfigDir, 'workspace', 'outputs');
      const legacyOutputs = join(home, '.openclaw', 'workspace', 'outputs');
      mkdirSync(stoclawOutputs, { recursive: true });
      mkdirSync(legacyOutputs, { recursive: true });

      writeFileSync(join(stoclawOutputs, 'report_20260624.html'), '<html>stoclaw</html>', 'utf8');
      const exactLegacy = join(legacyOutputs, 'report_20260624_v2.html');
      writeFileSync(exactLegacy, '<html>legacy</html>', 'utf8');

      const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
      expect(
        resolveWorkspaceFilePath('C:/Users/sto/.stoclaw/openclaw/workspace/outputs/report_20260624_v2.html'),
      ).toBe(exactLegacy);
    });
  });
});
