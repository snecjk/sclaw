/**
 * 首页 Agent Hub 静态降级卡片（无推荐位数据时展示）。
 */
import { FileText, Rocket, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  homeHubCardShellClass,
  homeHubCardTitleClass,
  homeHubCardDescClass,
  homeHubFallbackCardGridClass,
} from './home-hub-surface-styles';

/** MasterGo paint_2:27513 — 任务处理卡图标底 */
const CARD_ICON_WRAP_TASKS =
  'bg-[rgba(189,243,207,0.5)] text-[#1D2129] dark:text-foreground';
/** MasterGo paint_2:21494 — 持续执行卡图标底 */
const CARD_ICON_WRAP_EXEC =
  'bg-[rgba(214,200,199,0.25)] text-[#1D2129] dark:text-foreground';
/** MasterGo paint_2:27541 — 多智能体卡图标底 */
const CARD_ICON_WRAP_MULTI =
  'bg-[rgba(255,232,193,0.25)] text-[#1D2129] dark:text-foreground';

export const AGENT_HUB_CARDS: ReadonlyArray<{
  icon: LucideIcon;
  iconWrapClass: string;
  titleKey: 'agentHub.cardTasksTitle' | 'agentHub.cardExecTitle' | 'agentHub.cardMultiTitle';
  descKey: 'agentHub.cardTasksDesc' | 'agentHub.cardExecDesc' | 'agentHub.cardMultiDesc';
}> = [
  {
    icon: Rocket,
    iconWrapClass: CARD_ICON_WRAP_TASKS,
    titleKey: 'agentHub.cardTasksTitle',
    descKey: 'agentHub.cardTasksDesc',
  },
  {
    icon: FileText,
    iconWrapClass: CARD_ICON_WRAP_EXEC,
    titleKey: 'agentHub.cardExecTitle',
    descKey: 'agentHub.cardExecDesc',
  },
  {
    icon: Waypoints,
    iconWrapClass: CARD_ICON_WRAP_MULTI,
    titleKey: 'agentHub.cardMultiTitle',
    descKey: 'agentHub.cardMultiDesc',
  },
];

/** 静态降级卡片组：无推荐位数据时展示（一行三卡） */
export function StaticFallbackCards() {
  const { t } = useTranslation('home');
  return (
    <div className={homeHubFallbackCardGridClass}>
      {AGENT_HUB_CARDS.map(({ icon: Icon, iconWrapClass, titleKey, descKey }) => (
        <div key={titleKey} className={homeHubCardShellClass}>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                iconWrapClass,
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <h3 className={homeHubCardTitleClass}>{t(titleKey)}</h3>
              <p className={cn('mt-1.5', homeHubCardDescClass)}>{t(descKey)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
