import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { dingTalkSendActivation } from './activation';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from './capability';
import { dingTalkSendPolicy } from './policy';
import { dingTalkSendPrompt } from './prompt';

export const stoDingTalkSendGuardDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-dingtalk-send-guard',
  version: '1.0.0',
  engines: ['claude', 'pi'],
  requiredCapabilities: [STO_DINGTALK_SEND_GUARD_CAPABILITY],
  activations: [dingTalkSendActivation],
  policies: [dingTalkSendPolicy],
  prompts: [dingTalkSendPrompt],
};
