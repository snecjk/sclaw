import { useEffect, useRef } from 'react';
import {
  Brain,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { contentHeaderActionBtnClass } from '@/lib/surfaces';

/** 会话面板顶部 action 图标的功能气泡：深色 Grey-10 底 + 白字 + 同色箭头。 */
const HEADER_TOOLTIP_BG = 'var(--sto-content-tooltip-background)';
const headerTooltipContentClass = cn(
  // overflow-visible: base TooltipContent sets overflow-hidden, which clips the arrow.
  'overflow-visible rounded-lg border-0 bg-[var(--sto-content-tooltip-background)] px-2.5 py-1.5 text-xs font-medium text-[var(--sto-content-tooltip-foreground)]',
  'shadow-[0_6px_20px_rgba(0,0,0,0.16)]',
);

function HeaderActionTooltip({ label }: { label: string }) {
  return (
    <TooltipContent className={headerTooltipContentClass}>
      <p>{label}</p>
      <TooltipArrow className="fill-[var(--sto-content-tooltip-background)]" style={{ fill: HEADER_TOOLTIP_BG }} />
    </TooltipContent>
  );
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = value.trim().length > 0;
  const hasResults = resultCount > 0;
  const resultLabel = hasQuery
    ? hasResults
      ? `${activeIndex + 1} / ${resultCount}`
      : '0'
    : null;

  const isHeader = variant === 'header';

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const toggleButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'group',
            isHeader
              ? contentHeaderActionBtnClass
              : cn(
                  'h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]',
                  isOpen && 'bg-[var(--sto-control-active-bg)] text-[var(--sto-icon-primary)]',
                ),
          )}
          onClick={onToggle}
          aria-label={t('toolbar.searchToggle')}
        >
          <Search className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </TooltipTrigger>
      <HeaderActionTooltip label={t('toolbar.searchToggle')} />
    </Tooltip>
  );

  const searchPanel = (
    <div
      className={cn(
        isHeader
          ? 'no-drag pointer-events-none absolute right-[calc(var(--sto-content-header-control-h,28px)+4px)] top-0 z-30 h-[var(--sto-content-header-control-h,28px)] w-[16.5rem] transition-opacity duration-150'
          : 'overflow-hidden transition-all duration-200 ease-out',
        isHeader
          ? isOpen ? 'pointer-events-auto opacity-100' : 'invisible opacity-0'
          : isOpen ? 'w-[16.5rem] opacity-100' : 'w-0 opacity-0',
      )}
    >
      <div
        className={cn(
          'sto-overlay flex h-[var(--sto-content-header-control-h,28px)] w-[16.5rem] items-center gap-1 rounded-[10px] border border-border/80 px-1.5',
          'bg-[var(--sto-search-overlay-background)] shadow-[var(--sto-shadow-search-overlay)] backdrop-blur-md',
        )}
      >
        <div className="sto-icon--neutral flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--sto-control-hover-bg)]">
          <Search className="h-3.5 w-3.5" aria-hidden />
        </div>
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('toolbar.searchPlaceholder')}
          className="h-full min-w-0 border-0 bg-transparent px-0 text-[13px] shadow-none placeholder:text-[13px] focus-visible:ring-0 focus-visible:ring-offset-0"
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
          <span className="min-w-[2rem] text-center text-[10px] font-medium leading-none text-muted-foreground">
            {resultLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-lg"
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
            className="h-6 w-6 rounded-lg"
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
            className="h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground"
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
      <div className="relative z-20 h-[var(--sto-content-header-control-h,28px)] w-[var(--sto-content-header-control-h,28px)] shrink-0">
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

export interface ChatConversationHeaderActionsProps {
  showThinking: boolean;
  onToggleThinking: () => void;
  loading: boolean;
  onRefresh: () => void;
  searchProps: Omit<ChatSearchBarProps, 'variant'>;
}

/** 会话区操作 icon 组：搜索 → 刷新 → 思考（三栏时贴对话列右缘） */
export function ChatConversationHeaderActions({
  showThinking,
  onToggleThinking,
  loading,
  onRefresh,
  searchProps,
}: ChatConversationHeaderActionsProps) {
  const { t } = useTranslation('chat');

  return (
    <>
      <ChatSearchBar {...searchProps} variant="header" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn('group', contentHeaderActionBtnClass)}
            onClick={onRefresh}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw
              className={cn('h-4 w-4', loading && 'animate-spin')}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <HeaderActionTooltip label={t('toolbar.refresh')} />
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn('group', contentHeaderActionBtnClass)}
            onClick={onToggleThinking}
            aria-label={showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}
          >
            {showThinking ? (
              <BrainCircuit className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <Brain className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </TooltipTrigger>
        <HeaderActionTooltip
          label={showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}
        />
      </Tooltip>
    </>
  );
}

export interface ChatPreviewToggleHeaderActionProps {
  canShowPreviewPanel: boolean;
  /** 预览区是否已展开（控制 icon 开/关态） */
  isPreviewPanelOpen: boolean;
  onTogglePreview: () => void;
}

/** 预览面板开关：三栏时留在预览列头部/右上角。 */
export function ChatPreviewToggleHeaderAction({
  canShowPreviewPanel,
  isPreviewPanelOpen,
  onTogglePreview,
}: ChatPreviewToggleHeaderActionProps) {
  const { t } = useTranslation('chat');
  if (!canShowPreviewPanel) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('group', contentHeaderActionBtnClass)}
          onClick={onTogglePreview}
          aria-label={isPreviewPanelOpen ? t('preview.collapsePanel') : t('toolbar.openPreview')}
        >
          {isPreviewPanelOpen ? (
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <HeaderActionTooltip
        label={isPreviewPanelOpen ? t('preview.collapsePanel') : t('toolbar.openPreview')}
      />
    </Tooltip>
  );
}

export interface ChatPreviewWorkspaceHeaderActionsProps
  extends ChatPreviewToggleHeaderActionProps {
  isWorkspaceExpanded: boolean;
  onExpandWorkspace: () => void;
  onRestoreWorkspace: () => void;
}

/**
 * Preview 在全局 Header 中的稳定操作组。
 * 固定顺序：Workspace 展开/还原 → Preview 面板开关。
 */
export function ChatPreviewWorkspaceHeaderActions({
  canShowPreviewPanel,
  isPreviewPanelOpen,
  isWorkspaceExpanded,
  onExpandWorkspace,
  onRestoreWorkspace,
  onTogglePreview,
}: ChatPreviewWorkspaceHeaderActionsProps) {
  const { t } = useTranslation('chat');
  if (!canShowPreviewPanel) return null;

  return (
    <>
      {isPreviewPanelOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-slot="preview-workspace-layout-toggle"
              className={cn('group', contentHeaderActionBtnClass)}
              onClick={isWorkspaceExpanded ? onRestoreWorkspace : onExpandWorkspace}
              aria-label={
                isWorkspaceExpanded
                  ? t('preview.restoreWorkspace')
                  : t('preview.expandWorkspace')
              }
            >
              {isWorkspaceExpanded ? (
                <Minimize2 className="h-4 w-4" aria-hidden />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden />
              )}
            </button>
          </TooltipTrigger>
          <HeaderActionTooltip
            label={
              isWorkspaceExpanded
                ? t('preview.restoreWorkspace')
                : t('preview.expandWorkspace')
            }
          />
        </Tooltip>
      ) : null}
      <ChatPreviewToggleHeaderAction
        canShowPreviewPanel={canShowPreviewPanel}
        isPreviewPanelOpen={isPreviewPanelOpen}
        onTogglePreview={onTogglePreview}
      />
    </>
  );
}

export interface ChatContentHeaderActionsProps
  extends ChatConversationHeaderActionsProps,
    ChatPreviewToggleHeaderActionProps {}

/** 兼容旧用法：会话区 icon 组 + 预览开关同排渲染。 */
export function ChatContentHeaderActions({
  canShowPreviewPanel,
  isPreviewPanelOpen,
  onTogglePreview,
  ...conversationProps
}: ChatContentHeaderActionsProps) {
  return (
    <>
      <ChatConversationHeaderActions {...conversationProps} />
      <ChatPreviewToggleHeaderAction
        canShowPreviewPanel={canShowPreviewPanel}
        isPreviewPanelOpen={isPreviewPanelOpen}
        onTogglePreview={onTogglePreview}
      />
    </>
  );
}
