import { describe, expect, it } from 'vitest';
import { buildComposerGatewayPayload } from '@/lib/composer-gateway-text';
import type { FileAttachment } from '@/components/attachments/types';
import type { ComposerSegment } from '@/lib/dingtalk-mention-composer';

describe('buildComposerGatewayPayload', () => {
  it('builds ordered composition without exposing file/skill transport markers', async () => {
    const attachments: FileAttachment[] = [
      {
        id: 'a1',
        fileName: '漳州.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 10,
        stagedPath: '/tmp/a1.xlsx',
        preview: null,
        status: 'ready',
      },
      {
        id: 'a2',
        fileName: '华东.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 20,
        stagedPath: '/tmp/a2.xlsx',
        preview: null,
        status: 'ready',
      },
    ];

    const segments: ComposerSegment[] = [
      { type: 'text', text: '帮我将这个文件 ' },
      { type: 'file', attachmentId: 'a1' },
      { type: 'text', text: ' 和 ' },
      { type: 'file', attachmentId: 'a2' },
      { type: 'text', text: ' 内容组合，使用这个技能 ' },
      { type: 'skill', slug: 'transit-rate', title: '中转费率查询' },
      { type: 'text', text: ' 生成一个 html，然后在执行这个 ' },
      { type: 'workflow', id: 'wf_123', name: '运费合并工作流', source: 'mine' },
    ];

    const payload = await buildComposerGatewayPayload({
      segments,
      plainText: '帮我将这个文件  和  内容组合，使用这个技能  生成一个 html，然后在执行这个 ',
      attachments,
    });

    expect(payload.attachments.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(payload.skillMetas).toHaveLength(1);
    expect(payload.workflows).toEqual([
      { id: 'wf_123', name: '运费合并工作流', source: 'mine' },
    ]);

    expect(payload.gatewayText).toBe(
      '帮我将这个文件  和  内容组合，使用这个技能  生成一个 html，然后在执行这个 帮我执行 id 为：wf_123 的工作流 【运费合并工作流】',
    );
    expect(payload.gatewayText).not.toContain('SClaw-Skill');
    expect(payload.gatewayText).not.toContain('[技能:');
    expect(payload.gatewayText).not.toContain('[文件:');
    expect(payload.gatewayText).not.toContain('/tmp/a1.xlsx');
    expect(payload.composition.segments.map((segment) => segment.type)).toEqual([
      'text', 'attachment', 'text', 'attachment', 'text', 'skill', 'text', 'workflow',
    ]);
    expect(payload.composition.segments[1]).toEqual({
      type: 'attachment', mediaIndex: 0, displayName: '漳州.xlsx',
    });
    expect(payload.composition.segments[5]).toEqual({
      type: 'skill', slug: 'transit-rate', title: '中转费率查询',
    });

    expect(payload.displayText).toBe(
      '帮我将这个文件  和  内容组合，使用这个技能  生成一个 html，然后在执行这个',
    );
    expect(payload.displayText).not.toContain('[文件:');
    expect(payload.displayText).not.toContain('[技能:');
    expect(payload.displayText).not.toContain('中转费率查询');
    expect(payload.persistedSegments.some((s) => s.type === 'file' && s.fileName === '漳州.xlsx')).toBe(true);
  });

  it('keeps original labels in structured attachment and skill segments', async () => {
    const attachments: FileAttachment[] = [
      {
        id: 'a1',
        fileName: 'report].csv',
        mimeType: 'text/csv',
        fileSize: 1,
        stagedPath: '/tmp/a1.csv',
        preview: null,
        status: 'ready',
      },
    ];

    const segments: ComposerSegment[] = [
      { type: 'file', attachmentId: 'a1' },
      { type: 'text', text: ' 用 ' },
      { type: 'skill', slug: 'html-styler', title: '样式]设计' },
    ];

    const payload = await buildComposerGatewayPayload({
      segments,
      plainText: ' 用 ',
      attachments,
    });

    expect(payload.gatewayText).toBe('用');
    expect(payload.composition.segments[0]).toEqual({
      type: 'attachment', mediaIndex: 0, displayName: 'report].csv',
    });
    expect(payload.composition.segments[2]).toEqual({
      type: 'skill', slug: 'html-styler', title: '样式]设计',
    });
    expect(payload.displayText).toBe('用');
  });

  it('skips non-ready files from body and attachments', async () => {
    const attachments: FileAttachment[] = [
      {
        id: 'a1',
        fileName: 'pending.csv',
        mimeType: 'text/csv',
        fileSize: 1,
        stagedPath: '',
        preview: null,
        status: 'staging',
      },
    ];

    const segments: ComposerSegment[] = [
      { type: 'text', text: '看这个 ' },
      { type: 'file', attachmentId: 'a1' },
      { type: 'text', text: ' 文件' },
    ];

    const payload = await buildComposerGatewayPayload({
      segments,
      plainText: '看这个  文件',
      attachments,
    });

    expect(payload.attachments).toHaveLength(0);
    expect(payload.gatewayText).toBe('看这个  文件');
    expect(payload.gatewayText).not.toContain('[文件:');
    expect(payload.composition.segments.map((segment) => segment.type)).toEqual(['text', 'text']);
  });

  it('keeps mention displayName in gateway body', async () => {
    const segments: ComposerSegment[] = [
      {
        type: 'mention',
        mention: { type: 'user', displayName: '张三', userId: 'u1' },
      },
      { type: 'text', text: ' 你好' },
    ];

    const payload = await buildComposerGatewayPayload({
      segments,
      plainText: '@张三 你好',
      attachments: [],
    });

    expect(payload.gatewayText).toContain('@张三');
    expect(payload.displayText).toContain('@张三');
    expect(payload.composition.segments[0]).toEqual({
      type: 'mention', displayName: '张三', mentionIndex: 0,
    });
  });

  it('bakes exec sentence for workflow chips without source (learning-center / template handoff)', async () => {
    const suffix = '按客户维度拆解发件成本与利润，自动识别成本异常并生成分析报告';
    const segments: ComposerSegment[] = [
      { type: 'workflow', id: 'wf_tpl_cost', name: '客户成本分析' },
      { type: 'text', text: suffix },
    ];

    const payload = await buildComposerGatewayPayload({
      segments,
      plainText: `客户成本分析${suffix}`,
      attachments: [],
    });

    expect(payload.gatewayText).toBe(
      `帮我执行 id 为：wf_tpl_cost 的工作流 【客户成本分析】${suffix}`,
    );
    expect(payload.displayText).toBe(suffix);
    expect(payload.workflows).toEqual([
      { id: 'wf_tpl_cost', name: '客户成本分析', source: undefined },
    ]);
    // source 仍原样保留，供 dispatchChatSend 选路径；不参与 bake 分叉。
    expect(payload.persistedSegments[0]).toMatchObject({
      type: 'workflow',
      id: 'wf_tpl_cost',
      name: '客户成本分析',
    });
  });
});
