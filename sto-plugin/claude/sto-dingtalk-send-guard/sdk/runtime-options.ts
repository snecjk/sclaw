import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { appendDingTalkAgentSendDisclaimer } from '../../../../shared/dingtalk-disclaimer';
import { buildDingTalkMentionSystemContext } from '../../../../shared/dingtalk-mention-context';
import {
  DINGTALK_ORAL_SEND_PROMPT,
  looksLikeDingTalkOralSendIntent,
} from '../../../../shared/dingtalk-oral-send-prompt';
import {
  buildDwsChatMessageSendAgentCommandExample,
  fixDwsChatMessageSendToolParams,
  parseDwsChatMessageSendShellCommandArgs,
} from '../../../../shared/dws-send-text';
import {
  evaluateDingTalkSendGuard,
  handleDingTalkSendGuardAfter,
  isDwsChatMessageSendDryRun,
  isSuccessfulDwsChatMessageSendResult,
} from './dingtalk-send-guard';
import {
  checkDwsSendDedup,
  dwsSendRecipientKey,
  recordDwsSent,
} from '../../../../electron/utils/dws-send-dedup';
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
  buildSystemPromptAppend?(
    sessionKey: string,
    userPrompt?: string,
  ): Promise<string | undefined>;
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

/**
 * 从 `dws chat message send` 命令解析 (收件人 key, 归一化正文)。
 * 正文经 parseDwsChatMessageSendShellCommandArgs 的归一化（含代发说明底栏），
 * 与兜底发送路径构造的正文一致，保证两条路径的去重指纹可比。
 * 非 dws send 命令或缺失收件人/正文时返回 null。
 */
function parseDwsSendRecipientAndText(
  command: string,
): { recipientKey: string; text: string } | null {
  const argv = parseDwsChatMessageSendShellCommandArgs(command);
  if (!argv || argv.length < 4) return null;
  let recipientKey: string | null = null;
  let text = '';
  for (let i = 0; i < argv.length - 1; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--user') recipientKey = dwsSendRecipientKey('user', next);
    else if (flag === '--group') recipientKey = dwsSendRecipientKey('group', next);
    else if (flag === '--text') text = next;
  }
  if (!recipientKey || !text) return null;
  return { recipientKey, text };
}

function buildDingTalkSendFormatExample(): string {
  return buildDwsChatMessageSendAgentCommandExample({
    recipientKind: 'user',
    recipientId: '<userId>',
    text: appendDingTalkAgentSendDisclaimer('{正文}'),
  });
}

function resolveDingTalkSendFormatProblem(command: string): string | null {
  if (!/dws\s+chat\s+message\s+send\b/i.test(command) || !/--text\s+/i.test(command)) {
    return null;
  }
  if (/<\/?font\b/i.test(command)) {
    return `钉钉发送正文禁止使用 <font> HTML。请改用 Markdown 底栏，示例：\n${buildDingTalkSendFormatExample()}`;
  }
  if (/--text\s+\$[A-Za-z_][A-Za-z0-9_]*/i.test(command) || /--text\s+(?:--format\b|$)/i.test(command)) {
    return `钉钉发送正文不能使用 shell 变量或空 \`--text\`。请直接使用示例格式：\n${buildDingTalkSendFormatExample()}`;
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

  async buildSystemPromptAppend(
    sessionKey: string,
    userPrompt?: string,
  ): Promise<string | undefined> {
    const pendingMentions = await readDingTalkMentionPending(sessionKey);
    if (pendingMentions) {
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
    }

    logger.debug('[dingtalk-mention] claude-runtime: no pending mentions', { sessionKey });

    // 无 @ 时：口头点名发送 → 注入 dws 规则（Claude 路径无 share_to_dingtalk）
    if (looksLikeDingTalkOralSendIntent(userPrompt)) {
      logger.info('[dingtalk-mention] claude-runtime: oral send intent, inject dws rules', {
        sessionKey,
      });
      return DINGTALK_ORAL_SEND_PROMPT;
    }

    return undefined;
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
              const effectiveParams = fixedParams ?? params;
              const commandText = readCommand(effectiveParams);

              if (commandText && !isDwsChatMessageSendDryRun(commandText)) {
                const fp = parseDwsSendRecipientAndText(commandText);
                if (fp) {
                  const dedup = checkDwsSendDedup(fp.recipientKey, fp.text);
                  if (dedup.recent) {
                    logger.info(
                      '[dingtalk-mention] claude-runtime: blocked duplicate dws send (same recipient+text within TTL)',
                      { sessionKey },
                    );
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse',
                        permissionDecision: 'deny',
                        permissionDecisionReason: dedup.reason,
                      },
                    };
                  }
                }
              }

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

              const params = asRecord(input.tool_input);
              const commandText = readCommand(params);

              handleDingTalkSendGuardAfter({
                toolName: input.tool_name,
                params,
                sessionKey,
                toolCallId: input.tool_use_id,
                result: input.tool_response,
              });

              if (
                commandText
                && !isDwsChatMessageSendDryRun(commandText)
                && isSuccessfulDwsChatMessageSendResult(undefined, input.tool_response)
              ) {
                const fp = parseDwsSendRecipientAndText(commandText);
                if (fp) {
                  recordDwsSent(fp.recipientKey, fp.text);
                }
              }

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
  userPrompt?: string,
): Promise<ClaudeRuntimeOptions> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  const promptBlocks: string[] = [];

  for (const extension of claudeRuntimeExtensions) {
    mergeHooks(hooks, extension.buildHooks?.(sessionKey));

    const promptBlock = await extension.buildSystemPromptAppend?.(sessionKey, userPrompt);
    if (promptBlock?.trim()) {
      promptBlocks.push(promptBlock.trim());
    }
  }

  return {
    hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
    systemPromptAppend: promptBlocks.length > 0 ? promptBlocks.join('\n\n') : undefined,
  };
}
