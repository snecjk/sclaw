import { describe, expect, it } from 'vitest';
import { mergeInstructionTextIntoSegments } from '../../src/pages/MyTask/components/TaskInstructionComposer';
import {
  persistedSegmentsToComposer,
  sanitizeEditPlainText,
  sanitizePersistedTextSegmentForEdit,
} from '../../src/components/input-composer/use-input-composer-edit-draft';
import { stripInstructionFromTaskMessage } from '../../src/lib/scheduled-task-recipients';
import type { PersistedComposerSegment } from '../../src/lib/dingtalk-mention-composer';

describe('mergeInstructionTextIntoSegments', () => {
  it('weaves cleaned prompt text when segments only have chips', () => {
    const segments: PersistedComposerSegment[] = [
      {
        type: 'file',
        fileName: 'a.xlsx',
        mimeType: 'application/octet-stream',
        fileSize: 0,
        preview: null,
        filePath: '/tmp/a.xlsx',
        stagedPath: '/tmp/a.xlsx',
      },
      {
        type: 'mention',
        mention: { type: 'user', displayName: '侯正亚', userId: 'u1' },
      },
      {
        type: 'workflow',
        id: 'wf_78f13449',
        name: '七夕问候语',
        source: 'mine',
      },
    ];
    const prompt =
      '[文件: a.xlsx]\n\n生成报告并发送至@侯正亚。然后执行工作流 wf_78f13449（七夕问候语）';

    const merged = mergeInstructionTextIntoSegments(segments, prompt);
    expect(merged.map((s) => s.type)).toEqual(['file', 'text', 'mention', 'text', 'workflow']);
    const text = merged
      .filter((s): s is Extract<PersistedComposerSegment, { type: 'text' }> => s.type === 'text')
      .map((s) => s.text)
      .join('');
    expect(text).toContain('生成报告');
    expect(text).not.toContain('@侯正亚');
    expect(text).not.toContain('[文件:');
  });

  it('keeps existing text segments untouched', () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '已有正文' },
      {
        type: 'mention',
        mention: { type: 'group', displayName: '群', openConversationId: 'cid1' },
      },
    ];
    const merged = mergeInstructionTextIntoSegments(segments, '另一段 prompt');
    expect(merged).toEqual(segments);
  });

  it('preserves paragraph breaks when weaving prompt text into chip-only segments', () => {
    const segments: PersistedComposerSegment[] = [
      {
        type: 'mention',
        mention: { type: 'user', displayName: '侯正亚', userId: 'u1' },
      },
    ];
    const prompt = '发送给@侯正亚\n\n另外再 查询上海青浦的天气\n将结果发送给群';
    const merged = mergeInstructionTextIntoSegments(segments, prompt);
    const text = merged
      .filter((s): s is Extract<PersistedComposerSegment, { type: 'text' }> => s.type === 'text')
      .map((s) => s.text)
      .join('');
    expect(merged.map((s) => s.type)).toContain('mention');
    expect(text).toContain('\n\n另外再');
    expect(text).toContain('\n将结果发送给群');
  });
});

describe('sanitizeEditPlainText (chat 冷读编辑降级路径换行保真, B-1)', () => {
  it('preserves paragraph breaks instead of collapsing to a single line', () => {
    const input = '第一段\n\n第二段\n第三段';
    expect(sanitizeEditPlainText(input)).toBe('第一段\n\n第二段\n第三段');
  });

  it('collapses inline whitespace but keeps line breaks', () => {
    const input = '第一段   继续\n\n   第二段  ';
    expect(sanitizeEditPlainText(input)).toBe('第一段 继续\n\n第二段');
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    const input = '第一段\n\n\n\n第二段';
    expect(sanitizeEditPlainText(input)).toBe('第一段\n\n第二段');
  });

  it('strips gateway placeholders and media attached while keeping line breaks', () => {
    const input = '[文件: report.pdf]\n\n帮我总结今天\n[media attached: /p/r.pdf (application/pdf) | /p/r.pdf]';
    expect(sanitizeEditPlainText(input)).toBe('帮我总结今天');
  });
});

describe('stripInstructionFromTaskMessage 老数据兜底 (B-2)', () => {
  it('returns the body when the prompt has a 用户消息： boundary', () => {
    const prompt = '[STOCLAW:DINGTALK_RECIPIENTS:v1]\n```json\n[]\n```\n\n---\n\n用户消息：\n帮我总结今天';
    expect(stripInstructionFromTaskMessage(prompt)).toBe('帮我总结今天');
  });

  it('falls back to lenient-cleaned text when recipient block has no 用户消息： boundary and no segment text', () => {
    const prompt = [
      '[STOCLAW:DINGTALK_RECIPIENTS:v1]',
      '```json',
      '[{ "userId": "u1", "displayName": "侯正亚" }]',
      '```',
      '4. **定时任务：以上 JSON 内收件人必须发送**',
      '5. **【P0 收件人并集 + 同一正文】**',
      '6. **【P0 禁止回执上钉钉】**',
      '帮我总结今天的报告',
    ].join('\n');
    const result = stripInstructionFromTaskMessage(prompt);
    expect(result).toBe('帮我总结今天的报告');
    expect(result).not.toContain('[STOCLAW:DINGTALK_RECIPIENTS:v1]');
    expect(result).not.toContain('定时任务');
    expect(result).not.toContain('[文件:');
  });

  it('returns empty when recipient block has no boundary but segments already carry text', () => {
    const prompt = '[STOCLAW:DINGTALK_RECIPIENTS:v1]\n```json\n[]\n```\n4. 定时任务：必发';
    const segments = [{ type: 'text', text: 'segments 里的正文' }];
    expect(stripInstructionFromTaskMessage(prompt, segments)).toBe('');
  });

  it('returns the prompt unchanged when there is no recipient context', () => {
    const prompt = '普通任务描述，无收件人块';
    expect(stripInstructionFromTaskMessage(prompt)).toBe('普通任务描述，无收件人块');
  });

  it('strips SClaw-Skill marker from stock task prompts on edit/list display', () => {
    const prompt = [
      '根据文件生成 html',
      '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计","userText":"根据\\n\\n生成"} -->',
    ].join('\n');
    const result = stripInstructionFromTaskMessage(prompt);
    expect(result).toBe('根据文件生成 html');
    expect(result).not.toMatch(/SClaw-Skill/);
    expect(result).not.toContain('\\n');
  });
});

