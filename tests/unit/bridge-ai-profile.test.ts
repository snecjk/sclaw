import { describe, expect, it } from 'vitest';
import {
  appendBridgeAiSkillPrompt,
  resolveBridgeAiInvocationPlan,
  resolveBridgeAiMemoryPolicy,
  resolveBridgeAiQuota,
  resolveBridgeAiSkillSlugs,
} from '../../electron/main/services/jsbridge/bridge-ai-profile';
import { BRIDGE_AI_DEFAULT_QUOTA } from '../../shared/jsbridge/bridge-ai-protocol';

describe('resolveBridgeAiInvocationPlan', () => {
  const baseProfile = {
    enabled: true,
    agentId: 'main',
    systemPrompt: 'You are a form assistant.',
    skills: ['form-helper'],
    allowedSkillSlugs: ['form-helper', 'validator'],
    responseFormat: 'text' as const,
  };

  it('allows call-level overrides for agentId and responseFormat only', () => {
    const plan = resolveBridgeAiInvocationPlan(baseProfile, {
      prompt: 'check this',
      agentId: 'research',
      responseFormat: 'json',
    });
    expect(plan.agentId).toBe('research');
    expect(plan.responseFormat).toBe('json');
    expect(plan.memoryMode).toBe('none');
    expect(plan.skipMemoryRead).toBe(true);
    expect(plan.skipMemoryWrite).toBe(true);
  });

  it('merges profile skills with allowed request skills', () => {
    const plan = resolveBridgeAiInvocationPlan(baseProfile, {
      prompt: 'check this',
      skillSlugs: ['validator'],
    });
    expect(plan.skillSlugs).toEqual(['form-helper', 'validator']);
  });

  it('rejects skills outside the whitelist', () => {
    expect(() => resolveBridgeAiInvocationPlan(baseProfile, {
      prompt: 'check this',
      skillSlugs: ['secret-skill'],
    })).toThrow(/skill not allowed/i);
  });

  it('applies default quota when profile omits quota', () => {
    expect(resolveBridgeAiQuota({ enabled: true })).toEqual(BRIDGE_AI_DEFAULT_QUOTA);
  });
});

describe('resolveBridgeAiMemoryPolicy', () => {
  it('defaults to none (no read, no write)', () => {
    expect(resolveBridgeAiMemoryPolicy('none')).toEqual({
      skipMemoryRead: true,
      skipMemoryWrite: true,
    });
  });

  it('user-read reads but does not write', () => {
    expect(resolveBridgeAiMemoryPolicy('user-read')).toEqual({
      skipMemoryRead: false,
      skipMemoryWrite: true,
    });
  });

  it('app mode isolates from global user memory', () => {
    expect(resolveBridgeAiMemoryPolicy('app')).toEqual({
      skipMemoryRead: true,
      skipMemoryWrite: true,
    });
  });
});

describe('resolveBridgeAiSkillSlugs', () => {
  it('deduplicates merged skills', () => {
    expect(resolveBridgeAiSkillSlugs(
      { enabled: true, skills: ['A'], allowedSkillSlugs: ['a'] },
      { skillSlugs: ['A'] },
    )).toEqual(['a']);
  });
});

describe('appendBridgeAiSkillPrompt', () => {
  it('appends a skill block when skills are present', () => {
    const result = appendBridgeAiSkillPrompt('base', ['form-helper']);
    expect(result).toContain('## Skills');
    expect(result).toContain('form-helper');
    expect(result?.startsWith('base')).toBe(true);
  });
});
