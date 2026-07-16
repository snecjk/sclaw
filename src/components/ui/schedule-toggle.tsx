import { scheduleToggleThumbClass, scheduleToggleTrackClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';

interface ScheduleToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label': string;
}

export function ScheduleToggle({
  checked,
  onCheckedChange,
  'aria-label': ariaLabel,
}: ScheduleToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={scheduleToggleTrackClass(checked)}
      onClick={(event) => {
        event.stopPropagation();
        onCheckedChange(!checked);
      }}
    >
      <span className={cn(scheduleToggleThumbClass, checked && 'translate-x-4')} />
    </button>
  );
}
