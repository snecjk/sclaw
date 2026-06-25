import { cn } from '@/lib/utils';
import { scheduleToggleThumbClass, scheduleToggleTrackClass } from '@/lib/surfaces';

interface WorkflowScheduleToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label': string;
}

/** 与 test-mockup 中 nwf-tg 同款开关 */
export function WorkflowScheduleToggle({
  checked,
  onCheckedChange,
  'aria-label': ariaLabel,
}: WorkflowScheduleToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={scheduleToggleTrackClass(checked)}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
    >
      <span className={cn(scheduleToggleThumbClass, checked && 'translate-x-4')} />
    </button>
  );
}
