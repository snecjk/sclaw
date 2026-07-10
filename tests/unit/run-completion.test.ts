import { describe, expect, it } from 'vitest';
import { resolveAssistantFinalTerminalState } from '@/stores/chat/run-completion';
import type { RawMessage } from '@/stores/chat/types';

const textFinalMsg: RawMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Here is the summary.' }],
};

describe('resolveAssistantFinalTerminalState', () => {
  it('OpenClaw never terminal while sending (waits for agent.completed)', () => {
    const result = resolveAssistantFinalTerminalState(
      'openclaw',
      true,
      'completed',
      textFinalMsg,
    );
    expect(result.isTerminalOutput).toBe(false);
    expect(result.isAgenticRunFragment).toBe(true);
  });

  it('Claude intermediate final without completed phase is non-terminal while sending', () => {
    const result = resolveAssistantFinalTerminalState(
      'claude',
      true,
      undefined,
      textFinalMsg,
    );
    expect(result.isTerminalOutput).toBe(false);
    expect(result.isAgenticRunFragment).toBe(true);
  });

  it('Claude terminal when not sending', () => {
    const result = resolveAssistantFinalTerminalState(
      'claude',
      false,
      'completed',
      textFinalMsg,
    );
    expect(result.isTerminalOutput).toBe(true);
  });
});
