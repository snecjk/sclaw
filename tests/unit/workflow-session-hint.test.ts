import { describe, expect, it } from 'vitest';
import { appendDingTalkMentionContext } from '../../shared/dingtalk-mention-context';
import {
  deriveSessionLabelFromHistory,
  deriveSessionLabelFromUserText,
  extractSubagentTaskLabel,
  isCorruptedSessionLabel,
  isSubagentContextOnlyLabel,
  normalizeDerivedSessionLabel,
} from '@/lib/workflow-session-hint';

const SUBAGENT_KICKOFF = `[Subagent Context] You are running as a subagent (depth 1/1). Results auto-announce to your requester; do not busy-poll for status.

[Subagent Task]
Research sai-cli policy commands for sewage discharge metrics

Begin. Execute the assigned task to completion.`;

describe('subagent session label helpers', () => {
  it('extracts delegated task from OpenClaw subagent kickoff message', () => {
    expect(extractSubagentTaskLabel(SUBAGENT_KICKOFF)).toBe(
      'Research sai-cli policy commands for sewage discharge metrics',
    );
  });

  it('does not treat subagent boilerplate as a user-visible title', () => {
    expect(deriveSessionLabelFromUserText(SUBAGENT_KICKOFF)).toBe(
      'Research sai-cli policy commands for sewage discharge metrics',
    );
    expect(isSubagentContextOnlyLabel('[Subagent Context] You are running as a subagent')).toBe(true);
    expect(isCorruptedSessionLabel('[Subagent Context] You are running as a…')).toBe(true);
  });

  it('uses the first real user message when subagent injection is absent', () => {
    const label = deriveSessionLabelFromHistory(
      [
        { role: 'user', content: '全国排污水量是多少' },
        { role: 'assistant', content: '正在查询…' },
      ],
      (content) => String(content ?? ''),
    );
    expect(label).toBe('全国排污水量是多少');
  });

  it('falls back to parent session title when subagent task text is missing', () => {
    const label = deriveSessionLabelFromHistory(
      [
        {
          role: 'user',
          content: '[Subagent Context] You are running as a subagent (depth 1/1).\n\nBegin. Execute the assigned task to completion.',
        },
      ],
      (content) => String(content ?? ''),
      {
        sessionKey: 'agent:main:subagent:child-1',
        spawnedBy: 'agent:main:session-parent',
        sessionLabels: { 'agent:main:session-parent': '全国排污水量是多少' },
        sessions: [{ key: 'agent:main:session-parent', label: '全国排污水量是多少' }],
      },
    );
    expect(label).toBe('全国排污水量是多少');
  });

  it('prefers spawn label from gateway metadata when provided', () => {
    const label = deriveSessionLabelFromHistory(
      [{ role: 'user', content: SUBAGENT_KICKOFF }],
      (content) => String(content ?? ''),
      { gatewayLabel: 'policy-research' },
    );
    expect(label).toBe('policy-research');
  });

  it('derives title from user text after stripping DingTalk recipient injection', () => {
    const wrapped = appendDingTalkMentionContext('@赵志坚 今晚记得学习哦', [
      { type: 'user', displayName: '赵志坚', userId: 'uid-1' },
    ]);
    expect(deriveSessionLabelFromUserText(wrapped)).toBe('@赵志坚 今晚记得学习哦');
    expect(isCorruptedSessionLabel('[STOCLAW:DINGTALK_RECIPIENTS:v1]')).toBe(true);
  });

  it('derives DingTalk session title from history messages', () => {
    const wrapped = appendDingTalkMentionContext('发一条上海明天的天气给文鹏', [
      { type: 'user', displayName: '文鹏', userId: 'uid-1' },
    ]);
    const label = deriveSessionLabelFromHistory(
      [{ role: 'user', content: wrapped }],
      (content) => String(content ?? ''),
    );
    expect(label).toBe('发一条上海明天的天气给文鹏');
  });

  it('normalizeDerivedSessionLabel rejects DingTalk marker titles', () => {
    expect(normalizeDerivedSessionLabel('[STOCLAW:DINGTALK_RECIPIENTS:v1]')).toBeUndefined();
    expect(normalizeDerivedSessionLabel('@赵志坚 今晚记得学习哦')).toBe('@赵志坚 今晚记得学习哦');
  });

  it('strips the SClaw-Skill transcript marker from derived titles', () => {
    const withMarker = '网点面单报价\n<!-- SClaw-Skill {"slug":"site-waybill-fee","title":"网点面单报价"} -->';
    expect(deriveSessionLabelFromUserText(withMarker)).toBe('网点面单报价');
    const label = deriveSessionLabelFromHistory(
      [{ role: 'user', content: withMarker }],
      (content) => String(content ?? ''),
    );
    expect(label).toBe('网点面单报价');
  });

  it('treats persisted SClaw-Skill marker titles as corrupted so they get re-derived', () => {
    expect(isCorruptedSessionLabel('网点面单报价 <!-- SClaw-Skill {"slug":"si…')).toBe(true);
    expect(normalizeDerivedSessionLabel('网点面单报价 <!-- SClaw-Skill {"slug":"si…')).toBeUndefined();
  });
});
