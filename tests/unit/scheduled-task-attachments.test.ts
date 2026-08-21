import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMediaFromComposerAttachments,
  isAllowedAttachmentSourcePath,
  parseMediaAttachedAttachments,
  prepareScheduledTaskAttachmentsForSave,
  rewriteComposerSegmentFilePaths,
  stripMediaAttachedFromText,
  stripStoClawOutboundPathsFromText,
} from '../../electron/scheduled-tasks/scheduled-task-attachments';

const outbound = (name: string) =>
  join(homedir(), '.stoclaw', 'openclaw', 'media', 'outbound', name);

describe('scheduled-task-attachments helpers', () => {
  it('buildMediaFromComposerAttachments keeps only persistentPath entries', () => {
    expect(
      buildMediaFromComposerAttachments({
        composerAttachments: [
          { fileName: 'a.xlsx', mimeType: 'application/vnd.ms-excel', persistentPath: '/tmp/a.xlsx' },
          { fileName: 'missing.pdf', mimeType: 'application/pdf' },
        ],
      }),
    ).toEqual([
      { filePath: '/tmp/a.xlsx', mimeType: 'application/vnd.ms-excel', fileName: 'a.xlsx' },
    ]);
  });

  it('buildMediaFromComposerAttachments returns empty for missing extra', () => {
    expect(buildMediaFromComposerAttachments(null)).toEqual([]);
    expect(buildMediaFromComposerAttachments({})).toEqual([]);
  });

  it('rewriteComposerSegmentFilePaths fills filePath for file segments in order', () => {
    const rewritten = rewriteComposerSegmentFilePaths(
      [
        { type: 'file', fileName: 'old.html', mimeType: 'text/html', fileSize: 1, preview: null },
        { type: 'text', text: '分析' },
        { type: 'mention', mention: { type: 'user', displayName: '张三', userId: 'u1' } },
      ],
      [
        {
          id: 'att-1',
          fileName: 'new.html',
          mimeType: 'text/html',
          persistentPath: '/home/.stoclaw/scheduled-tasks/t1/attachments/att-1-new.html',
        },
      ],
    ) as Array<Record<string, unknown>>;

    expect(rewritten[0]).toMatchObject({
      type: 'file',
      fileName: 'new.html',
      filePath: '/home/.stoclaw/scheduled-tasks/t1/attachments/att-1-new.html',
      stagedPath: '/home/.stoclaw/scheduled-tasks/t1/attachments/att-1-new.html',
    });
    expect(rewritten[1]).toEqual({ type: 'text', text: '分析' });
  });

  it('allows only paths under ~/.stoclaw', () => {
    expect(isAllowedAttachmentSourcePath(outbound('a.xlsx'))).toBe(true);
    expect(isAllowedAttachmentSourcePath('/etc/passwd')).toBe(false);
    expect(isAllowedAttachmentSourcePath('/tmp/evil.xlsx')).toBe(false);
  });

  it('parses and strips [media attached:] from prompt', () => {
    const path = outbound('sales.xlsx');
    const prompt = `分析表格\n\n[media attached: ${path} (application/vnd.ms-excel) | ${path}]`;
    const parsed = parseMediaAttachedAttachments(prompt);
    expect(parsed).toEqual([
      {
        fileName: 'sales.xlsx',
        mimeType: 'application/vnd.ms-excel',
        sourcePath: path,
      },
    ]);
    expect(stripMediaAttachedFromText(prompt)).toBe('分析表格');
  });

  it('prepareScheduledTaskAttachmentsForSave merges top-level + prompt media into extra', () => {
    const pathA = outbound('a.xlsx');
    const pathB = outbound('b.csv');
    const prepared = prepareScheduledTaskAttachmentsForSave({
      prompt: `做日报\n\n[media attached: ${pathB} (text/csv) | ${pathB}]`,
      extra: {
        composerSegments: [
          { type: 'mention', mention: { type: 'user', displayName: '李峥', userId: 'u2' } },
        ],
      },
      attachments: [
        { fileName: 'a.xlsx', mimeType: 'application/vnd.ms-excel', sourcePath: pathA },
      ],
    });

    expect(prepared.prompt).toBe('做日报');
    expect(prepared.extra?.composerAttachments).toEqual([
      expect.objectContaining({
        fileName: 'a.xlsx',
        mimeType: 'application/vnd.ms-excel',
        sourcePath: pathA,
      }),
      expect.objectContaining({
        fileName: 'b.csv',
        mimeType: 'text/csv',
        sourcePath: pathB,
      }),
    ]);
    const segments = prepared.extra?.composerSegments as Array<{ type: string }>;
    expect(segments.filter((s) => s.type === 'file')).toHaveLength(2);
    expect(segments.some((s) => s.type === 'mention')).toBe(true);
    // 既有 segments 无 file 时，新发现的附件可前置；不得丢掉 mention
    expect(segments.map((s) => s.type)).toContain('mention');
  });

  it('prepareScheduledTaskAttachmentsForSave keeps interleaved UI file/text order', () => {
    const pathA = outbound('a.xlsx');
    const prepared = prepareScheduledTaskAttachmentsForSave({
      prompt: '根据文件生成报告',
      extra: {
        composerSegments: [
          { type: 'text', text: '根据 ' },
          {
            type: 'file',
            fileName: 'a.xlsx',
            mimeType: 'application/vnd.ms-excel',
            filePath: pathA,
            stagedPath: pathA,
          },
          { type: 'text', text: ' 生成报告' },
        ],
        composerAttachments: [
          { fileName: 'a.xlsx', mimeType: 'application/vnd.ms-excel', sourcePath: pathA },
        ],
      },
    });
    const types = (prepared.extra?.composerSegments as Array<{ type: string }>).map((s) => s.type);
    expect(types).toEqual(['text', 'file', 'text']);
  });

  it('stripStoClawOutboundPathsFromText keeps Chinese 文件 narration', () => {
    const path = outbound('sales.xlsx');
    expect(stripStoClawOutboundPathsFromText('根据文件内容总结今日报表')).toBe(
      '根据文件内容总结今日报表',
    );
    expect(
      stripStoClawOutboundPathsFromText(`根据文件 ${path}（销售表） 生成报告`),
    ).toBe('根据文件 生成报告');
  });
});
