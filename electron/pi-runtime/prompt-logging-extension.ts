import type { InlineExtension } from '@earendil-works/pi-coding-agent';

export interface PiPromptLogOptions {
  sessionKey: string;
  getRunId(): string | undefined;
  log(stage: string, details: Record<string, unknown>, multilineBody?: string): void;
}

export function formatPiPromptLogBody(systemPrompt: string, userPrompt: string): string {
  return [
    '===== SYSTEM PROMPT =====',
    systemPrompt,
    '===== USER PROMPT =====',
    userPrompt,
    '===== END PROMPT =====',
  ].join('\n');
}

/** Logs the fully assembled system/user prompt once per user turn. */
export function createPiPromptLoggingExtension(
  options: PiPromptLogOptions,
): InlineExtension {
  return {
    name: 'sclaw-prompt-logger',
    hidden: true,
    factory(pi) {
      pi.on('before_agent_start', (event) => {
        options.log('turn.prompt.final', {
          sessionKey: options.sessionKey,
          runId: options.getRunId() ?? null,
          systemPromptChars: event.systemPrompt.length,
          userPromptChars: event.prompt.length,
        }, formatPiPromptLogBody(event.systemPrompt, event.prompt));
      });
    },
  };
}
