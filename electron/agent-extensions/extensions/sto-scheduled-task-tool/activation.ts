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

  // Activation intentionally favors recall over precision. A false activation only
  // exposes the reviewed management tools, while a missed activation leaves the
  // model with no valid path because shell/CLI task management is blocked.
  const explicitScheduledTaskDomain = /(?:(?:定时|计划|周期|自动化|轮询|调度).{0,8}(?:任务|作业|工作|执行)|(?:任务|作业|工作).{0,8}(?:定时|周期|自动化|轮询|调度)|cron|scheduledtask|recurringtask|automationjob)/u;
  if (explicitScheduledTaskDomain.test(text)) {
    return { active: true, reason: 'scheduled-task-domain' };
  }

  if (
    /(?:有没有|是否|支持|能否|能不能|可以).{0,12}(?:定时|周期|调度|轮询|自动化|提醒)/u.test(text)
    || /(?:定时|周期|调度|自动化|轮询).{0,12}(?:工具|能力|支持)/u.test(text)
  ) {
    return { active: true, reason: 'scheduled-task-capability' };
  }

  const recurringTime = /(?:每天|每日|每周|每星期|每月|每年|每季度|每小时|每分钟|每隔|隔天|隔周|工作日|周末|周一|周二|周三|周四|周五|周六|周日|定期|定点|固定时间|按时|到点|everyday|daily|weekly|monthly|hourly|periodically)/u;
  if (recurringTime.test(text)) {
    return { active: true, reason: 'recurring-schedule' };
  }

  const managementAction = /(?:创建|新建|建立|添加|设置|配置|安排|建个|做个|列出|查询|查看|管理|修改|更新|调整|改成|暂停|停用|启用|恢复|删除|移除|取消|立即执行|马上执行|触发|create|schedule|list|update|delete|pause|resume|trigger)/u;
  const possibleTaskTarget = /(?:任务|作业|自动化|提醒|计划|调度|轮询|job|task)/u;
  if (managementAction.test(text) && possibleTaskTarget.test(text)) {
    return { active: true, reason: 'possible-task-management' };
  }

  // Keep the common project/work planning phrases out only after every
  // high-recall scheduling rule has had a chance to activate.
  const planningOnly = /(?:项目|工作|研发|迭代|需求)(?:计划|任务)/u.test(text);
  if (planningOnly) return { active: false };

  return { active: false };
}
