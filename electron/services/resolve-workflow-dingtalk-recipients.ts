/**
 * 工作流 startTracking 时解析钉钉收件人：显式 IPC 参数 → 定时任务列 → 对话 pending @。
 */
import { isScheduledTaskExecutionSessionKey } from '../../shared/scheduled-task-instruction';
import { resolveScheduledTaskDingTalkRecipients } from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
import {
  hasResolvedDingTalkMentions,
  normalizeDingTalkMentions,
  type DingTalkMention,
} from '../../shared/dingtalk-send/dingtalk-mention';
import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import { readDingTalkMentionPending } from '../utils/dingtalk-mention-pending';

export function parseScheduleTaskIdFromSessionKey(sessionKey: string): string | null {
  const key = sessionKey.trim();
  if (key.startsWith('claude-task:')) {
    return key.split(':')[1]?.trim() || null;
  }
  if (key.startsWith('agent:')) {
    const parts = key.split(':');
    if (parts.length >= 4 && parts[2] === 'cron') {
      return parts[3]?.trim() || null;
    }
  }
  return null;
}

export async function resolveWorkflowDingTalkRecipients(
  sessionKey: string,
  explicit?: DingTalkMention[] | null,
): Promise<DingTalkMention[] | null> {
  const normalized = normalizeDingTalkMentions(explicit);
  if (hasResolvedDingTalkMentions(normalized)) {
    return normalized;
  }

  if (isScheduledTaskExecutionSessionKey(sessionKey)) {
    const taskId = parseScheduleTaskIdFromSessionKey(sessionKey);
    if (taskId) {
      const task = await new ScheduleTaskRepository().getById(taskId);
      if (task) {
        const fromTask = resolveScheduledTaskDingTalkRecipients(task);
        if (fromTask?.length) return fromTask;
      }
    }
  }

  const pending = await readDingTalkMentionPending(sessionKey);
  if (pending && hasResolvedDingTalkMentions(pending.mentions)) {
    return pending.mentions;
  }

  return null;
}
