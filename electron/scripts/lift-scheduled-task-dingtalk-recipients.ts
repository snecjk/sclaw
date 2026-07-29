/**
 * 可选运维入口：把 schedule_tasks 中「列空 + prompt 含 Recipients 块」的任务回填到
 * `dingtalk_recipients_json`。默认 dry-run。
 *
 * 用法（在已启动的 Electron/主进程上下文，或通过测试注入 service）：
 *   const { getScheduledTaskService } = await import('../scheduled-tasks/scheduled-task-service');
 *   await getScheduledTaskService().liftDingTalkRecipientsFromPrompts({ dryRun: true });
 *   await getScheduledTaskService().liftDingTalkRecipientsFromPrompts({
 *     dryRun: false,
 *     stripPromptBlock: true,
 *   });
 *
 * 不挂 package.json script（工程红线）；不在启动时自动执行。
 */
export {
  planDingTalkRecipientsLift,
  resolveScheduledTaskDingTalkRecipients,
} from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
