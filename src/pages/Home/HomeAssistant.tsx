import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { useChatInputBindings } from '@/hooks/use-chat-input-bindings';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
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
  const error = useChatStore((s) => s.error);
  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();
  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentEngineType = currentAgent?.engineType;
  const inputProps = useChatInputBindings({
    onSend: onSend || handleHubSend,
    onQueue: handleHubQueue,
    variant: 'embedded',
    seedText,
    className,
    placeholder: placeholderKey ? t(placeholderKey) : undefined,
    engineType: currentEngineType,
  });

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return (
    <div className={cn('flex flex-col', inputProps.className)}>
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
