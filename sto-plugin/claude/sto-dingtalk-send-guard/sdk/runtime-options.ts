import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { buildDingTalkMentionSystemContext } from '../../../../shared/dingtalk-mention-context';
import { fixDwsChatMessageSendToolParams } from '../../../../shared/dws-send-text';
import {
  evaluateDingTalkSendGuard,
  handleDingTalkSendGuardAfter,
} from './dingtalk-send-guard';
import {
  clearDingTalkMentionPending,
  readDingTalkMentionPending,
} from '../../../../electron/utils/dingtalk-mention-pending';
import { logger } from '../../../../electron/utils/logger';

export interface ClaudeRuntimeOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  systemPromptAppend?: string;
}

interface ClaudeRuntimeExtension {
  id: string;
  buildHooks?(sessionKey: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
  buildSystemPromptAppend?(sessionKey: string): Promise<string | undefined>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function readCommand(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  for (const key of ['command', 'cmd', 'script', 'bash_command', 'input']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function resolveDingTalkSendFormatProblem(command: string): string | null {
  if (!/dws\s+chat\s+message\s+send\b/i.test(command) || !/--text\s+/i.test(command)) {
    return null;
  }
  if (/<\/?font\b/i.test(command)) {
    return '钉钉发送正文禁止使用 <font> HTML。请改用 Markdown 底栏：--- 后接 `> *本消息由 STO Claw 代为发送，非本人实时回复。*`。';
  }
  if (/--text\s+\$[A-Za-z_][A-Za-z0-9_]*/i.test(command) || /--text\s+(?:--format\b|$)/i.test(command)) {
    return '钉钉发送正文不能使用 shell 变量或空 `--text`，否则可能把 `--format` 当正文发送。请直接使用 `--text "正文\\n\\n---\\n\\n> *本消息由 STO Claw 代为发送，非本人实时回复。*"`。';
  }
  return null;
}

function mergeHooks(
  target: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  source: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
): void {
  if (!source) return;

  for (const [eventName, matchers] of Object.entries(source) as Array<[HookEvent, HookCallbackMatcher[] | undefined]>) {
    if (!matchers?.length) continue;
    target[eventName] = [...(target[eventName] ?? []), ...matchers];
  }
}

const dingTalkSendGuardExtension: ClaudeRuntimeExtension = {
  id: 'sto-dingtalk-send-guard',

  async buildSystemPromptAppend(sessionKey: string): Promise<string | undefined> {
    const pendingMentions = await readDingTalkMentionPending(sessionKey);
    if (!pendingMentions) {
      logger.debug('[dingtalk-mention] claude-runtime: no pending mentions', { sessionKey });
      return undefined;
    }

    logger.info('[dingtalk-mention] claude-runtime: pending mentions found', {
      sessionKey,
      mentionCount: pendingMentions.mentions.length,
      sendFileIntent: Boolean(pendingMentions.sendFileIntent),
      attachedFileCount: pendingMentions.attachedFiles?.length ?? 0,
    });

    await clearDingTalkMentionPending(sessionKey);
    return buildDingTalkMentionSystemContext(pendingMentions.mentions, {
      sendFileIntent: pendingMentions.sendFileIntent,
      attachedFiles: pendingMentions.attachedFiles,
    });
  },

  buildHooks(sessionKey: string) {
    return {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            async (input) => {
              if (input.hook_event_name !== 'PreToolUse') return {};
              const params = asRecord(input.tool_input);
              const formatProblem = resolveDingTalkSendFormatProblem(readCommand(params));
              if (formatProblem) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: formatProblem,
                  },
                };
              }

              const decision = evaluateDingTalkSendGuard({
                toolName: input.tool_name,
                params,
                sessionKey,
              });

              if (!decision.allowed) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: decision.reason,
                  },
                };
              }

              const fixedParams = fixDwsChatMessageSendToolParams(params);
              if (fixedParams) {
                logger.debug('[dingtalk-mention] claude-runtime: normalized dws send --text');
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    updatedInput: fixedParams,
                  },
                };
              }

              return {};
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            async (input) => {
              if (input.hook_event_name !== 'PostToolUse') return {};

              handleDingTalkSendGuardAfter({
                toolName: input.tool_name,
                params: asRecord(input.tool_input),
                sessionKey,
                toolCallId: input.tool_use_id,
                result: input.tool_response,
              });

              return {};
            },
          ],
        },
      ],
    };
  },
};

const claudeRuntimeExtensions: ClaudeRuntimeExtension[] = [
  dingTalkSendGuardExtension,
];

export async function buildStoDingTalkSendGuardClaudeRuntimeOptions(
  sessionKey: string,
): Promise<ClaudeRuntimeOptions> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  const promptBlocks: string[] = [];

  for (const extension of claudeRuntimeExtensions) {
    mergeHooks(hooks, extension.buildHooks?.(sessionKey));

    const promptBlock = await extension.buildSystemPromptAppend?.(sessionKey);
    if (promptBlock?.trim()) {
      promptBlocks.push(promptBlock.trim());
    }
  }

  return {
    hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
    systemPromptAppend: promptBlocks.length > 0 ? promptBlocks.join('\n\n') : undefined,
  };
}
