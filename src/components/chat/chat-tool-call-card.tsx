/**
 * ChatToolCallCard — 对话流内工具调用展示（思考面板 + 助手消息共用）
 *
 * - `collapsible`：助手消息内独立 tool 块，可折叠（默认）
 * - `readonly` + `thinkingProcess`：思考面板内可折叠只读块（对齐 sai-desktop）
 */
import { memo, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useProcessBlockCollapse } from '@/hooks/use-process-block-collapse';
import {
  resolveChatProcessToolIcon,
  resolveChatThinkingProcessToolIcon,
} from '@/lib/chat-process-icons';
import { resolveChatToolDisplayName } from '@/lib/chat-tool-display-name';
import {
  ChatProcessContentRail,
} from '@/components/chat/chat-process-block';
import { useTypewriterReveal } from '@/hooks/use-typewriter-reveal';
import { ChatProcessLoadingEllipsis } from '@/components/chat/chat-process-loading-ellipsis';
import {
  chatProcessTitleRowClass,
  chatToolCallHeaderBtnClass,
  chatToolCallInputPreClass,
  chatToolCallShellClass,
} from '@/lib/surfaces';
import { maskSensitiveToolInputForDisplay, hasDisplayableToolInput } from '@/pages/Chat/message-utils';
import { resolveToolInputState } from '@/lib/tool-input-merge';
import {
  resolveProcessHeaderLayout,
} from '@/components/chat/process-rail-layout';

export interface ChatToolCallCardProps {
  /** 原始工具名（用于图标映射） */
  name: string;
  /** 可选展示名；缺省走 resolveChatToolDisplayName(name) */
  displayName?: string;
  /** 工具入参；null/undefined 视为无参数 */
  input: unknown;
  /** 流式态可选；缺省为已完成 */
  status?: 'running' | 'completed' | 'error';
  /** collapsible 可折叠；readonly 思考面板内平铺只读 */
  variant?: 'collapsible' | 'readonly';
  /** 思考面板：统一 FileSearch 图标 + 「调用工具-」标题前缀 */
  presentation?: 'default' | 'thinkingProcess';
  /** 思考面板流式：仅活跃工具块对参数做打字机 */
  isInputTypewriterActive?: boolean;
  /** 与 isInputTypewriterActive 配套，切换工具块时重置进度 */
  typewriterResetKey?: string;
  /** 参数打字追平后回调（顺序队列切到下一块） */
  onInputRevealComplete?: () => void;
  /** 顺序队列轮到该工具但参数尚未到达 */
  isAwaitingToolInput?: boolean;
  /** 思考面板流式中二级折叠；结束后平铺展开、无 chevron */
  thinkingProcessCollapsible?: boolean;
  /** 思考面板：段结束自动收起 */
  isComplete?: boolean;
  /** 思考面板：流式未完成时自动展开 */
  autoExpand?: boolean;
  /** 思考面板：当前活跃工具标题 shimmer */
  isActive?: boolean;
  className?: string;
}

function ToolCallContent({
  input,
  hasLeadingOffset = false,
  isInputTypewriterActive = false,
  typewriterResetKey = 'tool-input',
  onInputRevealComplete,
  isAwaitingToolInput = false,
  status = 'completed',
}: {
  input: unknown;
  hasLeadingOffset?: boolean;
  isInputTypewriterActive?: boolean;
  typewriterResetKey?: string;
  onInputRevealComplete?: () => void;
  isAwaitingToolInput?: boolean;
  status?: 'running' | 'completed' | 'error';
}) {
  const { t } = useTranslation('chat');
  const inputState = resolveToolInputState(input, status);
  const hasInput = hasDisplayableToolInput(input);
  const inputText = hasInput ? maskSensitiveToolInputForDisplay(input) : '';
  const { text: displayed, isAnimating } = useTypewriterReveal(inputText, isInputTypewriterActive, {
    resetKey: typewriterResetKey,
  });
  const showTypewriter = isInputTypewriterActive || isAnimating;
  const isSequentialActive = isInputTypewriterActive || isAwaitingToolInput;

  useEffect(() => {
    if (!isSequentialActive) return;
    if (hasInput) {
      if (!isInputTypewriterActive || isAnimating) return;
      if (displayed.length < inputText.length) return;
      onInputRevealComplete?.();
      return;
    }
    if (status === 'running') return;
    onInputRevealComplete?.();
  }, [
    isSequentialActive,
    isInputTypewriterActive,
    isAnimating,
    displayed,
    inputText.length,
    hasInput,
    status,
    onInputRevealComplete,
  ]);

  return (
    <ChatProcessContentRail hasLeadingOffset={hasLeadingOffset}>
      {hasInput ? (
        showTypewriter ? (
          <pre
            className={cn(chatToolCallInputPreClass, 'whitespace-pre-wrap')}
            aria-busy={isInputTypewriterActive || isAnimating ? true : undefined}
          >
            {displayed}
            {isInputTypewriterActive ? <ChatProcessLoadingEllipsis /> : null}
          </pre>
        ) : (
          <pre className={chatToolCallInputPreClass}>{inputText}</pre>
        )
      ) : inputState === 'none' ? (
        <p className={chatToolCallInputPreClass}>{t('streaming.toolNoParams')}</p>
      ) : inputState === 'unknown' && status === 'running' ? (
        <p className={chatToolCallInputPreClass}>
          <ChatProcessLoadingEllipsis />
        </p>
      ) : null}
    </ChatProcessContentRail>
  );
}

