import { describe, expect, it } from 'vitest';
import {
  appendSkillTranscriptMarker,
  applySkillTranscriptMetaToMessages,
  deriveSkillUserDisplayText,
  normalizeSkillBubbleDisplayText,
  parseSkillTranscriptMarker,
  stripSkillTranscriptMarker,
} from '@/lib/skill-transcript-marker';
import { normalizeUserMessageForDisplay } from '@/lib/user-message-display';
import { restoreSkillMetaOnMessages } from '@/lib/skill-message-meta-cache';
import type { RawMessage } from '@/stores/chat/types';
import { useSkillPlazaStore } from '@/stores/skill-plaza';

const SKILL = { slug: 'branch-assessment', title: '网点中转考核未达标主要影响客户' };
const PROMPT = 'Analyze branch transfer KPI impact.';

describe('skill-transcript-marker', () => {
  it('appends and parses hidden transcript marker', () => {
    const gatewayText = `${PROMPT}\n\n查网点432100的`;
    const marked = appendSkillTranscriptMarker(gatewayText, SKILL);
    expect(parseSkillTranscriptMarker(marked)).toEqual(SKILL);
    expect(stripSkillTranscriptMarker(marked)).toBe(gatewayText);
  });

  it('strips marker from display normalization', () => {
    const marked = appendSkillTranscriptMarker(PROMPT, SKILL);
    expect(normalizeUserMessageForDisplay(marked)).toBe(PROMPT);
  });

  it('restores skill tag and user text from transcript history', () => {
    useSkillPlazaStore.setState({
      plazaSkills: [{
        slug: SKILL.slug,
        title: SKILL.title,
        defaultPrompt: PROMPT,
        description: '',
        tags: [],
        author: '',
        version: '1',
      }],
      mySkills: [],
    });

    const userText = '查网点432100的';
    const gatewayText = `${PROMPT}\n\n${userText}`;
    const history: RawMessage[] = [{
      id: 'from-gateway',
      role: 'user',
      content: appendSkillTranscriptMarker(gatewayText, SKILL),
      timestamp: 1_700_000_000,
    }];

    const restored = applySkillTranscriptMetaToMessages(history);
    expect(restored[0]._skillMeta).toEqual(SKILL);
    expect(restored[0].content).toBe(userText);
    expect(deriveSkillUserDisplayText(gatewayText, SKILL.slug)).toBe(userText);
  });

  it('prefers transcript marker over localStorage cache', () => {
    const history: RawMessage[] = [{
      id: 'msg',
      role: 'user',
      content: appendSkillTranscriptMarker(PROMPT, SKILL),
      timestamp: 1_700_000_000,
    }];

    const restored = restoreSkillMetaOnMessages(history, 'agent:main:session-x', SKILL.title);
    expect(restored[0]._skillMeta).toEqual(SKILL);
    expect(restored[0].content).toBe('');
  });

  it('does not repeat skill title in bubble body', () => {
    expect(normalizeSkillBubbleDisplayText('网点出港派费', '网点出港派费')).toBe('');
    expect(normalizeSkillBubbleDisplayText('网点面单报价', '查询网点编码432100的')).toBe('查询网点编码432100的');
    expect(normalizeSkillBubbleDisplayText('总部结算对账分析', '总部结算对账分析\n查湖北孝感公司这个网点的')).toBe('查湖北孝感公司这个网点的');
  });

  it('derives user text from real gateway history payload with metadata and prompt prefix', () => {
    useSkillPlazaStore.setState({
      plazaSkills: [{
        slug: 'dz-skill',
        title: '总部结算对账分析',
        defaultPrompt: '总部结算对账分析',
        description: '',
        tags: [],
        author: '',
        version: '1',
      }],
      mySkills: [],
    });

    const raw = [
      'Sender (untrusted metadata):',
      '```json',
      '{"label":"SClaw"}',
      '```',
      '',
      '[Thu 2026-07-09 13:09 GMT+8] 总部结算对账分析',
      '',
      '查湖北孝感公司这个网点的',
      appendSkillTranscriptMarker('', { slug: 'dz-skill', title: '总部结算对账分析' }).trim(),
    ].join('\n');

    const history: RawMessage[] = [{
      id: 'history-user',
      role: 'user',
      content: raw,
      timestamp: 1_700_000_000,
    }];

    const restored = applySkillTranscriptMetaToMessages(history);
    expect(restored[0]._skillMeta).toEqual({ slug: 'dz-skill', title: '总部结算对账分析' });
    expect(restored[0].content).toBe('查湖北孝感公司这个网点的');
  });
});
