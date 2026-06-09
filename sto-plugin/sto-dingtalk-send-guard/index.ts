import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import { evaluateDingTalkSendGuard } from './dingtalk-send-guard.js';

const TAG = 'sto-dingtalk-send-guard';

export default definePluginEntry({
  id: 'sto-dingtalk-send-guard',
  name: '钉钉发送防护',
  description: '限制 dws chat message send 频率，并拦截 shell 循环批量发送。',
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
      },
      { priority: 100 },
    );

    api.logger.info?.(`[${TAG}] plugin registered`);
  },
});
