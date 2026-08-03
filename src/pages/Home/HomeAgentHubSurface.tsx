/**
 * 首页 Agent Hub Surface：Hero + 能力卡片 + 底部输入。
 * 有推荐位数据时展示推荐卡片，无数据时降级展示静态 AGENT_HUB_CARDS。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';
import { HomeHero } from './HomeHero';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { useHomeConversationActive } from './use-home-conversation-active';
import { HomeComposer } from './HomeComposer';
import { RecommendCardSkeletonGrid } from './RecommendCardSkeleton';
import { RecommendCard } from './RecommendCard';
import { RecommendCategoryTabs } from './RecommendCategoryTabs';
import { useHomeRecommendSkillStatus } from './use-home-recommend-skill-status';
import { StaticFallbackCards } from './agent-hub-static-cards';
import { useRecommendItems } from '@/hooks/use-recommend-items';
import { RECOMMEND_POSITION_KEYS, type RecommendItem } from '@/lib/recommend-api';
import { navigateToNewSessionWithPrompt } from '@/lib/main-chat-navigation';
import { workflowSessionTitle } from '@/lib/workflow-session';
import { useLatestWorkflowsByTemplates } from '@/hooks/use-latest-workflows-by-templates';
import {
  homeHubCardGridClass,
  homeHubCardScrollClass,
  homeHubFooterShellClass,
  homeHubLandingOuterInsetClass,
  homeHubMainScrollClass,
  homeHubMainScrollHostClass,
} from './home-hub-surface-styles';

export function HomeAgentHubSurface({ seedText, seedSkillSlug }: { seedText?: string; seedSkillSlug?: string }) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const showConversation = useHomeConversationActive();
  const { isSplitGridPassthrough, splitGridPassthroughClass } =
    useSplitGridPassthroughClass(showConversation);

  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();

  const {
    items: recommendItems,
    categories: recommendCategories,
    loading: recommendLoading,
    refetch: refetchRecommend,
  } = useRecommendItems(RECOMMEND_POSITION_KEYS.HOME_CARD);

  const [activeCategory, setActiveCategory] = useState('');

  const { skillStatusMap, loading: skillStatusLoading, refreshingSlugs, handleRefresh: handleSkillStatusRefresh } = useHomeRecommendSkillStatus(recommendItems);

  // 批量查询各模版当前用户最近实例：有实例的模版项替换为实例项（保留推荐位策划的标题/描述/图标，
  // 仅将 item_type/item_ref_id 指向实例），点击分发逻辑保持不变。
  const templateIds = useMemo(
    () => recommendItems.filter((i) => i.item_type === 'workflow_template').map((i) => i.item_ref_id),
    [recommendItems],
  );
  const { data: latestByTemplate, loading: latestLoading, refetch: refetchLatest } = useLatestWorkflowsByTemplates(templateIds);

  // 从会话切回首页落地态时刷新推荐位与各模版最近实例。
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (showConversation) return;
    void refetchRecommend();
    void refetchLatest();
  }, [showConversation, refetchRecommend, refetchLatest]);

  // 默认选中首个类别；列表变化后若当前选中失效则回退到首个
  useEffect(() => {
    if (recommendCategories.length === 0) {
      setActiveCategory('');
      return;
    }
    if (!recommendCategories.some((c) => c.code === activeCategory)) {
      setActiveCategory(recommendCategories[0].code);
    }
  }, [recommendCategories, activeCategory]);

  // displayItems：模版项存在实例时替换为实例项；key 始终用原始模版 id 以保证 refetch 后稳定 reconcile。
  const displayItems = useMemo(() => {
    return recommendItems.map((item) => {
      if (item.item_type !== 'workflow_template') return { key: item.item_ref_id, item };
      const latest = latestByTemplate.get(item.item_ref_id) ?? null;
      if (!latest) return { key: item.item_ref_id, item };
      const replaced: RecommendItem = {
        ...item,
        item_type: 'workflow_instance',
        item_ref_id: latest.id,
        title: latest.name || item.title,
        description: latest.description ?? item.description,
      };
      return { key: item.item_ref_id, item: replaced };
    });
  }, [recommendItems, latestByTemplate]);

  // 按选中类别的 code 与条目 recommend_category 精确匹配
  const filteredItems = useMemo(() => {
    if (!activeCategory) return [];
    return displayItems.filter(
      ({ item }) => (item.recommend_category || '').trim() === activeCategory,
    );
  }, [displayItems, activeCategory]);

  /** 推荐卡片点击：按 item_type 分发（技能点击在 RecommendCard 内部处理） */
  const handleRecommendClick = (item: RecommendItem) => {
    if (item.item_type === 'skill') {
      return;
    }

    if (item.item_type === 'prompt') {
      const text = (item.content || item.title || '').trim();
      if (!text) return;
      navigateToNewSessionWithPrompt(navigate, '/home', text, {
        sessionTitle: item.title || undefined,
      });
      return;
    }

    if (item.item_type === 'workflow_instance') {
      // 工作流实例：立即运行（复用"我的工作流"的立即运行逻辑）
      navigateToNewSessionWithPrompt(
        navigate,
        '/home',
        `帮我执行 id 为：${item.item_ref_id} 的工作流 【${item.title}】`,
        {
          workflowRun: true,
          workflowEngine: 'claude',
          workflowSession: {
            workflowId: item.item_ref_id,
            engineType: 'claude',
            sessionTitle: workflowSessionTitle(item.title, 'claude'),
          },
        },
      );
    } else if (item.item_type === 'workflow_template') {
      // 工作流模版：安装（参考官方推荐模版的安装逻辑）
      navigateToNewSessionWithPrompt(
        navigate,
        '/home',
        `/${item.title}`,
        { extraSearchParams: { workflowId: item.item_ref_id } },
      );
    }
  };

  return (
    <div
      className={cn(
        isSplitGridPassthrough ? splitGridPassthroughClass : 'flex min-h-0 flex-1 flex-col',
        !isSplitGridPassthrough && !showConversation && homeHubLandingOuterInsetClass,
      )}
    >
      <div
        className={cn(
          isSplitGridPassthrough
            ? splitGridPassthroughClass
            : showConversation
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
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
              <HomeHero className="shrink-0" />

              <div className={homeHubCardScrollClass}>
                {!recommendLoading && recommendItems.length > 0 ? (
                  <RecommendCategoryTabs
                    categories={recommendCategories}
                    value={activeCategory}
                    onChange={setActiveCategory}
                  />
                ) : null}
                <div className={homeHubCardGridClass}>
                  {recommendLoading || latestLoading ? (
                    <RecommendCardSkeletonGrid />
                  ) : recommendItems.length > 0 ? (
                    filteredItems.length > 0 ? (
                      filteredItems.map(({ key, item }) => {
                        const skillSlug = item.skill_slug || item.item_ref_id;
                        return (
                          <RecommendCard
                            key={key}
                            item={item}
                            onClick={() => handleRecommendClick(item)}
                            onSkillInstalled={() => {
                              handleSkillStatusRefresh(skillSlug);
                            }}
                            skillStatus={item.item_type === 'skill' ? skillStatusMap[skillSlug] : undefined}
                            skillStatusLoading={item.item_type === 'skill' ? (skillStatusLoading || refreshingSlugs.has(skillSlug)) : false}
                          />
                        );
                      })
                    ) : (
                      <div className="col-span-full flex min-h-[88px] items-center justify-center text-sm text-[#86909C] dark:text-muted-foreground">
                        {t('homeRecommend.emptyCategory', '该分类暂无推荐')}
                      </div>
                    )
                  ) : (
                    <StaticFallbackCards />
                  )}
                </div>
              </div>
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
            onQueue={handleHubQueue}
            showProjectPicker
          />
        </div>
      ) : null}
    </div>
  );
}
