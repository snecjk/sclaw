/**
 * 总部首页中间区 + 卡片壳视觉 token（网点 / 省区首页与之对齐）。
 * 来源：MasterGo 总部首页 layer 2:20112 + HomeAgentHubSurface 阶段 1 落地值。
 */
import { cn } from '@/lib/utils';

export const homeHubTextPrimary = 'text-[#1D2129] dark:text-foreground';

export const homeHubTextSecondary = 'text-[#86909C] dark:text-muted-foreground';

/** MasterGo 卡片壳：r18、白底、shadow-glow，设计稿无描边 */
export const homeHubCardShellClass = 'flex flex-col rounded-[18px] bg-card p-4 shadow-glow';

/** 可点击卡片（工作流 / 经营管理卡）在统一壳层上保留 hover */
export const homeHubInteractiveCardShellClass = cn(
  homeHubCardShellClass,
  'relative min-h-0 min-w-0 w-full overflow-hidden text-left transition-shadow duration-base hover:shadow-soft',
);

/** MasterGo Overlay「功能」标签 */
export const homeHubCardTagClass =
  'rounded-md bg-[rgba(136,188,157,0.16)] px-1.5 py-[3px] text-xs font-medium leading-[14px] text-[#5F9274]';

export const homeHubCardTitleClass = cn('text-sm font-medium leading-[18px]', homeHubTextPrimary);

export const homeHubCardDescClass = cn('text-xs leading-[18px]', homeHubTextSecondary);

export const homeHubCardGridClass = 'grid w-full gap-4 sm:grid-cols-3';

/** Hero + 卡片主滚动区（max-w 960 居中） */
export const homeHubMainScrollClass =
  'mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col justify-center gap-10 overflow-y-auto overscroll-y-contain pb-6';

/** 底部输入 + 免责区外壳 */
export const homeHubFooterShellClass =
  'shrink-0 bg-[var(--sto-page-bg)] px-4 pb-4 pt-4 sm:px-6 dark:bg-background';

/** MasterGo font_2:6551 + Grey-5 底部免责 */
export const homeHubFooterDisclaimerClass =
  'text-xs font-normal leading-[14px] text-[#C9CDD4] dark:text-muted-foreground';
