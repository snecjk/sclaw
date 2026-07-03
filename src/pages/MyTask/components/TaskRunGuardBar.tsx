/**
 * 我的任务 — 运行保障条（全局防睡眠开关，仅 UI 位于定时任务 Tab）
 */

import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { glassSectionSurface } from '@/lib/surfaces';

export function TaskRunGuardBar() {
  const { t } = useTranslation('tasks');
  const preventSystemSleep = useSettingsStore((state) => state.preventSystemSleep);
  const setPreventSystemSleep = useSettingsStore((state) => state.setPreventSystemSleep);

  return (
    <section
      className={cn(glassSectionSurface, 'mb-4 py-4')}
      aria-label={t('myTask.runGuard.aria')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label className="text-[15px] font-medium text-foreground/80">
            {t('myTask.runGuard.preventSleep')}
          </Label>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('myTask.runGuard.preventSleepDesc')}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground/80">
            {t('myTask.runGuard.preventSleepTips')}
          </p>
        </div>
        <Switch
          checked={preventSystemSleep}
          onCheckedChange={(value) => {
            setPreventSystemSleep(value);
            toast.success(
              value
                ? t('myTask.runGuard.toastEnabled')
                : t('myTask.runGuard.toastDisabled'),
            );
          }}
          className="shrink-0"
        />
      </div>
    </section>
  );
}
