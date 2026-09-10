import { Bot, MessageSquare, Plus, UserRoundPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function PlusMenuItem({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl p-2 outline-none transition-colors',
        'hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-[var(--sto-focus-ring)]',
        'dark:hover:bg-white/[0.06]',
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-[14px]',
          'border border-[var(--sto-border-light)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
          'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)]',
        )}
      >
        <Icon className="h-6 w-6 text-[var(--sto-text-primary)]" strokeWidth={1.5} />
      </span>
      <span className="max-w-[72px] text-center text-[12px] leading-4 text-[var(--sto-text-secondary)]">
        {label}
      </span>
    </button>
  );
}

export function ImHeaderPlusMenu({
  onAddFriend,
  onCreateGroup,
  onAddDigitalEmployee,
}: {
  onAddFriend: () => void;
  onCreateGroup: () => void;
  onAddDigitalEmployee: () => void;
}) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);

  const items = [
    { key: 'addFriend', label: t('im.addFriend'), icon: UserRoundPlus, onClick: onAddFriend },
    { key: 'createGroup', label: t('im.createGroupTitle'), icon: MessageSquare, onClick: onCreateGroup },
    { key: 'addDigitalEmployee', label: t('im.addDigitalEmployee'), icon: Bot, onClick: onAddDigitalEmployee },
  ] as const;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('im.new')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={cn(
          'w-auto min-w-0 overflow-visible rounded-2xl border border-[var(--sto-border-default)]',
          'bg-[#F5F6F7] p-4 shadow-[var(--sto-shadow-content-popover)] backdrop-blur-none',
        )}
      >
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <PlusMenuItem
              key={item.key}
              label={item.label}
              icon={item.icon}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