export const ChatToolCallCard = memo(function ChatToolCallCard({
  name,
  displayName,
  input,
  status = 'completed',
  variant = 'collapsible',
  presentation = 'default',
  isInputTypewriterActive = false,
  typewriterResetKey,
  onInputRevealComplete,
  isAwaitingToolInput = false,
  thinkingProcessCollapsible = false,
  isComplete = false,
  autoExpand = false,
  isActive = false,
  className,
}: ChatToolCallCardProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const isRunning = status === 'running';
  const isReadonly = variant === 'readonly';
  const isThinkingProcess = presentation === 'thinkingProcess';
  const isThinkingProcessCollapsible =
    isReadonly && isThinkingProcess && thinkingProcessCollapsible;
  const {
    wrapperRef,
    expanded: thinkingExpanded,
    bodyMounted: thinkingBodyMounted,
    toggle: toggleThinkingBlock,
    bodyGridClass,
    chevronClass,
  } = useProcessBlockCollapse({
    collapsible: isThinkingProcessCollapsible,
    isComplete,
    autoExpand,
    unmountCollapsedBody: isThinkingProcessCollapsible,
  });
  const baseLabel = displayName ?? resolveChatToolDisplayName(name.trim() || '…');
  const label = isThinkingProcess
    ? t('streaming.invokeToolLabel', { toolName: baseLabel })
    : baseLabel;
  const ToolIcon = isThinkingProcess
    ? resolveChatThinkingProcessToolIcon()
    : resolveChatProcessToolIcon(name);

  const contentRailLayout = resolveProcessHeaderLayout(
    isThinkingProcessCollapsible
      ? 'collapsible_chevron_after_icon'
      : isReadonly
        ? 'readonly_title'
        : 'collapsible_chevron_before_icon',
  );

  const toolBody = (
    <ToolCallContent
      input={input}
      hasLeadingOffset={contentRailLayout.hasLeadingControlBeforeSemanticIcon}
      isInputTypewriterActive={isInputTypewriterActive}
      typewriterResetKey={typewriterResetKey ?? `tool-${name}`}
      onInputRevealComplete={onInputRevealComplete}
      isAwaitingToolInput={isAwaitingToolInput}
      status={status}
    />
  );

  if (isThinkingProcessCollapsible) {
    return (
      <div
        ref={wrapperRef}
        className={cn(
          chatToolCallShellClass,
          // 与 ChatProcessBlock 一致：收起时去掉 header/body 间距，避免流式折叠后行间突然多出 gap
          !thinkingExpanded && 'gap-0',
          className,
        )}
      >
        <button
          type="button"
          className={cn(
            chatProcessTitleRowClass,
            'w-full text-left transition-colors duration-150 hover:text-foreground',
          )}
          onClick={toggleThinkingBlock}
          aria-expanded={thinkingExpanded}
        >
          <ToolIcon
            className="h-4 w-4 shrink-0 text-[var(--sto-content-process-icon-foreground)] opacity-[var(--sto-content-process-icon-opacity)]"
            aria-hidden
          />
          <span className="flex min-w-0 items-center gap-1">
            <span
              className={cn(
                'truncate',
                isActive && 'chat-interaction-shimmer-text',
              )}
            >
              {label}
            </span>
            <ChevronDown className={chevronClass} aria-hidden />
          </span>
        </button>
        {thinkingBodyMounted ? (
          <div className={bodyGridClass}>
            <div className="min-h-0 overflow-hidden">{toolBody}</div>
          </div>
        ) : null}
      </div>
    );
  }

  if (isReadonly) {
    return (
      <div className={cn(chatToolCallShellClass, className)}>
        <div className={chatProcessTitleRowClass}>
          <ToolIcon
            className="h-4 w-4 shrink-0 text-[var(--sto-content-process-icon-foreground)] opacity-[var(--sto-content-process-icon-opacity)]"
            aria-hidden
          />
          <span className="min-w-0 truncate">{label}</span>
        </div>
        {toolBody}
      </div>
    );
  }

  return (
    <div className={cn(chatToolCallShellClass, className)}>
      <button
        type="button"
        className={chatToolCallHeaderBtnClass}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown
            className="h-4 w-4 shrink-0 text-[var(--sto-content-process-icon-foreground)] opacity-[var(--sto-content-process-icon-opacity)]"
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0 text-[var(--sto-content-process-icon-foreground)] opacity-[var(--sto-content-process-icon-opacity)]"
            aria-hidden
          />
        )}
        <ToolIcon
          className="h-4 w-4 shrink-0 text-[var(--sto-content-process-icon-foreground)] opacity-[var(--sto-content-process-icon-opacity)]"
          aria-hidden
        />
        {isRunning ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-[var(--sto-content-process-icon-foreground)] opacity-[var(--sto-content-process-icon-opacity)]"
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open ? <ToolCallContent input={input} hasLeadingOffset /> : null}
    </div>
  );
});
