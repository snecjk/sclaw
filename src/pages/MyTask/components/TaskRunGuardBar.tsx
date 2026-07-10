/**
 * 我的任务 — 运行保障条（全局防睡眠开关，仅 UI 位于定时任务 Tab）
 */

import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import {
  myTaskCardDescriptionClass,
  myTaskCardTitleClass,
  myTaskRunGuardBarShellClass,
} from '@/lib/surfaces';
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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={myTaskCardTitleClass}>{t('myTask.runGuard.preventSleep')}</p>
          <p className={cn(myTaskCardDescriptionClass, 'mt-1 line-clamp-none')}>
            {t('myTask.runGuard.preventSleepDesc')}
          </p>
          <p className={cn(myTaskCardDescriptionClass, 'mt-1.5 line-clamp-none text-muted-foreground/80')}>
            {t('myTask.runGuard.preventSleepTips')}
          </p>
        </div>
        <WorkflowScheduleToggle
          checked={preventSystemSleep}
          aria-label={t('myTask.runGuard.preventSleep')}
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
    </section>
  );
}
