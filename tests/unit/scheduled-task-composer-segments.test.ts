import { describe, expect, it } from 'vitest';
import {
  composerSegmentsHaveBogusSkills,
  composerSegmentsLookNlStacked,
  isPlausibleSkillLabel,
  reconstructComposerSegmentsFromPrompt,
  sanitizeSkillPlaceholdersInPrompt,
} from '../../shared/scheduled-task-composer-segments';

describe('scheduled-task-composer-segments', () => {
  it('detects classic NL stacked file/skill/text/mention/workflow layout', () => {
    expect(composerSegmentsLookNlStacked([
      { type: 'file' },
      { type: 'file' },
      { type: 'skill' },
      { type: 'text' },
      { type: 'mention' },
      { type: 'workflow' },
    ])).toBe(true);
  });

  it('does not treat interleaved text/chip segments as stacked', () => {
    expect(composerSegmentsLookNlStacked([
      { type: 'text' },
      { type: 'file' },
      { type: 'text' },
      { type: 'skill' },
      { type: 'text' },
      { type: 'mention' },
    ])).toBe(false);
  });

  it('rejects cron/schedule narrative wrapped as skill labels', () => {
    expect(isPlausibleSkillLabel('姚磊html网页设计')).toBe(true);
    expect(isPlausibleSkillLabel(
      '的定时任务，cron为`0 * * * *`（每整点执行），内容为根据客户流向数据和七夕问候语使用「姚磊html网页设计',
    )).toBe(false);
    expect(composerSegmentsHaveBogusSkills([
      { type: 'skill', slug: 'html', title: '姚磊html网页设计' },
      {
        type: 'skill',
        slug: '的定时任务，cron为`0 * * * *`（每整点执行），内容为根据客户流向数据和七夕问候语使用「姚磊html网页设计',
        title: '的定时任务，cron为`0 * * * *`（每整点执行），内容为根据客户流向数据和七夕问候语使用「姚磊html网页设计',
      },
    ])).toBe(true);
  });

  it('sanitizes junk skill placeholders and keeps last known skill inline', () => {
    const prompt = [
      '[技能: 姚磊html网页设计] [技能: 的定时任务，cron为`0 * * * *`（每整点执行），内容为根据客户流向数据和七夕问候语使用「姚磊html网页设计]',
      '',
      '[文件: 客户流向.xlsx] 和 [文件: 七夕问候语] 使用 [技能: 姚磊html网页设计（html）] 生成报告',
    ].join('\n');
    const cleaned = sanitizeSkillPlaceholdersInPrompt(prompt, [
      { slug: 'html', title: '姚磊html网页设计' },
    ]);
    expect(cleaned).not.toContain('定时任务');
    expect(cleaned).not.toContain('cron');
    // 只留正文内那一次，避免前置抢位
    expect([...cleaned.matchAll(/\[技能:/g)]).toHaveLength(1);
    expect(cleaned).toContain('使用 [技能: 姚磊html网页设计] 生成报告');
  });

  it('reconstructs user-reported NL mixed prompt into interleaved chips', () => {
    const prompt = [
      '根据 [文件: 客户流向_202607_合计_20260711_181324.xlsx] 和 [文件: greeting-七夕问候语.md]，',
      '使用 [技能: 姚磊html网页设计] 生成一份 HTML，将结果发送给 @申通sclaw123',
      '',
      '然后执行 id 为 wf_78f13449 的工作流【七夕问候语】，将结果发送给 @申通sclaw123',
    ].join('\n');

    const segments = reconstructComposerSegmentsFromPrompt({
      prompt,
      attachments: [
        {
          fileName: '客户流向_202607_合计_20260711_181324.xlsx',
          mimeType: 'application/octet-stream',
          sourcePath: '/tmp/a.xlsx',
        },
        {
          fileName: 'greeting-七夕问候语.md',
          mimeType: 'text/markdown',
          sourcePath: '/tmp/b.md',
        },
      ],
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      mentions: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
      }],
    });

    expect(segments.map((s) => s.type)).toEqual([
      'text', 'file', 'text', 'file', 'text', 'skill', 'text', 'mention',
      'text', 'workflow', 'text', 'mention',
    ]);
    expect(segments.find((s) => s.type === 'skill')).toMatchObject({
      slug: 'html',
      title: '姚磊html网页设计',
    });
    expect(segments.find((s) => s.type === 'workflow')).toMatchObject({
      id: 'wf_78f13449',
      name: '七夕问候语',
    });
  });

  it('drops junk skill prefix from openclaw NL prompt and keeps inline skill/workflow', () => {
    // 回归：用户报告的落库形态——前置假 skill + 正文 `标题（slug）` + `执行工作流 wf_（名）`
    const prompt = [
      '[技能: 姚磊html网页设计] [技能: 的定时任务，cron为`0 * * * *`（每整点执行），内容为根据客户流向数据和七夕问候语使用「姚磊html网页设计]',
      '',
      '[文件: 客户流向_202606_合计_20260711_181706.xlsx] 和 [文件: 七夕问候语] 使用 [技能: 姚磊html网页设计（html）] 生成一份HTML报告，写入 .claw-output/ 目录后上传钉钉云盘，将报告链接发送给 @申通sclaw123。然后执行工作流 wf_78f13449（七夕问候语），将结果也发送给 @申通sclaw123。',
    ].join('\n');

    const segments = reconstructComposerSegmentsFromPrompt({
      prompt,
      attachments: [
        {
          fileName: '客户流向_202606_合计_20260711_181706.xlsx',
          mimeType: 'application/octet-stream',
          sourcePath: '/tmp/a.xlsx',
        },
        {
          fileName: '七夕问候语',
          mimeType: 'application/octet-stream',
          sourcePath: '/tmp/b',
        },
      ],
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      mentions: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
      }],
      workflowCode: 'wf_78f13449',
      workflowName: '七夕问候语',
    });

    const skills = segments.filter((s) => s.type === 'skill');
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ slug: 'html', title: '姚磊html网页设计' });
    expect(segments.some((s) => (
      s.type === 'skill' && String((s as { title?: string }).title).includes('定时任务')
    ))).toBe(false);

    const types = segments.map((s) => s.type);
    expect(types).toEqual([
      'file', 'text', 'file', 'text', 'skill', 'text', 'mention',
      'text', 'workflow', 'text', 'mention', 'text',
    ]);
    expect(segments.find((s) => s.type === 'workflow')).toMatchObject({
      id: 'wf_78f13449',
      name: '七夕问候语',
    });
  });

  it('weaves NL「技能」and 根据… into inline placeholders instead of stacking prefix', () => {
    // 回归：模型只写自然语言，旧逻辑前置 [文件:][技能:]\n\n → 编辑 chip 堆最上
    const prompt = [
      '[文件: 客户流向_202606_合计_20260711_181902.xlsx] [文件: greeting-七夕问候语.md] [技能: 姚磊html网页设计]',
      '',
      '根据客户流向Excel数据和七夕问候语，使用「姚磊html网页设计」技能（html）生成一份HTML报告，将结果发送给@申通sclaw123群。然后执行工作流wf_78f13449（七夕问候语），将结果发送给@申通sclaw123群。',
    ].join('\n');

    const segments = reconstructComposerSegmentsFromPrompt({
      prompt,
      attachments: [
        {
          fileName: '客户流向_202606_合计_20260711_181902.xlsx',
          mimeType: 'application/octet-stream',
          sourcePath: '/tmp/a.xlsx',
        },
        {
          fileName: 'greeting-七夕问候语.md',
          mimeType: 'text/markdown',
          sourcePath: '/tmp/b.md',
        },
      ],
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      mentions: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'cid1',
      }],
      workflowCode: 'wf_78f13449',
      workflowName: '七夕问候语',
    });

    const types = segments.map((s) => s.type);
    expect(types[0]).toBe('text'); // 根据
    expect(types).toContain('file');
    expect(types).toContain('skill');
    expect(types).toContain('workflow');
    // skill 不得在最前；应在 file 之后
    expect(types.indexOf('skill')).toBeGreaterThan(types.indexOf('file'));
    expect(types.indexOf('skill')).toBeGreaterThan(0);
    expect(segments.filter((s) => s.type === 'skill')).toHaveLength(1);
    expect(segments.find((s) => s.type === 'workflow')).toMatchObject({
      id: 'wf_78f13449',
      name: '七夕问候语',
    });
    // 正文不应再残留「姚磊html网页设计」技能 字面（已换成 chip）
    const joined = segments.filter((s) => s.type === 'text').map((s) => (s as { text: string }).text).join('');
    expect(joined).not.toMatch(/「姚磊html网页设计」技能/);
  });

  it('rejects schema angle-bracket placeholders like <技能slug/名称>', () => {
    expect(isPlausibleSkillLabel('<技能slug/名称>')).toBe(false);
    expect(isPlausibleSkillLabel('技能slug/名称')).toBe(false);
    expect(isPlausibleSkillLabel('标题')).toBe(false);
    expect(isPlausibleSkillLabel('姚磊html网页设计')).toBe(true);

    const prompt = [
      '[技能: <技能slug/名称>]',
      '',
      '[文件: 客户流向.xlsx] 使用 [技能: 姚磊html网页设计] 生成报告发给 @申通sclaw123',
    ].join('\n');
    const segments = reconstructComposerSegmentsFromPrompt({
      prompt,
      attachments: [{
        fileName: '客户流向.xlsx',
        mimeType: 'application/octet-stream',
        sourcePath: '/tmp/a.xlsx',
      }],
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      mentions: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'cid1',
      }],
    });
    const skills = segments.filter((s) => s.type === 'skill');
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ slug: 'html', title: '姚磊html网页设计' });
    expect(segments.some((s) => (
      s.type === 'skill' && String((s as { title?: string }).title).includes('slug')
    ))).toBe(false);
    expect(segments.map((s) => s.type).join(',')).not.toMatch(/^skill/);
  });
});
