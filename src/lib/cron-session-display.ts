/**
 * Strip cron / scheduled-task trigger metadata from user messages for chat display.
 * Cron session history may prefix messages with task name and prompt lines.
 */
const CRON_TRIGGER_TASK_LINE = /^(?:Scheduled task|定时任务)\s*[:：]\s*[^\n]*\n?/gim;
const CRON_TRIGGER_PROMPT_LINE = /^Prompt\s*[:：]\s*[^\n]*\n?/gim;
/** OpenClaw isolated cron runs prefix user prompts with `[cron:<jobId> <job name>]`. */
const CRON_TRIGGER_MESSAGE_PREFIX = /^\[cron:[^\]]+\]\s*/i;

/** Strip Gateway technical `Cron: ` prefix from session labels (chat header, etc.). */
export function stripCronLabelPrefix(label: string): string {
  return label.replace(/^Cron:\s*/i, '').trim();
}

export function stripCronTriggerTextForDisplay(text: string): string {
  if (!text) return text;
  let result = text.trim();
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result
      .replace(CRON_TRIGGER_MESSAGE_PREFIX, '')
      .replace(CRON_TRIGGER_TASK_LINE, '')
      .replace(CRON_TRIGGER_PROMPT_LINE, '')
      .trim();
  }
  if (/^Cron:\s*/i.test(result)) {
    result = stripCronLabelPrefix(result);
  }
  return result;
}
