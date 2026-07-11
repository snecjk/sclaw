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
import {
  DINGTALK_ORAL_SEND_PROMPT,
  looksLikeDingTalkOralSendIntent,
} from './shared/dingtalk-oral-send-prompt.js';
import {
  DINGTALK_SHARE_TOOL_PROMPT,
  looksLikeDingTalkShareIntent,
  registerShareToDingTalkTool,
} from './share-to-dingtalk.js';

const TAG = 'sto-dingtalk-send-guard';

/**
 * 追加到每条拦截 reason 末尾的反绕路口条。
 *
 * 背景：模型在 `dws chat message send` 被 send-guard 拦截后，偶发把 `deny + reason`
 * 误判成「Bash 这条路被堵、换条路绕过去」，转而用 Python / 其他语言脚本间接调 dws。
 * 但安全策略是在执行前校验命令文本，绕路调用既不会被放行、也增加排障难度。reason
 * 本身已写明正确重试格式，这里再显式堵住「换语言/换工具绕路」的思路，提示模型
 * 「按 reason 直接用 Bash 重试」。
 */
const NO_BYPASS_HINT =
  '若被本策略拦截，请按 reason 中给出的格式直接用 Bash 重试 `dws chat message send`；禁止改用 Python / 其他语言脚本 / `subprocess` / 其他工具间接调用 dws 绕过（安全策略在执行前校验命令文本，绕路不会被放行）。';

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

    api.on('before_prompt_build', async (event, ctx) => {
      api.logger.debug?.(
        `[${TAG}] before_prompt_build: fired — agentId=${ctx.agentId ?? '(none)'}, sessionKey=${ctx.sessionKey ?? '(none)'}`,
      );

      const appendBlocks: string[] = [];
      let hasPendingMentions = false;

      if (ctx.sessionKey) {
        const pendingMentions = await readDingTalkMentionPending(ctx.sessionKey);
        if (pendingMentions) {
          hasPendingMentions = true;
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

      // 优先级：@ Recipients > 口头点名发送（dws）> 分享选人窗（share）
      const prompt = typeof event?.prompt === 'string' ? event.prompt : '';
      if (!hasPendingMentions) {
        if (looksLikeDingTalkOralSendIntent(prompt)) {
          appendBlocks.push(DINGTALK_ORAL_SEND_PROMPT);
        } else if (looksLikeDingTalkShareIntent(prompt)) {
          appendBlocks.push(DINGTALK_SHARE_TOOL_PROMPT);
        }
      }

      if (appendBlocks.length === 0) return undefined;
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
            blockReason: `${decision.reason} ${NO_BYPASS_HINT}`,
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
