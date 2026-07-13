/**
 * 我的任务 — 运行保障条（全局防睡眠开关，位于 Tab 切换上方）
 */

import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { myTaskCardTitleClass, myTaskRunGuardBarShellClass } from '@/lib/surfaces';
import { WorkflowScheduleToggle } from '@/pages/Workflow/components/workflow-schedule-toggle';

export function TaskRunGuardBar() {
  const { t } = useTranslation('tasks');
  const preventSystemSleep = useSettingsStore((state) => state.preventSystemSleep);
  const setPreventSystemSleep = useSettingsStore((state) => state.setPreventSystemSleep);

  return (
    <section
      className={cn(myTaskRunGuardBarShellClass, 'mb-4 shrink-0')}
      aria-label={t('myTask.runGuard.aria')}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  'text-[#4760FE] transition-colors hover:text-[#3243D9]',
                  'dark:text-blue-300 dark:hover:text-blue-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
                aria-label={t('myTask.runGuard.infoAria')}
              >
                <CircleAlert className="h-4 w-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-[280px] space-y-1.5 whitespace-normal text-xs leading-relaxed"
            >
              <p>{t('myTask.runGuard.preventSleepDesc')}</p>
              <p className="text-muted-foreground">{t('myTask.runGuard.preventSleepTips')}</p>
            </TooltipContent>
          </Tooltip>
          <p className={myTaskCardTitleClass}>{t('myTask.runGuard.preventSleep')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn(myTaskCardTitleClass, 'whitespace-nowrap')}>
            {t('myTask.runGuard.keepAwake')}
          </span>
          <WorkflowScheduleToggle
            checked={preventSystemSleep}
            aria-label={t('myTask.runGuard.keepAwake')}
            onCheckedChange={(value) => {
              setPreventSystemSleep(value);
              toast.success(
                value
                  ? t('myTask.runGuard.toastEnabled')
                  : t('myTask.runGuard.toastDisabled'),
              );
            }}
          />
        </div>
      </div>
    </section>
  );
}
