/**
 * 总部首页中间区 + 卡片壳视觉 token（网点 / 省区首页与之对齐）。
 * 来源：MasterGo 总部首页 layer 2:20112 + HomeAgentHubSurface 阶段 1 落地值。
 */
import { cn } from '@/lib/utils';

export const homeHubTextPrimary = 'text-[#1D2129] dark:text-foreground';

export const homeHubTextSecondary = 'text-[#86909C] dark:text-muted-foreground';

/** MasterGo 卡片壳：r18、白底、shadow-glow，设计稿无描边；暗色用 secondary 与主卡片底色分层 */
export const homeHubCardShellClass = cn(
  'flex flex-col rounded-[18px] bg-card p-4 shadow-glow',
  'dark:bg-secondary dark:shadow-soft',
);

/** 可点击卡片（工作流 / 经营管理卡）在统一壳层上保留 hover；h-full 使 grid 同行等高、底栏对齐 */
export const homeHubInteractiveCardShellClass = cn(
  homeHubCardShellClass,
  'relative h-full min-h-0 min-w-0 w-full overflow-hidden text-left transition-shadow duration-base hover:shadow-soft',
);

/** MasterGo Overlay「功能」标签 */
export const homeHubCardTagClass =
  'rounded-md bg-[rgba(136,188,157,0.16)] px-1.5 py-[3px] text-xs font-medium leading-[14px] text-[#5F9274]';

export const homeHubCardTitleClass = cn('text-sm font-medium leading-[18px]', homeHubTextPrimary);

export const homeHubCardDescClass = cn('text-xs leading-[18px]', homeHubTextSecondary);

export const homeHubCardGridClass = 'grid w-full items-stretch gap-4 sm:grid-cols-3';

/** 卡片中间区：占据剩余高度，把底栏顶到底部 */
export const homeHubCardBodyRegionClass = 'mt-5 min-h-[4.5rem] flex-1';

/** 卡片底栏（头像 + 团队名 + CTA），同行卡片底部对齐 */
export const homeHubCardFooterRegionClass =
  'flex min-h-[30px] shrink-0 items-center gap-3 border-t border-[#E5E6EB] pt-4 dark:border-border';

/** 首页 Hero / 卡片 / 输入区共用最大宽（与 --sto-hero-input-max-w 同源，当前 780px） */
export const homeHubContentMaxWidthClass =
  'mx-auto w-full min-w-0 max-w-[var(--sto-hero-input-max-w)]';

/** 首页主列容器：供 container query 判断中间区高度（矮屏顶对齐 / 高屏居中 Hero） */
export const homeHubMainScrollHostClass =
  'home-hub-main-scroll-host flex min-h-0 flex-1 flex-col overflow-hidden';

/** Hero + 卡片主滚动区（与底部输入框同宽居中；对齐策略见 globals.css @container home-hub-main） */
export const homeHubMainScrollClass = cn(
  homeHubContentMaxWidthClass,
  'home-hub-main-scroll flex min-h-0 flex-1 flex-col justify-start gap-10 overflow-y-auto overscroll-y-contain pb-6 pt-4 sm:pt-6',
);

/** 底部输入 + 免责区外壳（底边距与对话列一致，仅依赖 MainLayout body pb-5） */
export const homeHubFooterShellClass =
  'shrink-0 px-4 pb-0 pt-4 sm:px-6';

/** MasterGo font_2:6551 + Grey-5 底部免责 */
export const homeHubFooterDisclaimerClass =
  'text-xs font-normal leading-[14px] text-[#C9CDD4] dark:text-muted-foreground';
