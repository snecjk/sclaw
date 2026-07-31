/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/index.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
export {
  DINGTALK_ARTIFACT_RULES_POINTER,
  DINGTALK_ARTIFACT_URL_EMBED_RULE,
  DINGTALK_DRIVE_UPLOAD_CMD,
  DINGTALK_LOCAL_ARTIFACT_IN_TEXT_BLOCK_REASON,
  DINGTALK_ORAL_SEND_GUARD,
  DINGTALK_SEND_FORMAT_RULES,
  DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK,
} from './dingtalk-send-rules';
export { SCHEDULED_TASK_CORE_PROMPT } from './scheduled-task/scheduled-task-core';
export {
  SCHEDULED_TASK_DINGTALK_RULES,
} from './scheduled-task/scheduled-task-dingtalk';
export {
  DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER,
  DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER_LEGACY,
  DINGTALK_AGENT_SEND_DISCLAIMER_HTML,
  DINGTALK_AGENT_SEND_DISCLAIMER_MARKDOWN,
  DINGTALK_AGENT_SEND_DISCLAIMER_MARKER,
  DINGTALK_AGENT_SEND_DISCLAIMER_PLAIN_TEXT,
  appendDingTalkAgentSendDisclaimer,
  ensureDingTalkAgentSendDisclaimerFormat,
  hasDingTalkDisclaimerDivider,
  stripDingTalkAgentSendDisclaimerBody,
  stripDingTalkAgentSendDisclaimerForDisplay,
} from './dingtalk-disclaimer';
export {
  DINGTALK_ORAL_SEND_PROMPT,
  looksLikeDingTalkOralSendIntent,
} from './dingtalk-oral-send-prompt';
export {
  appendDingTalkMentionContext,
  buildDingTalkMentionRpcExtras,
  buildDingTalkMentionSystemContext,
  buildDingTalkMentionSystemContextForScheduledTask,
  ensureChatSendMessageWithDingTalkMentions,
  looksLikeDingTalkMentionSendIntent,
  messageHasDingTalkRecipientContext,
  parseDingTalkRecipientsFromText,
  stripDingTalkMentionContextForDisplay,
} from './dingtalk-mention-context';
export type { DingTalkMentionContextOptions } from './dingtalk-mention-context';

import {
  DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK,
} from './dingtalk-send-rules';
import { SCHEDULED_TASK_CORE_PROMPT } from './scheduled-task/scheduled-task-core';
import {
  SCHEDULED_TASK_DINGTALK_RULES,
} from './scheduled-task/scheduled-task-dingtalk';
import { messageHasDingTalkRecipientContext } from './dingtalk-mention-context';

const DWS_SEND_RE = /dws\s+chat\s+message\s+send\b/i;

/** 指令/上下文是否暗示需要钉钉发送格式（含收件人块或内嵌 send 命令）。 */
export function promptNeedsDingTalkSendFormat(prompt: string | undefined | null): boolean {
  if (!prompt?.trim()) return false;
  return messageHasDingTalkRecipientContext(prompt) || DWS_SEND_RE.test(prompt);
}

/** 是否应注入模块 C 必发语义（以收件人块为准；不得因无块而禁止指令驱动发送）。 */
export function promptNeedsScheduledTaskDingTalkRules(prompt: string | undefined | null): boolean {
  if (!prompt?.trim()) return false;
  return messageHasDingTalkRecipientContext(prompt);
}

/**
 * 按条件拼接定时任务执行期系统提示。
 * - 始终：模块 B CORE
 * - 含 Recipients 块：+ 模块 C 必发 + 定时任务版模块 A（禁回执）
 * - 无块但含 `dws chat message send`：+ 定时任务版模块 A（不注 C）
 */
export function buildScheduledTaskExecutionSystemPrompt(options?: {
  prompt?: string | null;
}): string {
  const prompt = options?.prompt ?? '';
  const parts = [SCHEDULED_TASK_CORE_PROMPT];
  if (promptNeedsScheduledTaskDingTalkRules(prompt)) {
    parts.push(SCHEDULED_TASK_DINGTALK_RULES);
    parts.push(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
  } else if (promptNeedsDingTalkSendFormat(prompt)) {
    parts.push(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
  }
  return parts.join('\n\n');
}

/**
 * 执行器 `systemPromptAppend` 用：只含钉钉相关模块（不含 CORE，CORE 由引擎 hook 注入）。
 * - 含 Recipients 块：C + 定时任务版 A
 * - 无块但含 send 命令：仅定时任务版 A
 * - 否则 null
 */
export function buildScheduledTaskDingTalkPromptAppend(
  prompt: string | undefined | null,
): string | null {
  if (promptNeedsScheduledTaskDingTalkRules(prompt)) {
    return [SCHEDULED_TASK_DINGTALK_RULES, DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK].join(
      '\n\n',
    );
  }
  if (promptNeedsDingTalkSendFormat(prompt)) {
    return DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK;
  }
  return null;
}
