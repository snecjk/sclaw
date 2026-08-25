import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  extractComposerHintsFromText,
  mergeComposerHintsIntoCreateInput,
  parseStoClawOutboundPathsFromText,
} from '../../electron/scheduled-tasks/scheduled-task-nl-hints';
import { alignScheduledTaskCreateToComposerModel } from '../../electron/scheduled-tasks/scheduled-task-nl-create';

const OUTBOUND = join(homedir(), '.stoclaw/openclaw/media/outbound');
const XLSX = join(OUTBOUND, '002b67ef-4175-43f1-a790-78605e605842.xlsx');
const BARE = join(OUTBOUND, '0eca1f5f-0776-4dbb-af55-39e363072bc1');

describe('extractComposerHintsFromText', () => {
  it('recovers skill/workflow from NL create prompt that omitted structured fields', () => {
    const prompt =
      '根据文件「客户流向_202606_合计_20260711_181706.xlsx」和「七夕问候语」，'
      + '使用「姚磊html网页设计」技能生成一份七夕主题的客户流向HTML报告，上传到钉钉云盘，'
      + '将报告链接发送给@申通sclaw123群。然后执行工作流 wf_78f13449（七夕问候语），将结果发送给@侯正亚。';

    const hints = extractComposerHintsFromText(prompt);
    expect(hints.workflowCode).toBe('wf_78f13449');
    expect(hints.workflowName).toBe('七夕问候语');
    expect(hints.skills.some((s) => s.slug === 'html' || s.title?.includes('姚磊html'))).toBe(true);
  });

  it('recovers media + skill marker + workflow from gateway user message', () => {
    const userMessage = [
      '根据 [文件: 客户流向.xlsx] 和 [文件: 七夕问候语] 使用 [技能: 姚磊html网页设计] 生成 html',
      '帮我执行 id 为：wf_78f13449 的工作流 【七夕问候语】',
      '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计"} -->',
      `[media attached: ${XLSX} (application/octet-stream) | ${XLSX}]`,
      `[media attached: ${BARE} (application/octet-stream) | ${BARE}]`,
    ].join('\n');

    const hints = extractComposerHintsFromText(userMessage);
    expect(hints.workflowCode).toBe('wf_78f13449');
    expect(hints.workflowName).toBe('七夕问候语');
    expect(hints.skills[0]?.slug).toBe('html');
    expect(hints.attachments).toHaveLength(2);
    expect(hints.attachments[0]?.fileName).toBe('客户流向.xlsx');
    expect(hints.attachments[1]?.fileName).toBe('七夕问候语');
  });

  it('recovers bare ~/.stoclaw outbound paths with （展示名） from model prompt', () => {
    const prompt =
      `根据文件 ${XLSX}（客户流向_202606_合计）和文件 ${BARE}（七夕问候语）`
      + ' 使用「姚磊html网页设计」技能生成 html，然后执行工作流 wf_78f13449（七夕问候语）';

    const paths = parseStoClawOutboundPathsFromText(prompt);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.fileName).toBe('客户流向_202606_合计.xlsx');
    expect(paths[1]?.fileName).toBe('七夕问候语');
    expect(paths[0]?.provenance).toEqual({ kind: 'local' });

    const hints = extractComposerHintsFromText(prompt);
    expect(hints.attachments).toHaveLength(2);
    expect(hints.workflowCode).toBe('wf_78f13449');
  });
});

describe('mergeComposerHintsIntoCreateInput + align', () => {
  it('fills missing structured fields before align (prompt-only case)', () => {
    const enriched = mergeComposerHintsIntoCreateInput({
      name: '全场景 openClaw 定时任务',
      cronExpr: '30 10 * * *',
      engineType: 'openclaw' as const,
      agentId: 'main',
      prompt:
        '根据文件「客户流向.xlsx」和「七夕问候语」，使用「姚磊html网页设计」技能生成报告。'
        + '然后执行工作流 wf_78f13449（七夕问候语），发给@侯正亚。',
      recipients: [
        { type: 'user' as const, displayName: '侯正亚', userId: 'u1' },
      ],
    }, []);

    expect(enriched.workflowCode).toBe('wf_78f13449');
    expect(enriched.workflowName).toBe('七夕问候语');
    expect(enriched.skillCode === 'html' || enriched.skills?.[0]?.slug === 'html'
      || enriched.skills?.[0]?.title?.includes('姚磊html')).toBe(true);

    const aligned = alignScheduledTaskCreateToComposerModel(enriched);
    expect(aligned.workflowCode).toBeNull();
    expect(aligned.skillCode).toBeNull();
    expect(aligned.dingtalkRecipients).toBeNull();
    const types = (aligned.extra?.composerSegments as Array<{ type: string }>).map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(['skill', 'mention', 'workflow']));
  });

  it('prefers session user message media paths when model omitted attachments', () => {
    const sessionText = [
      '根据 [文件: 客户流向.xlsx] 使用 [技能: 姚磊html网页设计]',
      '帮我执行 id 为：wf_78f13449 的工作流 【七夕问候语】',
      '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计"} -->',
      `[media attached: ${XLSX} (application/octet-stream) | ${XLSX}]`,
    ].join('\n');

    const enriched = mergeComposerHintsIntoCreateInput({
      name: 't',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw' as const,
      agentId: 'main',
      prompt: '用文件和技能做报告，再跑工作流',
    }, [sessionText]);

    expect(enriched.attachments?.[0]?.sourcePath).toContain('002b67ef');
    expect(enriched.attachments?.[0]?.fileName).toBe('客户流向.xlsx');
    expect(enriched.skillCode).toBe('html');
    expect(enriched.workflowCode).toBe('wf_78f13449');
  });

  it('align produces file segments from bare outbound paths in prompt', () => {
    const enriched = mergeComposerHintsIntoCreateInput({
      name: 't',
      cronExpr: '0 9 * * *',
      engineType: 'openclaw' as const,
      agentId: 'main',
      prompt:
        `根据文件 ${XLSX}（客户流向_202606_合计）和文件 ${BARE}（七夕问候语）`
        + ' 使用技能生成报告，执行工作流 wf_78f13449（七夕问候语）',
    }, []);

    const aligned = alignScheduledTaskCreateToComposerModel(enriched);
    const segs = aligned.extra?.composerSegments as Array<{ type: string; fileName?: string }>;
    const files = segs.filter((s) => s.type === 'file');
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.fileName)).toEqual(
      expect.arrayContaining(['客户流向_202606_合计.xlsx', '七夕问候语']),
    );
    expect(aligned.extra?.composerAttachments).toHaveLength(2);
    expect(aligned.prompt).not.toContain('.stoclaw/openclaw/media/outbound');
    expect(aligned.prompt).toContain('[文件: 客户流向_202606_合计.xlsx]');
  });
});
