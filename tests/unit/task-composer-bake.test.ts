import { describe, expect, it } from 'vitest';
import { buildComposerGatewayPayload } from '@/lib/composer-gateway-text';

describe('Task composer bake payload', () => {
  it('keeps prompt clean with @displayName and mention segments (no recipients JSON block)', async () => {
    const payload = await buildComposerGatewayPayload({
      segments: [
        {
          type: 'mention',
          mention: { type: 'user', displayName: '李峥', userId: 'uid-2' },
        },
        { type: 'text', text: ' 请生成本周周报' },
        { type: 'skill', slug: 'weekly-report', title: '周报技能' },
      ],
      plainText: '@李峥 请生成本周周报',
      attachments: [],
      resolveSkillPrompt: async () => ({ defaultPrompt: '你是周报助手', title: '周报技能' }),
    });

    expect(payload.gatewayText).not.toContain('STOCLAW:DINGTALK_RECIPIENTS');
    expect(payload.gatewayText).toContain('@李峥');
    expect(payload.gatewayText).toContain('请生成本周周报');
    expect(payload.skillMetas[0]?.slug).toBe('weekly-report');
    expect(payload.persistedSegments.some((s) => s.type === 'mention')).toBe(true);
    const mention = payload.persistedSegments.find((s) => s.type === 'mention');
    expect(mention?.type === 'mention' && mention.mention.userId).toBe('uid-2');
  });

  it('orders ready attachments into persisted file segments', async () => {
    const payload = await buildComposerGatewayPayload({
      segments: [
        { type: 'file', attachmentId: 'att-1' },
        { type: 'text', text: '分析这个表' },
      ],
      plainText: '分析这个表',
      attachments: [
        {
          id: 'att-1',
          fileName: 'sales.xlsx',
          mimeType: 'application/vnd.ms-excel',
          fileSize: 12,
          stagedPath: '/tmp/sales.xlsx',
          preview: null,
          status: 'ready',
        },
      ],
      resolveSkillPrompt: async () => ({ defaultPrompt: '', title: '' }),
    });

    expect(payload.attachments).toHaveLength(1);
    expect(payload.persistedSegments[0]).toMatchObject({
      type: 'file',
      fileName: 'sales.xlsx',
      stagedPath: '/tmp/sales.xlsx',
    });
    expect(payload.gatewayText).toContain('[文件: sales.xlsx]');
  });
});
