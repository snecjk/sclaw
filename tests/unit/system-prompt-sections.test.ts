import { describe, expect, it } from 'vitest';
import {
  assembleSystemPromptAppend,
  EXPECTED_SYSTEM_PROMPT_SECTIONS,
  isSectionAllowedForKind,
  SYSTEM_PROMPT_SECTION_IDS,
  type SystemPromptSectionId,
  type SystemPromptSessionKind,
} from '../../shared/system-prompt-sections';

const KINDS = Object.keys(EXPECTED_SYSTEM_PROMPT_SECTIONS) as SystemPromptSessionKind[];

describe('assembleSystemPromptAppend', () => {
  it('joins in section-id order and drops empty text', () => {
    const text = assembleSystemPromptAppend([
      { id: 'caller', text: 'caller-block' },
      { id: 'cwd', text: 'cwd-block' },
      { id: 'memory', text: '  ' },
      { id: 'resume-interrupt', text: 'resume-block' },
    ]);
    expect(text).toBe('cwd-block\n\ncaller-block\n\nresume-block');
  });

  it('merges the same id instead of letting call-site order win', () => {
    expect(assembleSystemPromptAppend([
      { id: 'caller', text: 'first' },
      { id: 'caller', text: 'second' },
    ])).toBe('first\n\nsecond');
  });
});

describe('system prompt section × session kind matrix', () => {
  it('covers every section id in at least one kind', () => {
    const seen = new Set<SystemPromptSectionId>();
    for (const kind of KINDS) {
      for (const id of EXPECTED_SYSTEM_PROMPT_SECTIONS[kind]) seen.add(id);
    }
    expect([...seen].sort()).toEqual([...SYSTEM_PROMPT_SECTION_IDS].sort());
  });

  it.each(KINDS)('%s only allows listed sections', (kind) => {
    for (const id of SYSTEM_PROMPT_SECTION_IDS) {
      expect(isSectionAllowedForKind(kind, id)).toBe(
        EXPECTED_SYSTEM_PROMPT_SECTIONS[kind].includes(id),
      );
    }
  });

  it('keeps scheduled-task and bridge-ai-skill off interactive sessions', () => {
    expect(isSectionAllowedForKind('interactive', 'scheduled-task')).toBe(false);
    expect(isSectionAllowedForKind('interactive', 'bridge-ai-skill')).toBe(false);
    expect(isSectionAllowedForKind('scheduled', 'scheduled-task')).toBe(true);
    expect(isSectionAllowedForKind('bridge', 'bridge-ai-skill')).toBe(true);
  });
});
