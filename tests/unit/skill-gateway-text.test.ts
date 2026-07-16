import { describe, expect, it } from 'vitest';
import { resolveSkillGatewayText } from '@/lib/skill-gateway-text';

describe('resolveSkillGatewayText', () => {
  it('returns defaultPrompt when user text is empty', () => {
    expect(resolveSkillGatewayText('帮我完成对账', '')).toBe('帮我完成对账');
    expect(resolveSkillGatewayText('帮我完成对账', '   ')).toBe('帮我完成对账');
  });

  it('concatenates defaultPrompt and user text', () => {
    expect(resolveSkillGatewayText('帮我完成对账', '查上月')).toBe('帮我完成对账\n\n查上月');
  });

  it('falls back to user text when defaultPrompt is empty', () => {
    expect(resolveSkillGatewayText('', '仅用户输入')).toBe('仅用户输入');
  });
});
