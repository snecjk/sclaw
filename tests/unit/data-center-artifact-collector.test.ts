import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { collectArtifactsFromAssistantMessages } from '../../electron/services/data-center-artifact-sync/artifact-collector';

describe('data center artifact collector', () => {
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
});
