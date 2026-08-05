import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#6B778C] transition-colors hover:bg-white/70 hover:text-[#1D2129] dark:text-muted-foreground dark:hover:bg-background/70 dark:hover:text-foreground',
        active && 'bg-white text-[#1D2129] shadow-sm dark:bg-background dark:text-foreground',
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
    <div className="mb-3 flex shrink-0 items-center overflow-hidden">
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
