import type { InputHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dataCenterToolbarInteractiveSurfaceClass } from './toolbar-styles';

export function DataCenterToolbarSearch({
  value,
  onValueChange,
  placeholder,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const accessibleLabel = inputProps['aria-label'] ?? placeholder;

  return (
    <label className={cn(dataCenterToolbarInteractiveSurfaceClass, 'flex w-[300px] items-center gap-2 px-3')}>
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        {...inputProps}
        type="text"
        aria-label={accessibleLabel}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function TabButton({
  active = false,
  disabled = false,
  children,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative h-9 px-0 text-[16px] font-semibold transition-colors',
        active ? 'text-[#1D2129] dark:text-foreground' : 'text-[#86909C] dark:text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-70',
      )}
    >
      {children}
    </button>
  );
}

export function IconToggle({ active, label, children, onClick }: { active: boolean; label: string; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'sto-segment-item sto-segment-item--data-center-view inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground transition-colors',
        active && 'text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function FolderBreadcrumbBar({
  breadcrumbs,
  rootLabel,
  onBack,
  onOpen,
}: {
  breadcrumbs: Array<{ entryId: string; name: string }>;
  rootLabel: string;
  onBack: () => void;
  onOpen: (entryId: string) => void;
}) {
  const { t } = useTranslation('common');
  const items = [{ entryId: 'root', name: rootLabel }, ...breadcrumbs.slice(1)];
  return (
    <div className="flex shrink-0 items-center overflow-hidden">
      <button
        type="button"
        onClick={onBack}
        className="mr-3 inline-flex shrink-0 items-center gap-1 text-[14px] font-normal leading-6 text-[#FF6A00] hover:text-[#E95F00] dark:text-orange-400 dark:hover:text-orange-300"
      >
        <ArrowLeft className="h-5 w-5" />
        {t('actions.back')}
      </button>
      {items.length ? (
        <div className="flex min-w-0 items-center gap-3 text-[14px] font-normal leading-6">
          {items.map((item, index) => (
            <div key={`${item.entryId}-${index}`} className="flex min-w-0 items-center gap-3">
              {index > 0 ? <span className="shrink-0 text-[#E5E6EB] dark:text-border">/</span> : null}
              <button
                type="button"
                onClick={() => onOpen(item.entryId)}
                disabled={index === items.length - 1}
                className={cn(
                  'truncate text-[#6B778C] transition-colors hover:text-[#1D2129] disabled:cursor-default disabled:hover:text-[#1D2129] dark:text-muted-foreground dark:hover:text-foreground dark:disabled:hover:text-foreground',
                  index === items.length - 1 && 'font-medium text-[#1D2129] dark:text-foreground',
                )}
              >
                {item.name}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
