import { describe, expect, it } from 'vitest';
import { serializePersistedComposerSegmentsToActionText } from '@/components/input-composer/user-composer-segments';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';

describe('serializePersistedComposerSegmentsToActionText', () => {
  it('按 inline 顺序展开文件 / 技能 / 工作流 / @，不前置技能名、不留空 chip 位', () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '根据\u00A0' },
      {
        type: 'file',
        fileName: '客户流向_202607_合计.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 33500,
        preview: null,
      },
      { type: 'text', text: '和\u00A0' },
      {
        type: 'file',
        fileName: 'output_song (1).md',
        mimeType: 'text/markdown',
        fileSize: 297,
        preview: null,
      },
      { type: 'text', text: '使用\u00A0' },
      { type: 'skill', slug: 'yaolei-html', title: '姚磊html网页设计' },
      { type: 'text', text: '生成一份 html，并将结果发送给\u00A0' },
      {
        type: 'mention',
        mention: {
          type: 'user',
          id: 'u1',
          displayName: '申通sclaw123',
        },
      },
      { type: 'text', text: ',然后\u00A0' },
      { type: 'workflow', id: 'wf_qixi', name: '七夕问候语', source: 'mine' },
      { type: 'text', text: '发送给\u00A0' },
      {
        type: 'mention',
        mention: {
          type: 'user',
          id: 'u2',
          displayName: '侯正亚',
        },
      },
    ];

    expect(serializePersistedComposerSegmentsToActionText(segments)).toBe(
      '根据 客户流向_202607_合计.xlsx 和 output_song (1).md 使用 姚磊html网页设计 生成一份 html，并将结果发送给 @申通sclaw123 ,然后 七夕问候语 发送给 @侯正亚',
    );
  });

  it('无 chip 时原样返回文本', () => {
    expect(
      serializePersistedComposerSegmentsToActionText([
        { type: 'text', text: '  你好世界  ' },
      ]),
    ).toBe('你好世界');
  });
});
