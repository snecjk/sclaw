/**
 * 网点用户首页：Hero + 工作流引导卡片 + 底部助手输入（布局与总部首页对齐）。
 */
import { HomeHero } from './HomeHero';
import { HomeOfficialWorkflowCards } from './HomeOfficialWorkflowCards';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeConversationActive } from './use-home-conversation-active';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { homeHubFooterShellClass, homeHubMainScrollClass } from './home-hub-surface-styles';

export function HomeSiteSurface({ seedText }: { seedText?: string }) {
  const showConversation = useHomeConversationActive();
  const { handleHubSend } = useHomeChatEntrySend();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-6">
        {showConversation ? (
          <HomeMainConversation
            className="min-h-0 flex-1"
            seedText={seedText}
            onSend={handleHubSend}
          />
        ) : (
          <div className={homeHubMainScrollClass}>
            <HomeHero variant="site" />
            <HomeOfficialWorkflowCards onSend={handleHubSend} />
          </div>
        )}
      </div>
      {!showConversation ? (
        <div className={homeHubFooterShellClass}>
          <HomeComposer
            seedText={seedText}
            onSend={handleHubSend}
            placeholderKey="site.assistant.placeholder"
          />
        </div>
      ) : null}
    </div>
  );
}
