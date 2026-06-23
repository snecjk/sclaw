/**
 * Chat Toolbar
 * Session selector, model selector, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { type ReactNode } from 'react';
import { RefreshCw, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { ChatEngineSelector, ChatModelSelector } from './ChatEngineModelSelectors';

export function ChatToolbar({ trailingContent }: { trailingContent?: ReactNode }) {
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const refresh = useChatStore((s) => s.refresh);
  const { t } = useTranslation('chat');

  return (
    <div className="flex w-full items-center justify-between gap-3 pt-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ChatEngineSelector />
        {trailingContent}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ChatModelSelector />

        {/* Refresh */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]"
              onClick={() => refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('toolbar.refresh')}</p></TooltipContent>
        </Tooltip>

        {/* Thinking Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]',
                showThinking && 'bg-primary/12 text-primary',
              )}
              onClick={toggleThinking}
            >
              <Brain className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p></TooltipContent>
        </Tooltip>

      </div>
    </div>
  );
}
