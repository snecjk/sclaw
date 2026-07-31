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

  it('dedupes macOS absolute paths with redundant leading slashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'artifact-collector-macos-'));
    const filePath = join(dir, '五言律诗_雪夜访友.txt');
    const redundantSlashPath = `//${filePath}`;
    await writeFile(filePath, 'fake-poem');

    const artifacts = await collectArtifactsFromAssistantMessages([
      {
        role: 'assistant',
        content: `已生成文件：[五言律诗_雪夜访友.txt](file://${redundantSlashPath})`,
        _attachedFiles: [
          {
            fileName: '五言律诗_雪夜访友.txt',
            filePath,
          },
        ],
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: '五言律诗_雪夜访友.txt',
      filePath,
      size: 9,
    });
  });

  it('normalizes Windows file URI drive paths before checking files', async () => {
    const originalCwd = process.cwd();
    const dir = await mkdtemp(join(tmpdir(), 'artifact-collector-windows-'));
    const windowsPath = 'C:/Users/Alice/.stoclaw/workspace/.claw-output/win_report.docx';
    const posixTestPath = join(dir, 'C:', 'Users', 'Alice', '.stoclaw', 'workspace', '.claw-output', 'win_report.docx');
    await mkdir(join(dir, 'C:', 'Users', 'Alice', '.stoclaw', 'workspace', '.claw-output'), { recursive: true });
    await writeFile(posixTestPath, 'fake-docx');

    try {
      process.chdir(dir);
      const artifacts = await collectArtifactsFromAssistantMessages([
        {
          role: 'assistant',
          content: '已生成文件',
          _attachedFiles: [
            {
              fileName: 'win_report.docx',
              filePath: 'file:///C:/Users/Alice/.stoclaw/workspace/.claw-output/win_report.docx',
            },
          ],
        },
      ]);

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        name: 'win_report.docx',
        filePath: windowsPath,
        size: 9,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('dedupes Windows drive paths with forward and back slashes', async () => {
    const originalCwd = process.cwd();
    const dir = await mkdtemp(join(tmpdir(), 'artifact-collector-windows-dedupe-'));
    const windowsPath = 'C:/Users/admin/.stoclaw/workspace/.claw-output/wulu_poem_mountain_life.txt';
    const posixTestPath = join(dir, 'C:', 'Users', 'admin', '.stoclaw', 'workspace', '.claw-output', 'wulu_poem_mountain_life.txt');
    await mkdir(join(dir, 'C:', 'Users', 'admin', '.stoclaw', 'workspace', '.claw-output'), { recursive: true });
    await writeFile(posixTestPath, 'fake-poem');

    try {
      process.chdir(dir);
      const artifacts = await collectArtifactsFromAssistantMessages([
        {
          role: 'assistant',
          content: '已生成文件',
          _attachedFiles: [
            {
              fileName: 'wulu_poem_mountain_life.txt',
              filePath: windowsPath,
            },
            {
              fileName: 'wulu_poem_mountain_life.txt',
              filePath: 'C:\\Users\\admin\\.stoclaw\\workspace\\.claw-output\\wulu_poem_mountain_life.txt',
            },
          ],
        },
      ]);

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        name: 'wulu_poem_mountain_life.txt',
        filePath: windowsPath,
        size: 9,
      });
      expect(artifacts[0]?.artifactKey).toContain(':wulu_poem_mountain_life.txt');
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
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
