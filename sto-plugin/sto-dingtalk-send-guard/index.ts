import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import {
  evaluateDingTalkSendGuard,
  handleDingTalkSendGuardAfter,
  rememberPendingDingTalkSend,
} from './dingtalk-send-guard.js';

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
  description: '限制 dws chat message send 频率（成功后才计数），并拦截 shell 循环批量发送。',
  register(api: OpenClawPluginApi) {
    api.logger.info?.(`[${TAG}] plugin registering`);

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

    api.logger.info?.(`[${TAG}] plugin registered`);
  },
});
