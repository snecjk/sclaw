import { describe, expect, it } from 'vitest';
import {
  buildClaudeResumeContinueUserPrompt,
  buildClaudeResumeInterruptAppend,
  inspectClaudeAssistantPayload,
  isClaudeRuntimeControlText,
  isClaudeTurnContentless,
  isContinueUserPrompt,
  shouldAutoResumeContentlessTurn,
} from '../../shared/claude-runtime-control-text';

describe('isContinueUserPrompt', () => {
  it('matches short continue phrases', () => {
    expect(isContinueUserPrompt('继续')).toBe(true);
    expect(isContinueUserPrompt('请继续')).toBe(true);
    expect(isContinueUserPrompt('continue')).toBe(true);
    expect(isContinueUserPrompt('分析这个站点')).toBe(false);
    expect(isContinueUserPrompt('Continue from where you left off.')).toBe(true);
    expect(isContinueUserPrompt('Continue from where you left off')).toBe(true);
    expect(isContinueUserPrompt('[Your previous response had no visible output. Please continue and produce a user-visible response.]')).toBe(true);
  });
});

describe('buildClaudeResumeInterruptAppend', () => {
  it('stays silent on a fresh query', () => {
    expect(buildClaudeResumeInterruptAppend({
      isResume: false,
      isContinue: true,
      lastError: 'stream closed',
    })).toBeUndefined();
  });

  it('explains transcript tool_result on resume after interrupt', () => {
    const append = buildClaudeResumeInterruptAppend({
      isResume: true,
      isContinue: true,
      lastError: 'stream closed',
      cause: 'stream_closed',
    });
    expect(append).toContain('tool_result');
    expect(append).toContain('流被关闭');
    expect(append).toContain('不是权限错误');
  });

  it('user_abort tells the model not to continue on its own', () => {
    const append = buildClaudeResumeInterruptAppend({
      isResume: true,
      isContinue: true,
      cause: 'user_abort',
    });
    expect(append).toContain('不要自行接着干');
  });
});

describe('buildClaudeResumeContinueUserPrompt', () => {
  it('replaces the SDK empty continue turn with a cause-bearing user prompt', () => {
    const prompt = buildClaudeResumeContinueUserPrompt('stream_closed');
    expect(prompt.trim().length).toBeGreaterThan(0);
    expect(prompt).not.toMatch(/continue from where you left off/i);
    expect(prompt).toContain('流被关闭');
  });

  it('user_abort tells the model not to continue on its own', () => {
    expect(buildClaudeResumeContinueUserPrompt('user_abort')).toContain('不要自行接着干');
  });
});

describe('contentless turn + auto-resume mutex', () => {
  it('treats SDK no-visible-output as control text', () => {
    expect(isClaudeRuntimeControlText('[Your previous response had no visible output. Please continue and produce a user-visible response.]')).toBe(true);
    expect(isClaudeRuntimeControlText('No response requested.')).toBe(true);
  });

  it('thinking-only / control-line is contentless; result Done. without assistant is not', () => {
    expect(inspectClaudeAssistantPayload({ content: [{ type: 'thinking', thinking: '...' }] })).toEqual({
      hasToolUse: false,
      hasVisibleText: false,
    });
    expect(inspectClaudeAssistantPayload({ content: [{ type: 'text', text: 'No response requested.' }] })).toEqual({
      hasToolUse: false,
      hasVisibleText: false,
    });
    expect(inspectClaudeAssistantPayload({ content: [{ type: 'tool_use', name: 'bridge_fill' }] }).hasToolUse).toBe(true);
    expect(isClaudeTurnContentless({
      hadAssistant: true,
      hadToolUse: false,
      hadVisibleAssistantText: false,
      resultText: 'No response requested.',
    })).toBe(true);
    expect(isClaudeTurnContentless({
      hadAssistant: false,
      hadToolUse: false,
      hadVisibleAssistantText: false,
      resultText: 'Done.',
    })).toBe(false);
  });

  it('does not auto-resume empty turns (empty prompt injects SDK Continue)', () => {
    const base = {
      turnWasContentless: true,
      autoResumeCount: 0,
      interruptCause: null as const,
      ownerRunId: 'run-a',
      currentRunId: 'run-a',
    };
    expect(shouldAutoResumeContentlessTurn(base)).toBe(false);
    expect(shouldAutoResumeContentlessTurn({ ...base, autoResumeCount: 1 })).toBe(false);
    expect(shouldAutoResumeContentlessTurn({ ...base, interruptCause: 'user_abort' })).toBe(false);
    expect(shouldAutoResumeContentlessTurn({ ...base, interruptCause: 'loop_guard_blocked' })).toBe(false);
    expect(shouldAutoResumeContentlessTurn({ ...base, ownerRunId: 'run-b' })).toBe(false);
  });
});
