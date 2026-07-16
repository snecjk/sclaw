/**
 * 我的任务 — 运行保障控件（标题行右侧：文案 + 问号提示 + 开关）
 */

import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { myTaskRunGuardBarShellClass } from '@/lib/surfaces';
import { ScheduleToggle } from '@/components/ui/schedule-toggle';

export function TaskRunGuardBar() {
  const { t } = useTranslation('tasks');
  const preventSystemSleep = useSettingsStore((state) => state.preventSystemSleep);
  const setPreventSystemSleep = useSettingsStore((state) => state.setPreventSystemSleep);

  return (
    <div
      className={myTaskRunGuardBarShellClass}
      aria-label={t('myTask.runGuard.aria')}
    >
      <span className="whitespace-nowrap text-sm font-medium leading-[18px] text-foreground">
        {t('myTask.runGuard.preventSleep')}
      </span>
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
              'text-muted-foreground transition-colors hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
            aria-label={t('myTask.runGuard.infoAria')}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="max-w-[280px] whitespace-normal text-xs leading-relaxed"
        >
          {t('myTask.runGuard.preventSleepTips')}
        </TooltipContent>
      </Tooltip>
      <ScheduleToggle
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
  );
}
