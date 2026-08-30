import type { SclawActivationResult, SclawExtensionBuildContext } from '../../../../shared/agent-extensions';

export const STO_SCHEDULED_TASK_MANAGEMENT_ACTIVATION = 'scheduled-task-management';

function normalizeIntentText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toLowerCase();
}

export function matchesStoScheduledTaskManagementIntent(
  context: SclawExtensionBuildContext,
): SclawActivationResult {
  const text = normalizeIntentText(context.userPrompt);
  if (!text) return { active: false };

  const planningOnly = /(?:项目|工作|研发|迭代|需求)(?:计划|任务)/u.test(text);
  const schedulingSignal = /(?:定时|周期|cron|每天|每日|每周|每星期|每月|工作日)/u.test(text);
  if (planningOnly && !schedulingSignal) return { active: false };

  if (/(?:定时|计划|周期)(?:任务|调度)|cron/u.test(text)) {
    return { active: true, reason: 'scheduled-task-domain' };
  }

  if (
    /(?:有没有|是否|支持|能否|能不能|可以).{0,8}(?:定时|周期|调度)/u.test(text)
    || /(?:定时|周期|调度).{0,8}(?:工具|能力|支持)/u.test(text)
  ) {
    return { active: true, reason: 'scheduled-task-capability' };
  }

  const recurringTime = /(?:每天|每日|每周|每星期|每月|工作日|周一|周二|周三|周四|周五|周六|周日)/u;
  const executionAction = /(?:执行|运行|发送|推送|生成|汇总|提醒|通知|触发)/u;
  if (recurringTime.test(text) && executionAction.test(text)) {
    return { active: true, reason: 'recurring-execution' };
  }

  return { active: false };
}
