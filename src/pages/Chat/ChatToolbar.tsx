/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useMemo } from 'react';
import { RefreshCw, Brain, Bot, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const switchToAgentMainSession = useChatStore((s) => s.switchToAgentMainSession);
  const agents = useAgentsStore((s) => s.agents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const { t } = useTranslation('chat');
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );

  const agentRows = useMemo(() => {
    const list = [...(agents ?? [])];
    if (currentAgentId && !list.some((a) => a.id === currentAgentId)) {
      list.unshift({
        id: currentAgentId,
        name: currentAgentName,
        isDefault: false,
        modelDisplay: '',
        inheritedModel: false,
        workspace: '',
        agentDir: '',
        mainSessionKey: '',
        channelTypes: [],
      });
    }
    return list;
  }, [agents, currentAgentId, currentAgentName]);

  const currentRow = useMemo(
    () => agentRows.find((a) => a.id === currentAgentId),
    [agentRows, currentAgentId],
  );

  const triggerLabel = useMemo(() => {
    const base = currentRow?.name ?? currentAgentName;
    const mark = currentRow?.isDefault ? ` ${t('toolbar.defaultAgentMark')}` : '';
    return `${base}${mark}`;
  }, [currentRow, currentAgentName, t]);

  const agentSelectDisabled =
    !isGatewayRunning || sending || agentRows.length === 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 max-w-full items-center gap-2 sm:max-w-[min(100vw-10rem,360px)]">
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-[12px]">
          {t('toolbar.conversationTargetLabel')}
        </span>
        <DropdownMenu>
        <div
          className={cn(
            'flex min-w-0 max-w-[min(100vw-11rem,220px)] flex-1 items-stretch rounded-full border border-primary/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),transparent),rgba(255,255,255,0.24)] shadow-[0_8px_18px_rgba(15,23,42,0.06)] sm:max-w-[260px]',
            'dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent),rgba(255,255,255,0.04)]',
          )}
        >
          <DropdownMenuTrigger asChild disabled={agentSelectDisabled}>
            <button
              type="button"
              title={t('toolbar.switchAgentTitle')}
              aria-label={`${t('toolbar.conversationTargetLabel')}, ${triggerLabel}. ${t('toolbar.switchAgentAria')}`}
              className={cn(
                'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full py-0 pl-2.5 pr-2 text-left outline-none',
                'transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0',
                'dark:hover:bg-white/[0.06]',
                'disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                {triggerLabel}
              </span>
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
                strokeWidth={2.25}
              />
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent
          align="end"
          side="bottom"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[12rem] max-w-[min(100vw-2rem,320px)]"
        >
          {agentRows.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              className={cn(
                'flex flex-col items-stretch gap-0.5',
                agent.id === currentAgentId && 'bg-primary/8 font-medium',
              )}
              onSelect={() => {
                switchToAgentMainSession(agent.id);
              }}
            >
              <span className="truncate">
                {agent.name}
                {agent.isDefault ? ` ${t('toolbar.defaultAgentMark')}` : ''}
              </span>
              {agent.modelDisplay ? (
                <span className="truncate text-[11px] font-normal text-muted-foreground">
                  {agent.modelDisplay}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full border border-primary/10 bg-primary/[0.04] hover:bg-primary/[0.08]"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Thinking Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 rounded-full border border-primary/10 bg-primary/[0.04] hover:bg-primary/[0.08]',
              showThinking && 'bg-primary/12 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
