export {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  buildDingTalkMentionSystemContext,
  ensureChatSendMessageWithDingTalkMentions,
  messageHasDingTalkRecipientContext,
  stripDingTalkMentionContextForDisplay,
} from '../../shared/dingtalk-prompts/dingtalk-mention-context';
export type { DingTalkMentionContextOptions } from '../../shared/dingtalk-prompts/dingtalk-mention-context';

export { stripDingTalkAgentSendDisclaimerForDisplay } from '../../shared/dingtalk-prompts/dingtalk-disclaimer';

export {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
} from '../../shared/dingtalk-send/dingtalk-mention';

export {
  shouldIncludeDingTalkFileSendWorkflow,
} from '../../shared/dingtalk-send/dingtalk-file-send';
export type { DingTalkAttachedFileHint } from '../../shared/dingtalk-send/dingtalk-file-send';
