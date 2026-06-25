/**
 * ChatToolCallCard — 对话流内工具调用展示（思考面板 + 助手消息共用）
 *
 * 结构对齐参数摘要「数据来源」：标题行在描边外；入参/code 在 workflowParamsSummaryCardClass 容器内。
 * 使用位置：ThinkingProcessPanel、ChatMessage 已完成 tool_use 块。
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  chatToolCallContentShellClass,
  chatToolCallHeaderBtnClass,
  chatToolCallInputPreClass,
  chatToolCallShellClass,
} from '@/lib/surfaces';
import { maskSensitiveToolInputForDisplay } from '@/pages/Chat/message-utils';

export interface ChatToolCallCardProps {
  /** 工具名（已解析 skill 展示名） */
  name: string;
  /** 工具入参；null 时不可展开 */
  input: unknown;
  /** 流式态可选；缺省为已完成 */
  status?: 'running' | 'completed' | 'error';
  className?: string;
}

export function ChatToolCallCard({
  name,
  input,
  status = 'completed',
  className,
}: ChatToolCallCardProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const isRunning = status === 'running';
  const hasInput = input != null;
  const displayName = name.trim() || '…';

  return (
    <div className={cn(chatToolCallShellClass, className)}>
      <button
        type="button"
        className={chatToolCallHeaderBtnClass}
        onClick={() => hasInput && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasInput}
      >
        {hasInput ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
        <span className="min-w-0 truncate">
          {t('streaming.invokeToolLabel', { toolName: displayName })}
        </span>
      </button>
      {open && hasInput ? (
        <div className={chatToolCallContentShellClass}>
          <pre className={chatToolCallInputPreClass}>
            {maskSensitiveToolInputForDisplay(input)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
