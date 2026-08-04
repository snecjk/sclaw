/**
 * 首页 Agent Hub 静态卡片配置：头像池、图标样式、降级卡片数据。
 */
import { FileText, Rocket, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  homeHubCardShellClass,
  homeHubCardTitleClass,
  homeHubCardDescClass,
} from './home-hub-surface-styles';
import avatar01 from '@/assets/avatars/avatar-01.png.png';
import avatar02 from '@/assets/avatars/avatar-02.png.png';
import avatar03 from '@/assets/avatars/avatar-03.png.png';
import avatar04 from '@/assets/avatars/avatar-04.png.png';
import avatar05 from '@/assets/avatars/avatar-05.png.png';
import avatar06 from '@/assets/avatars/avatar-06.png.png';

/** 头像池（与 RecommendCard 共用） */
const AVATAR_POOL = [avatar01, avatar02, avatar03, avatar04, avatar05, avatar06] as const;

export function pickThreeAvatars(seed: string): readonly [string, string, string] {
  const arr = [...AVATAR_POOL];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ i, 16777619);
    const j = (h >>> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return [arr[0], arr[1], arr[2]] as const;
}

export function AvatarStack({ urls }: { urls: readonly [string, string, string] }) {
  return (
    <div className="flex shrink-0 -space-x-2" aria-hidden>
      {urls.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[#E5E6EB] dark:border-card dark:ring-border"
        />
      ))}
    </div>
  );
}

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

/** 静态降级卡片组：无推荐位数据时展示 */
export function StaticFallbackCards() {
  const { t } = useTranslation('home');
  return AGENT_HUB_CARDS.map(({ icon: Icon, iconWrapClass, titleKey, descKey }) => (
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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={homeHubCardTitleClass}>{t(titleKey)}</h3>
          </div>
          <p className={cn('mt-1.5', homeHubCardDescClass)}>{t(descKey)}</p>
        </div>
      </div>
    </div>
  ));
}
