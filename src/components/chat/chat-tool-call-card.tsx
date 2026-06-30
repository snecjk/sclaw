/**
 * ChatToolCallCard — 对话流内工具调用展示（思考面板 + 助手消息共用）
 *
 * - `collapsible`：助手消息内独立 tool 块，可折叠（默认）
 * - `readonly`：思考面板展开态，平铺只读（MasterGo 4:2177）
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
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
import { maskSensitiveToolInputForDisplay } from '@/pages/Chat/message-utils';

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
  const hasInput = input != null;
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
      ) : (
        <p className={chatToolCallInputPreClass}>
          {t('streaming.toolNoParams')}
          {isAwaitingToolInput ? <ChatProcessLoadingEllipsis /> : null}
        </p>
      )}
    </ChatProcessContentRail>
  );
}

export function ChatToolCallCard({
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
  className,
}: ChatToolCallCardProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const isRunning = status === 'running';
  const isReadonly = variant === 'readonly';
  const isThinkingProcess = presentation === 'thinkingProcess';
  const baseLabel = displayName ?? resolveChatToolDisplayName(name.trim() || '…');
  const label = isThinkingProcess
    ? t('streaming.invokeToolLabel', { toolName: baseLabel })
    : baseLabel;
  const ToolIcon = isThinkingProcess
    ? resolveChatThinkingProcessToolIcon()
    : resolveChatProcessToolIcon(name);

  if (isReadonly) {
    return (
      <div className={cn(chatToolCallShellClass, className)}>
        <div className={chatProcessTitleRowClass}>
          {isRunning ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" aria-hidden />
          ) : null}
          <ToolIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </div>
        <ToolCallContent
          input={input}
          hasLeadingOffset={isRunning}
          isInputTypewriterActive={isInputTypewriterActive}
          typewriterResetKey={typewriterResetKey ?? `tool-${name}`}
          onInputRevealComplete={onInputRevealComplete}
          isAwaitingToolInput={isAwaitingToolInput}
          status={status}
        />
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
          <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        )}
        <ToolIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        {isRunning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" aria-hidden />
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open ? <ToolCallContent input={input} hasLeadingOffset /> : null}
    </div>
  );
}
