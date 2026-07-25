/**
 * 工作流终态钉钉程序发送（Main 进程）。
 *
 * 见 `shared/dingtalk-send/workflow-dingtalk-delivery.ts` 正文格式化；
 * 由 `WorkflowExecutionTracker` 在 completed / failed / timeout 时 fire-and-forget 调用。
 */
import type { WorkflowExecutionState } from '../../shared/workflow-run-status';
import {
  buildWorkflowDingTalkDwsArgs,
  dedupeDingTalkRecipients,
  formatWorkflowDingTalkBody,
} from '../../shared/dingtalk-send/workflow-dingtalk-delivery';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
import { runDws } from '../utils/dws-cli';
import { logger } from '../utils/logger';

export interface DeliverWorkflowDingTalkInput {
  runId: string;
  sessionKey: string;
  state: WorkflowExecutionState;
  recipients: DingTalkMention[];
  workflowTitle?: string | null;
}

export async function deliverWorkflowDingTalkIfNeeded(
  input: DeliverWorkflowDingTalkInput,
): Promise<void> {
  const { runId, sessionKey, state, recipients, workflowTitle } = input;
  const terminalStatuses = new Set(['completed', 'failed', 'timeout']);
  if (!terminalStatuses.has(state.status)) return;

  const body = formatWorkflowDingTalkBody({ state, workflowTitle });
  if (!body) {
    logger.info('[workflow-dingtalk] skip: empty body', { runId, status: state.status });
    return;
  }

  const title = workflowTitle?.trim() || '工作流通知';
  const uniqueRecipients = dedupeDingTalkRecipients(recipients);
  if (uniqueRecipients.length === 0) return;

  let sent = 0;
  for (const recipient of uniqueRecipients) {
    const args = buildWorkflowDingTalkDwsArgs(recipient, { title, body });
    if (!args) {
      logger.warn('[workflow-dingtalk] skip recipient: missing id', {
        runId,
        type: recipient.type,
        displayName: recipient.displayName,
      });
      continue;
    }

    try {
      const result = await runDws(args, 60_000);
      if (!result.ok) {
        logger.warn('[workflow-dingtalk] dws send failed', {
          runId,
          sessionKey,
          recipient: recipient.displayName,
          exitCode: result.exitCode,
          error: result.error ?? '(none)',
        });
        continue;
      }
      sent += 1;
      logger.info('[workflow-dingtalk] dws send ok', {
        runId,
        recipient: recipient.displayName,
        status: state.status,
      });
    } catch (err) {
      logger.warn('[workflow-dingtalk] dws send threw', {
        runId,
        recipient: recipient.displayName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[workflow-dingtalk] delivery done', {
    runId,
    status: state.status,
    sent,
    total: uniqueRecipients.length,
  });
}
