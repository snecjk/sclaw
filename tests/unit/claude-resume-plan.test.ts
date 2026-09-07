// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveClaudeResumePlan } from '../../shared/claude-resume-plan';

describe('resolveClaudeResumePlan', () => {
  it('opens a new query when there is no SDK session', () => {
    expect(resolveClaudeResumePlan({
      registryEntry: null,
      interruptCause: 'user_abort',
      userPrompt: '继续',
    })).toEqual({ mode: 'new' });
  });

  it('resumes the existing session and marks 继续 as a continue prompt', () => {
    expect(resolveClaudeResumePlan({
      registryEntry: { sessionId: 'sdk-1' },
      interruptCause: 'stream_closed',
      userPrompt: '继续',
    })).toEqual({
      mode: 'resume',
      resumeSessionId: 'sdk-1',
      interruptCause: 'stream_closed',
      isContinuePrompt: true,
    });
  });

  it('treats an empty resume prompt as continue so the model does not get an empty user turn', () => {
    const plan = resolveClaudeResumePlan({
      registryEntry: { sessionId: 'sdk-1' },
      interruptCause: 'process_restart',
      userPrompt: '  ',
    });
    expect(plan).toMatchObject({ mode: 'resume', isContinuePrompt: true, interruptCause: 'process_restart' });
  });

  it('keeps a real user question as a non-continue resume', () => {
    const plan = resolveClaudeResumePlan({
      registryEntry: { sessionId: 'sdk-1' },
      interruptCause: 'user_abort',
      userPrompt: '改成红色',
    });
    expect(plan).toMatchObject({ mode: 'resume', isContinuePrompt: false });
  });

  it('switches to recovery when the conversation is missing', () => {
    expect(resolveClaudeResumePlan({
      registryEntry: { sessionId: 'sdk-old' },
      missingConversation: true,
    })).toEqual({ mode: 'recovery', archivedSessionId: 'sdk-old' });
  });
});
