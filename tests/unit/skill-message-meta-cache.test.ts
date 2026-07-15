import { describe, expect, it, beforeEach } from 'vitest';
import {
  applySkillMetaCacheToMessages,
  applySkillLabelHeuristicToMessages,
  clearSkillMessageMetaCacheForTests,
  rememberSkillMessageMeta,
} from '@/lib/skill-message-meta-cache';
import type { RawMessage } from '@/stores/chat/types';
import { useSkillPlazaStore } from '@/stores/skill-plaza';

const SESSION = 'agent:main:session-test';
const SKILL = { slug: 'branch-assessment', title: '网点中转考核未达标主要影响客户' };

beforeEach(() => {
  clearSkillMessageMetaCacheForTests();
});

describe('skill-message-meta-cache', () => {
  it('restores skill meta by message id after history reload', () => {
    const messageId = 'msg-1';
    rememberSkillMessageMeta(SESSION, messageId, '', SKILL, 1_700_000_000_000);

    const history: RawMessage[] = [{
      id: messageId,
      role: 'user',
      content: SKILL.title,
      timestamp: 1_700_000_000,
    }];

    const restored = applySkillMetaCacheToMessages(history, SESSION);
    expect(restored[0]._skillMeta).toEqual(SKILL);
    expect(restored[0].content).toBe('');
  });

  it('restores skill meta and user text for skill + text sends', () => {
    const messageId = 'msg-2';
    const userText = '查网点432100的';
    rememberSkillMessageMeta(SESSION, messageId, userText, SKILL, 1_700_000_000_000);

    const history: RawMessage[] = [{
      id: messageId,
      role: 'user',
      content: `long injected prompt...\n${userText}`,
      timestamp: 1_700_000_000,
    }];

    const restored = applySkillMetaCacheToMessages(history, SESSION);
    expect(restored[0]._skillMeta).toEqual(SKILL);
    expect(restored[0].content).toBe(userText);
  });

  it('matches first user message when gateway stored only defaultPrompt', () => {
    rememberSkillMessageMeta(SESSION, 'msg-3', '', SKILL, 1_700_000_000_000);

    const history: RawMessage[] = [{
      id: 'gateway-echo',
      role: 'user',
      content: 'You are a skill assistant. Follow these steps...',
      timestamp: 1_700_000_000,
    }];

    const restored = applySkillMetaCacheToMessages(history, SESSION);
    expect(restored[0]._skillMeta).toEqual(SKILL);
    expect(restored[0].content).toBe('');
  });

  it('does not apply cached skill meta to unrelated sessions', () => {
    rememberSkillMessageMeta(SESSION, 'msg-4', '', SKILL);

    const otherSession = 'agent:main:session-other';
    const history: RawMessage[] = [{
      id: 'msg-4',
      role: 'user',
      content: SKILL.title,
      timestamp: Date.now() / 1000,
    }];

    const restored = applySkillMetaCacheToMessages(history, otherSession);
    expect(restored[0]._skillMeta).toBeUndefined();
  });

  it('infers skill tag from session label when cache is missing', () => {
    useSkillPlazaStore.setState({
      plazaSkills: [{
        slug: SKILL.slug,
        title: SKILL.title,
        defaultPrompt: 'prompt',
        description: '',
        tags: [],
        author: '',
        version: '1',
      }],
      mySkills: [],
    });

    const history: RawMessage[] = [{
      id: 'legacy',
      role: 'user',
      content: SKILL.title,
      timestamp: 1_700_000_000,
    }];

    const restored = applySkillLabelHeuristicToMessages(history, SKILL.title);
    expect(restored[0]._skillMeta).toEqual(SKILL);
    expect(restored[0].content).toBe('');
  });
});
