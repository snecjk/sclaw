import { describe, expect, it } from 'vitest';
import {
  parseSkillTranscriptMarkers,
  stripSkillTranscriptMarkers,
} from '../../shared/skill-transcript-marker';

describe('shared/skill-transcript-marker', () => {
  it('strips v1 markers including userText with literal \\n', () => {
    const text = [
      '业务正文第一段',
      '',
      '业务正文第二段',
      '<!-- SClaw-Skill {"slug":"html","title":"姚磊html网页设计","userText":"业务正文第一段\\n\\n业务正文第二段"} -->',
    ].join('\n');
    const stripped = stripSkillTranscriptMarkers(text);
    expect(stripped).toBe('业务正文第一段\n\n业务正文第二段');
    expect(stripped).not.toMatch(/SClaw-Skill/);
    expect(stripped).not.toContain('\\n');
  });

  it('strips multiple markers and parses all slugs', () => {
    const text = [
      'do work',
      '<!-- SClaw-Skill {"slug":"a","title":"A"} -->',
      '<!-- SClaw-Skill:v2 [{"slug":"b","title":"B"},{"slug":"c","title":"C"}] -->',
    ].join('\n');
    expect(stripSkillTranscriptMarkers(text).trim()).toBe('do work');
    expect(parseSkillTranscriptMarkers(text)).toEqual([
      { slug: 'a', title: 'A' },
      { slug: 'b', title: 'B' },
      { slug: 'c', title: 'C' },
    ]);
  });

  it('is idempotent when no marker is present', () => {
    expect(stripSkillTranscriptMarkers('普通正文\n第二行')).toBe('普通正文\n第二行');
    expect(parseSkillTranscriptMarkers('普通正文')).toEqual([]);
  });
});
