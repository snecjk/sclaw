import { useEffect } from 'react';
import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeAssistant } from './HomeAssistant';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeConversationActive } from './use-home-conversation-active';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { createAutoSendWatcher } from '@/stores/message-queue';

/**
 * 首页：有 CRM 周报权限时为 Hero + 任务卡片 + 底部助手；无权限时为 Hero + 能力卡片 + 底部输入。
 */
export function Home() {
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);
  const showConversation = useHomeConversationActive();
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  useEffect(() => {
    const unsub = createAutoSendWatcher();
    return unsub;
  }, []);

  useEffect(() => () => { cleanupEmptySession(); }, [cleanupEmptySession]);

  if (!crmWeekReportSurfaceAllowed) {
    return (
      <div className="mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-1 pt-2 sm:px-2">
        <HomeAgentHubSurface />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {showConversation ? (
          <HomeMainConversation className="min-h-0 flex-1" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 overflow-y-auto py-6 md:gap-10">
            <HomeHero />
            <HomeSummaryCards />
          </div>
        )}
      </div>
      <div className="sticky z-10 shrink-0 bg-[var(--sto-page-bg)] pt-6 dark:bg-background">
        <HomeAssistant />
      </div>
    </div>
  );
}
