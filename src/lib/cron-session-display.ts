/**
 * Strip cron / scheduled-task trigger metadata from user messages for chat display.
 * Cron session history may prefix messages with task name and prompt lines.
 */
const CRON_TRIGGER_TASK_LINE = /^(?:Scheduled task|定时任务)\s*[:：]\s*[^\n]*\n?/gim;
const CRON_TRIGGER_PROMPT_LINE = /^Prompt\s*[:：]\s*[^\n]*\n?/gim;

export function stripCronTriggerTextForDisplay(text: string): string {
  if (!text) return text;
  let result = text.trim();
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result
      .replace(CRON_TRIGGER_TASK_LINE, '')
      .replace(CRON_TRIGGER_PROMPT_LINE, '')
      .trim();
  }
  return result;
}
