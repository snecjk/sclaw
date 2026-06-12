import { cn } from '@/lib/utils';

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
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full p-0 transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-[#28C840]' : 'bg-border',
      )}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card shadow-[0_1px_2px_rgba(15,23,42,0.15)] transition-transform duration-fast',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}
