import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import {
  isClaudeRuntimeResultDone,
  resolveAssistantFinalTerminalState,
  shouldAutoCompleteClaudeFromHistory,
} from '@/stores/chat/run-completion';

describe('run-completion', () => {
  it('treats Claude intermediate assistant final as non-terminal while sending', () => {
    const finalMsg = {
      id: 'a1',
      role: 'assistant',
      content: '让我先查一下…',
    } as RawMessage;

    const { isAgenticRunFragment, isTerminalOutput } = resolveAssistantFinalTerminalState(
      'claude',
      true,
      undefined,
      finalMsg,
    );

    expect(isAgenticRunFragment).toBe(true);
    expect(isTerminalOutput).toBe(false);
  });

  it('treats OpenClaw intermediate assistant final as non-terminal while sending', () => {
    const finalMsg = {
      id: 'a1',
      role: 'assistant',
      content: '让我通过 curl 查一下…',
    } as RawMessage;

    const { isAgenticRunFragment, isTerminalOutput } = resolveAssistantFinalTerminalState(
      'openclaw',
      true,
      undefined,
      finalMsg,
    );

    expect(isAgenticRunFragment).toBe(true);
    expect(isTerminalOutput).toBe(false);
  });

  it('treats agentic terminal final as terminal when agent.completed phase is present', () => {
    const finalMsg = {
      id: 'a2',
      role: 'assistant',
      content: '报告已生成完毕',
    } as RawMessage;

    const { isTerminalOutput } = resolveAssistantFinalTerminalState(
      'openclaw',
      true,
      'completed',
      finalMsg,
    );

    expect(isTerminalOutput).toBe(true);
  });

  it('does not auto-complete Claude from history until runtime is done', () => {
    expect(shouldAutoCompleteClaudeFromHistory(
      'claude',
      { isRunning: true, runtimeResult: null },
      true,
    )).toBe(false);

    expect(shouldAutoCompleteClaudeFromHistory(
      'claude',
      {
        isRunning: false,
        runtimeResult: { type: 'result', subtype: 'success' },
      },
      true,
    )).toBe(true);
  });

  it('does not auto-complete OpenClaw from history (Claude-only path)', () => {
    expect(shouldAutoCompleteClaudeFromHistory(
      'openclaw',
      { isRunning: false, runtimeResult: null },
      true,
    )).toBe(false);
  });

  it('recognizes Claude runtime result completion', () => {
    expect(isClaudeRuntimeResultDone({ type: 'result', subtype: 'success' })).toBe(true);
    expect(isClaudeRuntimeResultDone({ type: 'result', isError: true })).toBe(true);
    expect(isClaudeRuntimeResultDone(null)).toBe(false);
  });
});