describe('带 skill 时编辑回填换行保真', () => {
  const skill = { slug: 'html', title: '姚磊html网页设计' };

  it('preserves leading paragraph breaks on text segments even when skill is present', () => {
    // 回归：sanitize 曾无条件调用 stripSkillGatewayPrefix → body.trim()，
    // 把「\n\n结果发送给」吃成「结果发送给」，再编辑看起来换行丢失。
    expect(sanitizePersistedTextSegmentForEdit('\n\n结果发送给 ', skill)).toBe('\n\n结果发送给 ');
    expect(sanitizePersistedTextSegmentForEdit('\n\n', skill)).toBe('\n\n');
  });

  it('persistedSegmentsToComposer keeps newline-only and leading-break text segments with skill chips', () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '生成一份 html 并把结果发送到 ' },
      { type: 'skill', slug: 'html', title: '姚磊html网页设计' },
      { type: 'text', text: '\n\n' },
      {
        type: 'mention',
        mention: { type: 'user', displayName: '侯正亚', userId: 'u1' },
      },
      { type: 'text', text: '\n\n查询一下上海青浦天气发送给 ' },
      {
        type: 'mention',
        mention: { type: 'user', displayName: '谷研硕', userId: 'u2' },
      },
    ];
    const converted = persistedSegmentsToComposer(segments);
    const texts = converted.segments
      .filter((s): s is Extract<(typeof converted.segments)[number], { type: 'text' }> => s.type === 'text')
      .map((s) => s.text);
    expect(texts).toEqual([
      '生成一份 html 并把结果发送到 ',
      '\n\n',
      '\n\n查询一下上海青浦天气发送给 ',
    ]);
  });

  it('still strips real skill gateway prefix when present', () => {
    expect(sanitizePersistedTextSegmentForEdit(
      '[Thu 2026-08-13 10:17 GMT+8] html\n根据 ',
      skill,
    )).toBe('根据');
  });
});

describe('NL 创建任务字面 \\n 回填归一化 (C-3)', () => {
  it('persistedSegmentsToComposer unescapes literal \\n in text segments only when enabled', () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '第一段\\n\\n第二段\\t继续' },
    ];
    // 默认（UI 创建）：保留字面 `\n`（用户可能故意输入）
    const ui = persistedSegmentsToComposer(segments);
    const uiText = ui.segments.find((s) => s.type === 'text');
    expect(uiText?.type).toBe('text');
    if (uiText?.type === 'text') {
      expect(uiText.text).toBe('第一段\\n\\n第二段\\t继续');
    }
    // NL 创建：字面 `\n`/`\t` 还原成真换行/制表
    const nl = persistedSegmentsToComposer(segments, undefined, { unescapeLiteralNewlines: true });
    const nlText = nl.segments.find((s) => s.type === 'text');
    expect(nlText?.type).toBe('text');
    if (nlText?.type === 'text') {
      expect(nlText.text).toBe('第一段\n\n第二段\t继续');
    }
  });

  it('mergeInstructionTextIntoSegments unescapes literal \\n when enabled for NL tasks', () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'mention', mention: { type: 'user', displayName: '侯正亚', userId: 'u1' } },
    ];
    const instructions = '发送给@侯正亚\\n\\n然后查询天气';
    const merged = mergeInstructionTextIntoSegments(segments, instructions, {
      unescapeLiteralNewlines: true,
    });
    const text = merged
      .filter((s): s is Extract<PersistedComposerSegment, { type: 'text' }> => s.type === 'text')
      .map((s) => s.text)
      .join('');
    expect(text).toContain('\n\n然后查询天气');
    expect(text).not.toContain('\\n');
  });

  it('idempotent: re-normalizing already-normalized segments is a no-op', () => {
    const segments: PersistedComposerSegment[] = [
      { type: 'text', text: '第一行\n第二行' },
    ];
    const once = persistedSegmentsToComposer(segments, undefined, { unescapeLiteralNewlines: true });
    const twice = persistedSegmentsToComposer(once.segments, undefined, { unescapeLiteralNewlines: true });
    const text = twice.segments.find((s) => s.type === 'text');
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text).toBe('第一行\n第二行');
    }
  });
});
