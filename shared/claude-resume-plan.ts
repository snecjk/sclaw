import { isContinueUserPrompt } from './claude-runtime-control-text';
import type { ChatRunInterruptCause } from './chat-run-interrupt';

export type ClaudeResumePlan =
  | { mode: 'new' }
  | {
      mode: 'resume';
      resumeSessionId: string;
      interruptCause: ChatRunInterruptCause | null;
      isContinuePrompt: boolean;
    }
  | { mode: 'recovery'; archivedSessionId: string };

/**
 * 「新建 / resume / 会话丢失后的 recovery」收敛成纯函数。
 * startClaudeQuery 只执行 plan，不再在三处各自写三元表达式。
 */
export function resolveClaudeResumePlan(input: {
  registryEntry: { sessionId?: string } | null;
  missingConversation?: boolean;
  interruptCause?: ChatRunInterruptCause | null;
  userPrompt?: string;
}): ClaudeResumePlan {
  const sessionId = input.registryEntry?.sessionId?.trim();
  if (input.missingConversation && sessionId) {
    return { mode: 'recovery', archivedSessionId: sessionId };
  }
  if (sessionId) {
    const prompt = input.userPrompt;
    const isContinuePrompt = !prompt?.trim() || isContinueUserPrompt(prompt);
    return {
      mode: 'resume',
      resumeSessionId: sessionId,
      interruptCause: input.interruptCause ?? null,
      isContinuePrompt,
    };
  }
  return { mode: 'new' };
}
