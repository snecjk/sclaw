import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignScheduledTaskCreateToComposerModel } from '../../electron/scheduled-tasks/scheduled-task-nl-create';

const outbound = (name: string) =>
  join(homedir(), '.stoclaw', 'openclaw', 'media', 'outbound', name);

describe('alignScheduledTaskCreateToComposerModel', () => {
  it('aligns NL create to Modal-like columns + extra segments', () => {
    const path = outbound('客户流向.xlsx');
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '每日报告',
      cronExpr: '0 10 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: '生成七夕主题客户流向HTML报告并发送',
      workflowCode: 'wf_78f13449',
      workflowName: '七夕问候语',
      skills: [{ slug: 'html-design', title: '姚磊html网页设计' }],
      recipients: [
        {
          type: 'group',
          displayName: '申通sclaw123',
          openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
        },
        {
          type: 'user',
          displayName: '侯正亚',
          userId: '156600494920475782',
        },
      ],
      attachments: [
        {
          fileName: '客户流向.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sourcePath: path,
        },
      ],
      dingtalkRecipients: [
        { type: 'user', displayName: '应被清空', userId: 'x' },
      ],
    });

    expect(aligned.dingtalkRecipients).toBeNull();
    expect(aligned.skillCode).toBeNull();
    expect(aligned.workflowCode).toBeNull();
    expect(aligned.prompt).toContain('[文件: 客户流向.xlsx]');
    expect(aligned.prompt).toContain('[技能: 姚磊html网页设计]');
    expect(aligned.prompt).toContain('@申通sclaw123');
    expect(aligned.prompt).toContain('@侯正亚');
    expect(aligned.prompt).toContain('wf_78f13449');
    expect(aligned.prompt).not.toContain('STOCLAW:DINGTALK_RECIPIENTS');

    const segments = aligned.extra?.composerSegments as Array<{ type: string; slug?: string; id?: string }>;
    expect(segments.map((s) => s.type)).toEqual(
      expect.arrayContaining(['file', 'skill', 'mention', 'workflow']),
    );
    expect(segments.some((s) => s.type === 'skill' && s.slug === 'html-design')).toBe(true);
    expect(segments.some((s) => s.type === 'workflow' && s.id === 'wf_78f13449')).toBe(true);
    expect(aligned.extra?.composerAttachments).toEqual([
      expect.objectContaining({
        fileName: '客户流向.xlsx',
        sourcePath: path,
      }),
    ]);
  });

  it('moves legacy dingtalkRecipients into segments and clears column', () => {
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: 't',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: '做周报',
      dingtalkRecipients: [
        { type: 'user', displayName: '李峥', userId: 'uid-2' },
      ],
    });
    expect(aligned.dingtalkRecipients).toBeNull();
    const mentions = (aligned.extra?.composerSegments as Array<{ type: string; mention?: { userId?: string } }>)
      .filter((s) => s.type === 'mention');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.mention?.userId).toBe('uid-2');
  });

  it('normalizes literal \\n / \\r / \\t in NL prompt to real newlines (C-2) and marks createdVia=nl', () => {
    // 模型在工具 JSON 参数里把换行双重转义成字面 `\n`，NL 入库前归一化为真换行。
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '多步任务',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: '第一步生成报告\\n\\n第二步发送给@侯正亚\\n\\t第三步查询天气',
      recipients: [{ type: 'user', displayName: '侯正亚', userId: 'u1' }],
    });
    expect(aligned.prompt).toContain('第一步生成报告\n\n第二步发送给@侯正亚\n\t第三步查询天气');
    expect(aligned.prompt).not.toContain('\\n');
    expect(aligned.extra?.createdVia).toBe('nl');
    const textSeg = (aligned.extra?.composerSegments as Array<{ type: string; text?: string }>)
      .find((s) => s.type === 'text');
    expect(textSeg?.text).toContain('第一步生成报告\n\n第二步发送给');
    expect(textSeg?.text).not.toContain('\\n');
  });

  it('idempotent: normalizing an already-normalized prompt is a no-op', () => {
    const once = alignScheduledTaskCreateToComposerModel({
      name: 't',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: '第一行\n第二行',
    });
    expect(once.prompt).toBe('第一行\n第二行');
    expect(once.extra?.createdVia).toBe('nl');
  });

  it('preserves UI-baked interleaved composerSegments and marks createdVia=ui', () => {
    // 回归：Modal 手动创建也会走 createTask → align。已 bake 的交错 segments
    // 不得被重排成 files+skills+text+mentions，否则编辑回填排版乱，且误标 nl。
    const path = outbound('客户流向.xlsx');
    const uiSegments = [
      { type: 'text', text: '根据 ' },
      {
        type: 'file',
        fileName: '客户流向.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 0,
        preview: null,
        filePath: path,
        stagedPath: path,
      },
      { type: 'text', text: ' 生成报告\n\n发送给 ' },
      {
        type: 'mention',
        mention: { type: 'user', displayName: '侯正亚', userId: 'u1' },
      },
      { type: 'text', text: '\n\n然后执行 ' },
      {
        type: 'workflow',
        id: 'wf_78f13449',
        name: '七夕问候语',
        source: 'mine',
      },
    ];
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '手动任务',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: '根据 [文件: 客户流向.xlsx] 生成报告\n\n发送给 @侯正亚\n\n然后执行 帮我执行 id 为：wf_78f13449 的工作流 【七夕问候语】',
      extra: {
        composerSegments: uiSegments,
        composerAttachments: [{
          id: 'att-1',
          fileName: '客户流向.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sourcePath: path,
        }],
      },
    });

    expect(aligned.extra?.createdVia).toBe('ui');
    const types = (aligned.extra?.composerSegments as Array<{ type: string }>).map((s) => s.type);
    expect(types).toEqual(['text', 'file', 'text', 'mention', 'text', 'workflow']);
    const texts = (aligned.extra?.composerSegments as Array<{ type: string; text?: string }>)
      .filter((s) => s.type === 'text')
      .map((s) => s.text);
    expect(texts).toEqual(['根据 ', ' 生成报告\n\n发送给 ', '\n\n然后执行 ']);
    // UI prompt 原样保留，不做字面 \n 误转、不重 bake 占位
    expect(aligned.prompt).toContain('根据 [文件: 客户流向.xlsx] 生成报告\n\n发送给 @侯正亚');
  });

  it('UI create: strips SClaw-Skill marker from prompt but keeps skill in composerSegments', () => {
    const marker = '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计","userText":"根据\\n\\n生成 html"} -->';
    const uiSegments = [
      { type: 'text', text: '根据\n\n生成 html' },
      { type: 'skill', slug: 'html', title: '姚磊html网页设计' },
    ];
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '手动带技能',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: `姚磊html网页设计\n\n根据 [技能: 姚磊html网页设计] 生成 html\n${marker}`,
      extra: { composerSegments: uiSegments },
    });

    expect(aligned.extra?.createdVia).toBe('ui');
    expect(aligned.prompt).not.toMatch(/SClaw-Skill/);
    expect(aligned.prompt).not.toContain('userText');
    expect(aligned.prompt).not.toContain('\\n');
    const skills = (aligned.extra?.composerSegments as Array<{ type: string; slug?: string }>)
      .filter((s) => s.type === 'skill');
    expect(skills).toEqual([expect.objectContaining({ slug: 'html', title: '姚磊html网页设计' })]);
  });

  it('NL create: harvests skill from marker into segments then strips marker from prompt', () => {
    const marker = '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计","userText":"生成一份报告\\n发送"} -->';
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: 'NL带marker',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      // 模型未传 skills 字段，只把 chat 原文（含 marker）塞进 prompt
      prompt: `生成一份报告\n发送\n${marker}`,
    });

    expect(aligned.extra?.createdVia).toBe('nl');
    expect(aligned.prompt).not.toMatch(/SClaw-Skill/);
    expect(aligned.prompt).not.toContain('userText');
    expect(aligned.prompt).toContain('[技能: 姚磊html网页设计]');
    expect(aligned.prompt).toContain('生成一份报告');
    const skills = (aligned.extra?.composerSegments as Array<{ type: string; slug?: string; title?: string }>)
      .filter((s) => s.type === 'skill');
    expect(skills).toEqual([expect.objectContaining({ slug: 'html', title: '姚磊html网页设计' })]);
  });

  it('NL create: reconstructs interleaved composerSegments from in-prompt placeholders', () => {
    // 回归：模型已把 [文件:]/[技能:]/@/工作流写进正文时，不得再分堆成
    // files+skills+text+mentions+workflows，否则编辑回填 chip 堆两端、正文留空洞。
    const xlsx = outbound('客户流向_202607_合计_20260711_181324.xlsx');
    const md = outbound('greeting-七夕问候语.md');
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '整点执行 claude 混排',
      cronExpr: '0 * * * *',
      engineType: 'claude',
      agentId: 'main',
      prompt: [
        '根据 [文件: 客户流向_202607_合计_20260711_181324.xlsx] 和 [文件: greeting-七夕问候语.md]，',
        '使用 [技能: 姚磊html网页设计] 生成一份 HTML，将结果发送给 @申通sclaw123',
        '',
        '然后执行 id 为 wf_78f13449 的工作流【七夕问候语】，将结果发送给 @申通sclaw123',
      ].join('\n'),
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      recipients: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
      }],
      attachments: [
        {
          fileName: '客户流向_202607_合计_20260711_181324.xlsx',
          mimeType: 'application/octet-stream',
          sourcePath: xlsx,
        },
        {
          fileName: 'greeting-七夕问候语.md',
          mimeType: 'text/markdown',
          sourcePath: md,
        },
      ],
    });

    expect(aligned.extra?.createdVia).toBe('nl');
    const segments = aligned.extra?.composerSegments as Array<{
      type: string;
      text?: string;
      fileName?: string;
      slug?: string;
      id?: string;
      mention?: { displayName?: string };
    }>;
    expect(segments.map((s) => s.type)).toEqual([
      'text', 'file', 'text', 'file', 'text', 'skill', 'text', 'mention',
      'text', 'workflow', 'text', 'mention',
    ]);
    expect(segments.filter((s) => s.type === 'text').map((s) => s.text)).toEqual([
      '根据 ',
      ' 和 ',
      '，\n使用 ',
      ' 生成一份 HTML，将结果发送给 ',
      '\n\n然后',
      '，将结果发送给 ',
    ]);
    expect(segments.find((s) => s.type === 'skill')).toMatchObject({
      slug: 'html',
      title: '姚磊html网页设计',
    });
    expect(segments.find((s) => s.type === 'workflow')).toMatchObject({
      id: 'wf_78f13449',
      name: '七夕问候语',
    });
    // 正文不得残留占位空洞形态「根据 和 ，使用」整段，也不得再堆 file/skill 到最前
    const joinedText = segments.filter((s) => s.type === 'text').map((s) => s.text).join('');
    expect(joinedText).not.toMatch(/根据\s+和\s+，使用\s+生成/);
    expect(segments[0]?.type).toBe('text');
  });

  it('NL create: strips junk [技能: cron叙事] prefix and does not duplicate real skill', () => {
    // 回归：openclaw 模型把调度说明误包成 [技能:…]，buildGatewayBody 又前置真 skill
    const xlsx = outbound('客户流向_202606_合计_20260711_181706.xlsx');
    const bare = outbound('七夕问候语');
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '222-openClaw 混排',
      cronExpr: '0 11 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: [
        '[技能: 的定时任务，cron为`0 * * * *`（每整点执行），内容为根据客户流向数据和七夕问候语使用「姚磊html网页设计]',
        '',
        '[文件: 客户流向_202606_合计_20260711_181706.xlsx] 和 [文件: 七夕问候语] 使用 [技能: 姚磊html网页设计（html）] 生成一份HTML报告，将报告链接发送给 @申通sclaw123。然后执行工作流 wf_78f13449（七夕问候语），将结果也发送给 @申通sclaw123。',
      ].join('\n'),
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      recipients: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
      }],
      workflowCode: 'wf_78f13449',
      workflowName: '七夕问候语',
      attachments: [
        {
          fileName: '客户流向_202606_合计_20260711_181706.xlsx',
          mimeType: 'application/octet-stream',
          sourcePath: xlsx,
        },
        {
          fileName: '七夕问候语',
          mimeType: 'application/octet-stream',
          sourcePath: bare,
        },
      ],
    });

    expect(aligned.prompt).not.toContain('定时任务');
    expect(aligned.prompt).not.toContain('cron为');
    expect([...aligned.prompt.matchAll(/\[技能:/g)]).toHaveLength(1);
    expect(aligned.prompt).toContain('[技能: 姚磊html网页设计]');

    const segments = aligned.extra?.composerSegments as Array<{
      type: string;
      title?: string;
      slug?: string;
      id?: string;
    }>;
    const skillSegs = segments.filter((s) => s.type === 'skill');
    expect(skillSegs).toHaveLength(1);
    expect(skillSegs[0]).toMatchObject({ slug: 'html', title: '姚磊html网页设计' });
    expect(segments.find((s) => s.type === 'workflow')).toMatchObject({
      id: 'wf_78f13449',
      name: '七夕问候语',
    });
    // skill 应在两个 file 之后（行内），不得堆在最前
    const types = segments.map((s) => s.type);
    expect(types.indexOf('skill')).toBeGreaterThan(types.indexOf('file'));
  });

  it('NL create: drops schema placeholder [技能: <技能slug/名称>] and keeps real inline skill', () => {
    const xlsx = outbound('客户流向.xlsx');
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '混排',
      cronExpr: '0 11 * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt: [
        '[技能: <技能slug/名称>]',
        '',
        '[文件: 客户流向.xlsx] 使用 [技能: 姚磊html网页设计] 生成报告发给 @申通sclaw123',
      ].join('\n'),
      skills: [
        { slug: '<技能slug/名称>', title: '<技能slug/名称>' },
        { slug: 'html', title: '姚磊html网页设计' },
      ],
      recipients: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
      }],
      attachments: [{
        fileName: '客户流向.xlsx',
        mimeType: 'application/octet-stream',
        sourcePath: xlsx,
      }],
    });

    expect(aligned.prompt).not.toContain('<技能slug');
    expect(aligned.prompt).not.toContain('技能slug/名称');
    expect([...aligned.prompt.matchAll(/\[技能:/g)]).toHaveLength(1);

    const skillSegs = (aligned.extra?.composerSegments as Array<{ type: string; title?: string }>)
      .filter((s) => s.type === 'skill');
    expect(skillSegs).toHaveLength(1);
    expect(skillSegs[0]?.title).toBe('姚磊html网页设计');
  });

  it('NL create: weaves pure-NL body into inline file/skill chips (no stacked prefix)', () => {
    const xlsx = outbound('客户流向_202606_合计_20260711_181902.xlsx');
    const md = outbound('greeting-七夕问候语.md');
    const aligned = alignScheduledTaskCreateToComposerModel({
      name: '整点执行 claude 混排',
      cronExpr: '0 * * * *',
      engineType: 'openclaw',
      agentId: 'main',
      prompt:
        '根据客户流向Excel数据和七夕问候语，使用「姚磊html网页设计」技能（html）生成一份HTML报告，将结果发送给@申通sclaw123群。然后执行工作流wf_78f13449（七夕问候语），将结果发送给@申通sclaw123群。',
      skills: [{ slug: 'html', title: '姚磊html网页设计' }],
      recipients: [{
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'ciduSCKFK3oNBK6eYUS1JrG1g==',
      }],
      workflowCode: 'wf_78f13449',
      workflowName: '七夕问候语',
      attachments: [
        {
          fileName: '客户流向_202606_合计_20260711_181902.xlsx',
          mimeType: 'application/octet-stream',
          sourcePath: xlsx,
        },
        {
          fileName: 'greeting-七夕问候语.md',
          mimeType: 'text/markdown',
          sourcePath: md,
        },
      ],
    });

    // 不得再落成 `[文件:] [文件:] [技能:]\n\n根据…`
    expect(aligned.prompt).not.toMatch(/^\[文件:.*\]\s*\[文件:.*\]\s*\[技能:/);
    expect(aligned.prompt).toMatch(/根据\s*\[文件:/);
    expect(aligned.prompt).toContain('[技能: 姚磊html网页设计]');
    expect(aligned.prompt).not.toContain('「姚磊html网页设计」技能');

    const types = (aligned.extra?.composerSegments as Array<{ type: string }>).map((s) => s.type);
    expect(types[0]).toBe('text');
    expect(types.indexOf('skill')).toBeGreaterThan(types.indexOf('file'));
    expect(types).toContain('workflow');
  });
});
