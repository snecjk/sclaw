/**
 * 钉钉发送执行层（非提示词）。
 *
 * 提示词 SSOT 见 `shared/dingtalk-prompts/`。
 * 本目录：收件人模型、dws 命令拼装、分享/文件发送、展示解析、列 lift。
 */
export type { DingTalkMention } from './dingtalk-mention';
export {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
  normalizeDingTalkMentions,
} from './dingtalk-mention';
export {
  resolveScheduledTaskDingTalkRecipients,
  planDingTalkRecipientsLift,
  planComposerSegmentsRecipientsMigration,
  extractDingTalkMentionsFromComposerSegments,
} from './scheduled-task-dingtalk-lift';
export type {
  ComposerSegmentsRecipientsMigrationPlan,
  DingTalkRecipientsLiftPlan,
  ScheduledTaskDingTalkSource,
} from './scheduled-task-dingtalk-lift';
