import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectArtifactsFromAssistantMessages } from '../../electron/services/data-center-artifact-sync/artifact-collector';

describe('data center artifact collector', () => {
  let mockedRoot = '';

  afterEach(async () => {
    vi.doUnmock('../../electron/utils/paths');
    vi.resetModules();
    if (mockedRoot) {
      await rm(mockedRoot, { recursive: true, force: true });
      mockedRoot = '';
    }
  });

  it('collects structured attached file paths from assistant messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'artifact-collector-'));
    const filePath = join(dir, 'api_testing_guide.docx');
    await writeFile(filePath, 'fake-docx');

    const artifacts = await collectArtifactsFromAssistantMessages([
      {
        role: 'assistant',
        content: '已生成文件',
        _attachedFiles: [
          {
            fileName: 'api_testing_guide.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            filePath,
          },
        ],
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: 'api_testing_guide.docx',
      filePath,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('collects file URI markdown links from assistant history messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'artifact-collector-'));
    const filePath = join(dir, 'smart_contract_testing.docx');
    await writeFile(filePath, 'fake-docx');

    const artifacts = await collectArtifactsFromAssistantMessages([
      {
        role: 'assistant',
        content: `已生成完成！\n\n[smart_contract_testing.docx](file://${filePath})`,
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: 'smart_contract_testing.docx',
      filePath,
    });
  });

  it('collects relative preview links from scheduled-task assistant text', async () => {
    mockedRoot = await mkdtemp(join(tmpdir(), 'artifact-collector-workspace-'));
    const home = join(mockedRoot, 'home');
    const workspace = join(home, '.stoclaw', 'workspace');
    const outputDir = join(workspace, '.claw-output');
    await mkdir(outputDir, { recursive: true });
    const filePath = join(outputDir, 'random_page.html');
    await writeFile(filePath, '<html>scheduled task artifact</html>');

    vi.doMock('../../electron/utils/paths', () => ({
      getDefaultAgentWorkspacePath: () => workspace,
      getLegacyDefaultAgentWorkspacePath: () => join(home, '.stoclaw', 'openclaw', 'workspace'),
      getLegacyOpenClawWorkspaceRoot: () => join(home, '.openclaw', 'workspace'),
      getOpenClawConfigDir: () => join(home, '.stoclaw', 'openclaw'),
      getStoClawHomeDir: () => join(home, '.stoclaw'),
      expandPath: (path: string) => path.replace(/^~/, home),
    }));

    vi.resetModules();
    const { collectArtifactsFromAssistantMessages: collect } = await import('../../electron/services/data-center-artifact-sync/artifact-collector');
    const artifacts = await collect([
      {
        role: 'assistant',
        content: [
          '已为您生成一个 HTML 页面。',
          '在线预览：[random_page.html](preview://random_page.html)',
          '本地文件路径：[random_page.html](random_page.html)',
        ].join('\n'),
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: 'random_page.html',
      filePath,
      contentType: null,
    });
  });

  it('collects bare relative artifact paths from scheduled-task assistant text', async () => {
    mockedRoot = await mkdtemp(join(tmpdir(), 'artifact-collector-workspace-'));
    const home = join(mockedRoot, 'home');
    const workspace = join(home, '.stoclaw', 'workspace');
    const outputDir = join(workspace, '.claw-output');
    await mkdir(outputDir, { recursive: true });
    const filePath = join(outputDir, 'random_page.html');
    await writeFile(filePath, '<html>scheduled task artifact</html>');

    vi.doMock('../../electron/utils/paths', () => ({
      getDefaultAgentWorkspacePath: () => workspace,
      getLegacyDefaultAgentWorkspacePath: () => join(home, '.stoclaw', 'openclaw', 'workspace'),
      getLegacyOpenClawWorkspaceRoot: () => join(home, '.openclaw', 'workspace'),
      getOpenClawConfigDir: () => join(home, '.stoclaw', 'openclaw'),
      getStoClawHomeDir: () => join(home, '.stoclaw'),
      expandPath: (path: string) => path.replace(/^~/, home),
    }));

    vi.resetModules();
    const { collectArtifactsFromAssistantMessages: collect } = await import('../../electron/services/data-center-artifact-sync/artifact-collector');
    const artifacts = await collect([
      {
        role: 'assistant',
        content: [
          '已为您随机生成一个 HTML 页面。',
          '在线预览： random_page.html',
          '本地文件路径： random_page.html',
        ].join('\n'),
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: 'random_page.html',
      filePath,
      contentType: null,
    });
  });
});
