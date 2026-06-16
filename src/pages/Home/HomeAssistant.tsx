import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { hostApiFetch } from '@/lib/host-api';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { useChatInputBindings } from '@/hooks/use-chat-input-bindings';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { toast } from 'sonner';
import type { FileAttachment } from '@/pages/Chat/ChatInput';

/**
 * 省区首页底部助手：与聊天页相同的 ChatInput（上传、粘贴图片、拖放、排队、停止），
 * 首次从首页默认态发言会创建会话，后续追问续写当前会话，行为与 HomeAgentHubSurface 一致。
 */
export function HomeAssistant({
  className,
  seedText,
  onSend,
  placeholderKey,
}: {
  className?: string;
  seedText?: string;
  onSend?: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, dingTalkMentions?: import('@/types/dingtalk-mention').DingTalkMention[], workflowId?: string | null) => void;
  /** i18n key under home namespace for composer placeholder override */
  placeholderKey?: string;
}) {
  const { t } = useTranslation('home');
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();
  const [engineSaving, setEngineSaving] = useState(false);
  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const currentEngineType = currentSessionKey === DEFAULT_SESSION_KEY
    ? currentAgent?.engineType
    : currentSession?.engineType ?? currentAgent?.engineType;
  const agentDefaultEngineType = currentAgent?.engineType ?? 'openclaw';
  const agentDefaultEngineLabel = agentDefaultEngineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
  const inputProps = useChatInputBindings({
    onSend: onSend || handleHubSend,
    onQueue: handleHubQueue,
    variant: 'embedded',
    seedText,
    className,
    placeholder: placeholderKey ? t(placeholderKey) : undefined,
    engineType: currentEngineType,
  });

  const handleEngineSwitch = async (engineType: 'openclaw' | 'claude') => {
    if (!currentAgentId || engineType === agentDefaultEngineType) return;
    setEngineSaving(true);
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(currentAgentId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ engineType }),
      });
      await fetchAgents();
      await loadSessions();
      toast.success(`新会话将使用 ${engineType === 'claude' ? 'Claude Agent' : 'OpenClaw'} 引擎`);
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setEngineSaving(false);
    }
  };

  const engineSelectDisabled = sending || !currentAgentId;

  const engineAccessory = (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[12px] font-medium text-[#4E5969] dark:text-muted-foreground">
        引擎
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={engineSelectDisabled || engineSaving}>
          <button
            type="button"
            title="切换新会话执行引擎"
            className={cn(
              'inline-flex h-9 min-w-[180px] max-w-full items-center gap-2.5 rounded-full border border-[#E5E6EB] bg-white px-4 text-left shadow-[0_4px_12px_rgba(29,33,41,0.05)] transition-colors',
              'hover:border-[#FFC17A] hover:bg-[#FFF9F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F00]/20',
              'dark:border-border dark:bg-[#131a24] dark:hover:border-[#FFC17A]/90 dark:hover:bg-white/[0.04]',
              (engineSelectDisabled || engineSaving) && 'pointer-events-none opacity-60',
            )}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {agentDefaultEngineLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          className="min-w-[12rem]"
        >
          {(['openclaw', 'claude'] as const).map((engineType) => {
            const label = engineType === 'claude' ? 'Claude Agent' : 'OpenClaw';
            const isSelected = agentDefaultEngineType === engineType;
            return (
              <DropdownMenuItem
                key={engineType}
                className={cn('flex items-center gap-2', isSelected && 'bg-primary/8 font-medium')}
                onSelect={() => void handleEngineSwitch(engineType)}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return (
    <div className={cn('flex flex-col', inputProps.className)}>
      <div className="mb-3 mt-1 flex justify-start">
        {engineAccessory}
      </div>
      <section className="flex flex-col" aria-label={t('assistant.placeholder')}>
        <ChatInput {...inputProps} engineType={currentEngineType} />
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </section>
      <p className="mt-3 text-right text-xs leading-relaxed text-[#86909C] dark:text-muted-foreground">
        {t('assistant.footerDisclaimer')}
      </p>
    </div>
  );
}
