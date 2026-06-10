export {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  buildDingTalkMentionSystemContext,
  DINGTALK_RECIPIENTS_MARKER,
  ensureChatSendMessageWithDingTalkMentions,
  hasResolvedDingTalkMentions,
  messageHasDingTalkRecipientContext,
  shouldIncludeDingTalkFileSendWorkflow,
  stripDingTalkMentionContextForDisplay,
  stripDingTalkAgentSendDisclaimerForDisplay,
} from '../../shared/dingtalk-mention-context';
export type { DingTalkAttachedFileHint, DingTalkMentionContextOptions } from '../../shared/dingtalk-mention-context';
