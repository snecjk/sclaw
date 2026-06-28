import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import {
  evaluateDingTalkSendGuard,
  handleDingTalkSendGuardAfter,
  rememberPendingDingTalkSend,
} from './dingtalk-send-guard.js';
import {
  clearDingTalkMentionPending,
  readDingTalkMentionPending,
} from './dingtalk-mention-pending.js';
import { buildDingTalkMentionSystemContext } from './shared/dingtalk-mention-context';
import { fixDwsChatMessageSendToolParamsForOpenClawExec } from './shared/dws-send-text';
import { DINGTALK_SHARE_TOOL_PROMPT, registerShareToDingTalkTool } from './share-to-dingtalk.js';

const TAG = 'sto-dingtalk-send-guard';

function pickToolResult(event: Record<string, unknown>): unknown {
  for (const key of ['result', 'output', 'response', 'stdout', 'aggregated', 'text', 'body', 'data']) {
    if (key in event && event[key] != null) return event[key];
  }
  return undefined;
}

export default definePluginEntry({
  id: 'sto-dingtalk-send-guard',
  name: '钉钉发送防护',
  description:
    '钉钉 @ 收件人 prompt 注入、dws chat message send 频率限制（成功后才计数），并拦截 shell 循环批量发送。',
  register(api: OpenClawPluginApi) {
    api.logger.info?.(`[${TAG}] plugin registering`);

    registerShareToDingTalkTool(api);

    api.on('before_prompt_build', async (_event, ctx) => {
      api.logger.debug?.(
        `[${TAG}] before_prompt_build: fired — agentId=${ctx.agentId ?? '(none)'}, sessionKey=${ctx.sessionKey ?? '(none)'}`,
      );

      const appendBlocks: string[] = [DINGTALK_SHARE_TOOL_PROMPT];

      if (ctx.sessionKey) {
        const pendingMentions = await readDingTalkMentionPending(ctx.sessionKey);
        if (pendingMentions) {
          api.logger.info?.(
            `[${TAG}] before_prompt_build: pending DingTalk mentions found (${pendingMentions.mentions.length} recipients) sessionKey=${ctx.sessionKey}`,
          );

          const block = buildDingTalkMentionSystemContext(pendingMentions.mentions, {
            sendFileIntent: pendingMentions.sendFileIntent,
            attachedFiles: pendingMentions.attachedFiles,
          });
          await clearDingTalkMentionPending(ctx.sessionKey);
          api.logger.debug?.(
            `[${TAG}] before_prompt_build: injected DingTalk mention context (${pendingMentions.mentions.length} recipients)`,
          );
          appendBlocks.push(block);
        } else {
          api.logger.debug?.(
            `[${TAG}] before_prompt_build: no pending DingTalk mentions for sessionKey=${ctx.sessionKey}`,
          );
        }
      }

      return { appendSystemContext: appendBlocks.join('\n\n') };
    });

    api.on(
      'before_tool_call',
      (event, ctx) => {
        const decision = evaluateDingTalkSendGuard({
          toolName: event.toolName,
          params: event.params,
          sessionKey: ctx.sessionKey ?? ctx.sessionId,
        });
        if (!decision.allowed) {
          api.logger.warn?.(`[${TAG}] blocked tool=${event.toolName}: ${decision.reason}`);
          return {
            block: true,
            blockReason: decision.reason,
          };
        }
        if (decision.category) {
          rememberPendingDingTalkSend(
            event.toolCallId ?? ctx.toolCallId,
            ctx.sessionKey ?? ctx.sessionId,
            decision.category,
          );
        }

        const fixedParams = fixDwsChatMessageSendToolParamsForOpenClawExec(event.params);
        if (fixedParams) {
          const commandKey = ['command', 'cmd', 'script', 'input', 'bash_command'].find(
            (key) => typeof fixedParams[key] === 'string',
          );
          const rewritten = commandKey ? String(fixedParams[commandKey]) : '';
          const win32Direct = process.platform === 'win32' && rewritten.includes('execFileSync');
          api.logger.info?.(
            `[${TAG}] normalized dws chat message send --text tool=${event.toolName}${win32Direct ? ' (win32 node execFileSync)' : ''}`,
          );
          return { params: fixedParams };
        }
      },
      { priority: 100 },
    );

    api.on(
      'after_tool_call',
      (event, ctx) => {
        const rawEvent =
          event && typeof event === 'object' ? (event as Record<string, unknown>) : {};
        handleDingTalkSendGuardAfter({
          toolName: event.toolName,
          params: event.params,
          sessionKey: ctx.sessionKey ?? ctx.sessionId,
          toolCallId: event.toolCallId ?? ctx.toolCallId,
          error: event.error,
          result: pickToolResult(rawEvent),
        });
      },
      { priority: 100 },
    );

    api.logger.info?.(`[${TAG}] plugin registered (share_to_dingtalk + send guard)`);
  },
});
