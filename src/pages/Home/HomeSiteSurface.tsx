/**
 * 网点用户首页：Hero + 工作流引导卡片 + 底部助手输入。
 */
import { HomeHero } from './HomeHero';
import { HomeWorkflowGuideCards } from './HomeWorkflowGuideCards';
import { HomeAssistant } from './HomeAssistant';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeConversationActive } from './use-home-conversation-active';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { ChatEngineSelector, ChatModelSelector } from '@/pages/Chat/ChatEngineModelSelectors';
// import { HomeOfficialWorkflowCards } from './HomeOfficialWorkflowCards';

export function HomeSiteSurface({ seedText }: { seedText?: string }) {
  const showConversation = useHomeConversationActive();
  const { handleHubSend } = useHomeChatEntrySend();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {showConversation ? (
          <HomeMainConversation className="min-h-0 flex-1" />
        ) : (
          <>
            <div className="mb-3 mt-2 flex w-full items-center justify-between px-4 sm:px-6">
              <ChatEngineSelector />
              <ChatModelSelector />
            </div>
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 overflow-y-auto py-6 md:gap-10">
              <HomeHero variant="site" />
              <HomeWorkflowGuideCards onSend={handleHubSend} />
              {/* <HomeOfficialWorkflowCards onSend={handleHubSend} /> */}
            </div>
          </>
        )}
      </div>
      <div className="sticky z-10 shrink-0 bg-[var(--sto-page-bg)] pt-6 dark:bg-background">
        <HomeAssistant
          seedText={seedText}
          onSend={handleHubSend}
          placeholderKey="site.assistant.placeholder"
        />
      </div>
    </div>
  );
}
