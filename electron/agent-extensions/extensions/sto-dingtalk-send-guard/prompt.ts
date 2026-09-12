import {
  buildDingTalkMentionSystemContext,
  looksLikeDingTalkDriveUploadIntent,
  looksLikeDingTalkMentionSendIntent,
} from '../../../../shared/dingtalk-prompts/dingtalk-mention-context';
import { DINGTALK_ORAL_SEND_CONTEXT } from '../../../../shared/dingtalk-prompts/dingtalk-oral-send-prompt';
import type { SclawPromptContribution } from '../../../../shared/agent-extensions';
import { STO_DINGTALK_SEND_ACTIVATION } from './activation';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from './capability';

export const dingTalkSendPrompt: SclawPromptContribution = {
  id: 'dingtalk-send-guidance',
  modes: ['interactive'],
  activation: STO_DINGTALK_SEND_ACTIVATION,
  async build(context) {
    const pending = await context.capabilities
      .require(STO_DINGTALK_SEND_GUARD_CAPABILITY)
      .consumePendingContext(context.sessionKey);
    if (pending) {
      const intentText = [context.userPrompt, pending.userText].filter(Boolean).join('\n');
      const forceDingTalkDriveUpload = looksLikeDingTalkDriveUploadIntent(intentText);
      const explicitSendIntent = pending.sendFileIntent === true
        || forceDingTalkDriveUpload
        || looksLikeDingTalkMentionSendIntent(intentText);
      context.logger.info('[agent-extension] dingtalk.pending.consumed', {
        engine: context.engine,
        extensionId: 'sto-dingtalk-send-guard',
        mentionCount: pending.mentions.length,
        attachedFileCount: pending.attachedFiles?.length ?? 0,
        sendFileIntent: Boolean(pending.sendFileIntent),
        explicitSendIntent,
        forceDingTalkDriveUpload,
      });
      return buildDingTalkMentionSystemContext(pending.mentions, {
        sendFileIntent: pending.sendFileIntent,
        attachedFiles: pending.attachedFiles,
        explicitSendIntent,
        forceDingTalkDriveUpload,
      });
    }
    return DINGTALK_ORAL_SEND_CONTEXT;
  },
};
