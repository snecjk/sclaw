import {
  createKeywordActivationMatcher,
  type SclawActivationDefinition,
} from '../../../../shared/agent-extensions';
import { looksLikeDingTalkMentionSendIntent } from '../../../../shared/dingtalk-prompts/dingtalk-mention-context';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from './capability';

export const STO_DINGTALK_SEND_ACTIVATION = 'dingtalk-send';

const matchesDingTalkSendKeywords = createKeywordActivationMatcher({
  keywords: [
    '钉钉',
    'dingtalk',
    'dws chat message send',
  ],
  patterns: [
    /(?:发|发送|转发|通知|同步|分享).{0,8}(?:给|到).{0,16}(?:同事|联系人|群|群聊|群里|群组|团队|部门)/u,
    /(?:给|通知).{1,12}(?:发|发送|转发).{0,8}(?:消息|文件|图片|结果|报告|通知)/u,
  ],
  reason: 'dingtalk-send-keyword',
});

/**
 * Activates the prompt for explicit DingTalk intent or UI-created mention
 * context. The pending-context check is deliberately non-consuming; prompt
 * construction owns the one-shot consume operation.
 */
export const dingTalkSendActivation: SclawActivationDefinition = {
  id: STO_DINGTALK_SEND_ACTIVATION,
  scope: 'session',
  async match(context) {
    const keywordResult = await matchesDingTalkSendKeywords(context);
    const normalized = typeof keywordResult === 'boolean'
      ? { active: keywordResult }
      : keywordResult;
    if (normalized.active) return normalized;

    if (looksLikeDingTalkMentionSendIntent(context.userPrompt)) {
      return { active: true, reason: 'oral-send-intent' };
    }

    const hasPendingContext = await context.capabilities
      .require(STO_DINGTALK_SEND_GUARD_CAPABILITY)
      .hasPendingContext(context.sessionKey);
    return {
      active: hasPendingContext,
      reason: hasPendingContext ? 'dingtalk-pending-context' : undefined,
    };
  },
};
