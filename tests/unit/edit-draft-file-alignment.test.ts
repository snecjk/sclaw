import { describe, expect, it } from 'vitest';
import { persistedSegmentsToComposer } from '@/components/input-composer/use-input-composer-edit-draft';
import { buildComposerGatewayPayload } from '@/lib/composer-gateway-text';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';

describe('edit draft file id alignment', () => {
  it('keeps file segment attachmentId aligned with registry when preferred attachments have different ids', async () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '根据 ' },
      {
        type: 'file',
        fileName: '客户流向.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 100,
        preview: null,
        filePath: '/tmp/a.xlsx',
        stagedPath: '/tmp/a.xlsx',
      },
      { type: 'text', text: ' 和 ' },
      {
        type: 'file',
        fileName: 'output_song.md',
        mimeType: 'text/markdown',
        fileSize: 20,
        preview: null,
        filePath: '/tmp/b.md',
        stagedPath: '/tmp/b.md',
      },
      { type: 'text', text: ' 生成一份 md 文件' },
    ];

    // 调用方曾新生成 UUID，不得与 segment id 分叉。
    const preferred = [
      {
        id: 'preferred-a',
        fileName: '客户流向.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 100,
        stagedPath: '/tmp/a.xlsx',
        filePath: '/tmp/a.xlsx',
        preview: null,
        status: 'ready' as const,
      },
      {
        id: 'preferred-b',
        fileName: 'output_song.md',
        mimeType: 'text/markdown',
        fileSize: 20,
        stagedPath: '/tmp/b.md',
        filePath: '/tmp/b.md',
        preview: null,
        status: 'ready' as const,
      },
    ];

    const converted = persistedSegmentsToComposer(segments, preferred);
    const fileSegIds = converted.segments
      .filter((seg): seg is { type: 'file'; attachmentId: string } => seg.type === 'file')
      .map((seg) => seg.attachmentId);

    expect(fileSegIds).toEqual(['preferred-a', 'preferred-b']);
    expect(converted.attachments.map((att) => att.id)).toEqual(['preferred-a', 'preferred-b']);

    const payload = await buildComposerGatewayPayload({
      segments: converted.segments,
      plainText: '根据  和  生成一份 md 文件',
      attachments: converted.attachments,
      resolveSkillPrompt: async () => ({ defaultPrompt: '', title: '' }),
    });

    expect(payload.attachments).toHaveLength(2);
    expect(payload.gatewayText).toContain('[文件: 客户流向.xlsx]');
    expect(payload.gatewayText).toContain('[文件: output_song.md]');
    expect(payload.displayText).toBe('根据  和  生成一份 md 文件');
    expect(payload.persistedSegments.filter((seg) => seg.type === 'file')).toHaveLength(2);
  });

  it('does not drop files when registry ids diverge from segment attachmentIds (regression)', async () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '根据 ' },
      {
        type: 'file',
        fileName: 'a.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 1,
        preview: null,
        stagedPath: '/tmp/a.xlsx',
      },
      { type: 'text', text: ' 生成' },
    ];
    const converted = persistedSegmentsToComposer(segments);
    const mismatchedRegistry = converted.attachments.map((att) => ({
      ...att,
      id: crypto.randomUUID(),
    }));

    const payload = await buildComposerGatewayPayload({
      segments: converted.segments,
      plainText: '根据  生成',
      attachments: mismatchedRegistry,
      resolveSkillPrompt: async () => ({ defaultPrompt: '', title: '' }),
    });

    // id 分叉 → 文件被跳过（原 bug）。若有人再引入分裂 id，此守卫应失败。
    expect(payload.attachments).toHaveLength(0);
    expect(payload.gatewayText).not.toContain('[文件:');
  });
});
