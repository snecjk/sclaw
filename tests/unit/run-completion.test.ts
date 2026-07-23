import { describe, expect, it } from 'vitest';
import { resolveAssistantFinalTerminalState } from '@/stores/chat/run-completion';
import type { RawMessage } from '@/stores/chat/types';

const textFinalMsg: RawMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Here is the summary.' }],
};

describe('resolveAssistantFinalTerminalState', () => {
  it('OpenClaw text final without pending tools is terminal while sending', () => {
    const result = resolveAssistantFinalTerminalState(
      'openclaw',
      true,
      undefined,
      textFinalMsg,
    );
    expect(result.isTerminalOutput).toBe(true);
    expect(result.isAgenticRunFragment).toBe(false);
  });

  it('OpenClaw merged buffer with historical tool_use + trailing text is terminal', () => {
    const mergedFinal: RawMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'exec', input: { command: 'weather' } },
        { type: 'text', text: '青浦现在晴，29°C。' },
      ],
    };
    const result = resolveAssistantFinalTerminalState(
      'openclaw',
      true,
      undefined,
      mergedFinal,
    );
    expect(result.isTerminalOutput).toBe(true);
    expect(result.isAgenticRunFragment).toBe(false);
  });

  it('OpenClaw tool_use final stays non-terminal while sending', () => {
    const toolFinalMsg: RawMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: '让我查一下' },
        { type: 'tool_use', id: 't1', name: 'weather', input: {} },
      ],
    };
    const result = resolveAssistantFinalTerminalState(
      'openclaw',
      true,
      undefined,
      toolFinalMsg,
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
