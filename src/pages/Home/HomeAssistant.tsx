import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';

/**
 * 省区首页底部助手：与聊天页相同的 ChatInput（上传、粘贴图片、拖放、排队、停止），
 * 发送前 newSession，行为与 HomeAgentHubSurface 一致。
 */
export function HomeAssistant({ className }: { className?: string }) {
  const { t } = useTranslation('home');
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const abortRun = useChatStore((s) => s.abortRun);
  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return (
    <div className={cn('flex flex-col', className)}>
      <section className="flex flex-col" aria-label={t('assistant.placeholder')}>
        <ChatInput
          variant="embedded"
          onSend={handleHubSend}
          onStop={() => void abortRun()}
          onQueue={handleHubQueue}
          disabled={!isGatewayRunning}
          sending={sending}
        />
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </section>
      <p className="mt-3 text-center text-xs leading-relaxed text-[#86909C] dark:text-muted-foreground">
        {t('assistant.footerDisclaimer')}
      </p>
    </div>
  );
}
