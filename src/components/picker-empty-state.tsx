import emptyIcon from '@/assets/icons/empty-icon.svg';

interface PickerEmptyStateProps {
  message: string;
}

export function PickerEmptyState({ message }: PickerEmptyStateProps) {
  return (
    <div className="flex min-h-[314px] flex-col items-center justify-center gap-2 text-center">
      <img src={emptyIcon} alt="" aria-hidden className="h-10 w-10" />
      <p className="text-[12px] font-normal leading-5 text-[#86909C]">{message}</p>
    </div>
  );
}
