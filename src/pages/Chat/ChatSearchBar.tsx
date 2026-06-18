import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ChatSearchBarProps {
  isOpen: boolean;
  onToggle: () => void;
  value: string;
  onChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClear: () => void;
  resultCount: number;
  activeIndex: number;
  disabled?: boolean;
}

export function ChatSearchBar({
  isOpen,
  onToggle,
  value,
  onChange,
  onNext,
  onPrevious,
  onClear,
  resultCount,
  activeIndex,
  disabled = false,
}: ChatSearchBarProps) {
  const { t } = useTranslation('chat');
  const hasQuery = value.trim().length > 0;
  const hasResults = resultCount > 0;
  const resultLabel = hasQuery
    ? hasResults
      ? `${activeIndex + 1} / ${resultCount}`
      : '0'
    : null;

  return (
    <div className="relative z-20 flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]',
          isOpen && 'bg-primary/12 text-primary',
        )}
        onClick={onToggle}
        title={t('toolbar.searchToggle')}
      >
        <Search className="h-4 w-4" />
      </Button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-out',
          isOpen ? 'w-[16.5rem] opacity-100' : 'w-0 opacity-0',
        )}
      >
        <div
          className={cn(
            'flex w-[16.5rem] items-center gap-1.5 rounded-2xl border border-border/80 px-2 py-1.5',
            'bg-white/88 shadow-[0_12px_32px_rgba(15,23,42,0.07)] backdrop-blur-md',
            'dark:bg-white/[0.08]',
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Search className="h-3.5 w-3.5" />
          </div>
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t('toolbar.searchPlaceholder')}
            className="h-8 min-w-0 border-0 bg-transparent px-0 text-[13px] shadow-none placeholder:text-[13px] focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus={isOpen}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) {
                  onPrevious();
                } else {
                  onNext();
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                if (hasQuery) {
                  onClear();
                } else {
                  onToggle();
                }
              }
            }}
          />
          <div className="flex shrink-0 items-center gap-1">
            <span className="min-w-[2rem] text-center text-[10px] font-medium text-muted-foreground">
              {resultLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-xl"
              onClick={onPrevious}
              disabled={disabled || !hasResults}
              title={t('toolbar.searchPrev')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-xl"
              onClick={onNext}
              disabled={disabled || !hasResults}
              title={t('toolbar.searchNext')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-xl text-muted-foreground hover:text-foreground"
              onClick={hasQuery ? onClear : onToggle}
              disabled={disabled}
              title={hasQuery ? t('toolbar.searchClear') : t('toolbar.searchClose')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
