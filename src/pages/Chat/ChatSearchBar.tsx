import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, RefreshCw, Search, Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  contentHeaderActionBtnActiveClass,
  contentHeaderActionBtnClass,
} from '@/lib/surfaces';

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
  /** toolbar：原对话工具栏；header：内容区标题栏（搜索 icon 固定最右、面板向左展开） */
  variant?: 'toolbar' | 'header';
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
  variant = 'toolbar',
}: ChatSearchBarProps) {
  const { t } = useTranslation('chat');
  const hasQuery = value.trim().length > 0;
  const hasResults = resultCount > 0;
  const resultLabel = hasQuery
    ? hasResults
      ? `${activeIndex + 1} / ${resultCount}`
      : '0'
    : null;

  const isHeader = variant === 'header';

  const toggleButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        isHeader
          ? cn(contentHeaderActionBtnClass, isOpen && contentHeaderActionBtnActiveClass)
          : cn(
              'h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]',
              isOpen && 'bg-primary/12 text-primary',
            ),
      )}
      onClick={onToggle}
      title={t('toolbar.searchToggle')}
      aria-label={t('toolbar.searchToggle')}
    >
      <Search className="h-4 w-4" aria-hidden />
    </Button>
  );

  const searchPanel = (
    <div
      className={cn(
        'overflow-hidden transition-all duration-200 ease-out',
        isOpen ? (isHeader ? 'w-[16.5rem] opacity-100' : 'w-[16.5rem] opacity-100') : 'w-0 opacity-0',
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
          <Search className="h-3.5 w-3.5" aria-hidden />
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
            aria-label={t('toolbar.searchPrev')}
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-xl"
            onClick={onNext}
            disabled={disabled || !hasResults}
            title={t('toolbar.searchNext')}
            aria-label={t('toolbar.searchNext')}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={hasQuery ? onClear : onToggle}
            disabled={disabled}
            title={hasQuery ? t('toolbar.searchClear') : t('toolbar.searchClose')}
            aria-label={hasQuery ? t('toolbar.searchClear') : t('toolbar.searchClose')}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );

  if (isHeader) {
    return (
      <div className="relative z-20 flex flex-row-reverse items-center gap-1">
        {toggleButton}
        {searchPanel}
      </div>
    );
  }

  return (
    <div className="relative z-20 flex items-center gap-2">
      {toggleButton}
      {searchPanel}
    </div>
  );
}

export interface ChatContentHeaderActionsProps {
  canShowPreviewPanel: boolean;
  /** 预览区是否已展开（控制 icon 开/关态） */
  isPreviewPanelOpen: boolean;
  onTogglePreview: () => void;
  showThinking: boolean;
  onToggleThinking: () => void;
  loading: boolean;
  onRefresh: () => void;
  searchProps: Omit<ChatSearchBarProps, 'variant'>;
}

/** Chat 页注入 ContentHeader 的右侧 icon 组（预览 → 思考 → 刷新 → 搜索） */
export function ChatContentHeaderActions({
  canShowPreviewPanel,
  isPreviewPanelOpen,
  onTogglePreview,
  showThinking,
  onToggleThinking,
  loading,
  onRefresh,
  searchProps,
}: ChatContentHeaderActionsProps) {
  const { t } = useTranslation('chat');

  return (
    <>
      <ChatSearchBar {...searchProps} variant="header" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={contentHeaderActionBtnClass}
            onClick={onRefresh}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent><p>{t('toolbar.refresh')}</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              contentHeaderActionBtnClass,
              showThinking && contentHeaderActionBtnActiveClass,
            )}
            onClick={onToggleThinking}
            aria-label={showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}
          >
            <Brain className="h-4 w-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
      {canShowPreviewPanel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                contentHeaderActionBtnClass,
                isPreviewPanelOpen && contentHeaderActionBtnActiveClass,
              )}
              onClick={onTogglePreview}
              aria-label={
                isPreviewPanelOpen ? t('preview.collapsePanel') : t('toolbar.openPreview')
              }
            >
              {isPreviewPanelOpen ? (
                <PanelRightClose className="h-4 w-4" aria-hidden />
              ) : (
                <PanelRightOpen className="h-4 w-4" aria-hidden />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isPreviewPanelOpen ? t('preview.collapsePanel') : t('toolbar.openPreview')}</p>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}
