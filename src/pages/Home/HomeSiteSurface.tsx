/**
 * 网点用户首页：Hero + 工作流引导卡片 + 底部助手输入（布局与总部首页对齐）。
 */
import { HomeHero } from './HomeHero';
// import { HomeOfficialWorkflowCards } from './HomeOfficialWorkflowCards';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeConversationActive } from './use-home-conversation-active';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { homeHubFooterShellClass, homeHubMainScrollClass, homeHubMainScrollHostClass } from './home-hub-surface-styles';
import { HomeWorkflowGuideCards } from './HomeWorkflowGuideCards';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';

export function HomeSiteSurface({ seedText, seedSkillSlug }: { seedText?: string; seedSkillSlug?: string }) {
  const showConversation = useHomeConversationActive();
  const { isSplitGridPassthrough, splitGridPassthroughClass } =
    useSplitGridPassthroughClass(showConversation);
  const { handleHubSend } = useHomeChatEntrySend();

  return (
    <div
      className={cn(
        isSplitGridPassthrough
          ? splitGridPassthroughClass
          : 'mx-auto flex h-full min-h-0 w-full flex-1 flex-col',
      )}
    >
      <div
        className={cn(
          isSplitGridPassthrough
            ? splitGridPassthroughClass
            : 'flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-6',
        )}
      >
        {showConversation ? (
          <HomeMainConversation
            className="min-h-0 flex-1"
            seedText={seedText}
            seedSkillSlug={seedSkillSlug}
            onSend={handleHubSend}
          />
        ) : (
          <div className={homeHubMainScrollHostClass}>
            <div className={homeHubMainScrollClass}>
              <HomeHero variant="site" />
              <HomeWorkflowGuideCards onSend={handleHubSend} />
              {/* <HomeOfficialWorkflowCards onSend={handleHubSend} /> */}
            </div>
          </div>
        )}
      </div>
      {!showConversation ? (
        <div className={homeHubFooterShellClass}>
          <HomeComposer
            seedText={seedText}
            seedSkillSlug={seedSkillSlug}
            onSend={handleHubSend}
            placeholderKey="site.assistant.placeholder"
          />
        </div>
      ) : null}
    </div>
  );
}
