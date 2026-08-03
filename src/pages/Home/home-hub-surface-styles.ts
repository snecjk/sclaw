/**
 * 总部首页中间区 + 卡片壳视觉 token（网点 / 省区首页与之对齐）。
 * 来源：MasterGo 总部首页 layer 2:20112 + HomeAgentHubSurface 阶段 1 落地值。
 */
import { cn } from '@/lib/utils';

export const homeHubTextPrimary = 'text-[#1D2129] dark:text-foreground';

export const homeHubTextSecondary = 'text-[#4E5969] dark:text-muted-foreground';

/** MasterGo 卡片壳：r18、白底、0.5 浅描边；暗色用 secondary 与主卡片底色分层 */
export const homeHubCardShellClass = cn(
  'box-border flex flex-col items-start gap-3 rounded-[18px] border-[0.5px] border-[#E5E6EB] bg-white p-[18px]',
  'dark:border-border dark:bg-secondary',
);

/** 可点击卡片：精简标题+描述；h-full 使 grid 同行等高，设计稿高 106 */
export const homeHubInteractiveCardShellClass = cn(
  homeHubCardShellClass,
  'relative h-full min-h-[106px] min-w-0 w-full overflow-hidden text-left transition-colors duration-base hover:border-[#C9CDD4]',
);

export const homeHubCardTitleClass = cn('text-[13px] font-medium leading-normal', homeHubTextPrimary);

export const homeHubCardDescClass = cn('text-xs font-normal leading-5', homeHubTextSecondary);

/**
 * 卡片区滚动壳：高度随内容收缩；超出可用高度后再内部滚动。
 * 用 100cqh（相对 home-hub-main-scroll-host）扣掉 Hero/间距，勿用 flex-1，
 * 否则卡片少时会被撑满整块空白。
 */
export const homeHubCardScrollClass =
  'w-full max-h-[calc(100cqh-12.5rem)] overflow-y-auto overscroll-y-contain';

/** 能力卡片网格（设计稿一行多卡） */
export const homeHubCardGridClass =
  'grid w-full items-stretch content-start gap-3 sm:grid-cols-2 lg:grid-cols-4';

/** 首页 Hero / 卡片 / 输入区共用最大宽（与 --sto-hero-input-max-w 同源，当前 780px） */
export const homeHubContentMaxWidthClass =
  'mx-auto w-full min-w-0 max-w-[var(--sto-hero-input-max-w)]';

/** 首页主列容器：供 container query 判断中间区高度（矮屏顶对齐 / 高屏居中 Hero） */
export const homeHubMainScrollHostClass =
  'home-hub-main-scroll-host flex min-h-0 flex-1 flex-col overflow-hidden';

/**
 * Hero + 卡片列：与底部输入同宽居中。
 * overflow-hidden：滚动交给卡片滚动壳，避免嵌套滚动导致“滚不动”。
 */
export const homeHubMainScrollClass = cn(
  homeHubContentMaxWidthClass,
  'home-hub-main-scroll flex min-h-0 flex-1 flex-col justify-start gap-10 overflow-hidden pb-6 pt-4 sm:pt-6',
);

/** 底部输入 + 免责区外壳（底边距与对话列一致，仅依赖 MainLayout body pb-5） */
export const homeHubFooterShellClass =
  'shrink-0 px-4 pb-0 pt-4 sm:px-6';

/**
 * Home full-bleed 后，落地态恢复原 MainCardBody 20px + Home index px-1/sm:px-2。
 * 与内层 px-4/sm:px-6 叠加后对齐改版前卡片边缘 inset。
 */
export const homeHubLandingOuterInsetClass =
  'px-[calc(var(--sto-content-pad-x)+0.25rem)] sm:px-[calc(var(--sto-content-pad-x)+0.5rem)]';

/** MasterGo font_2:6551 + Grey-5 底部免责 */
export const homeHubFooterDisclaimerClass =
  'text-xs font-normal leading-[14px] text-[#C9CDD4] dark:text-muted-foreground';
