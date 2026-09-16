import { cn } from '@/lib/utils';
import type { ChannelType } from '@/types/channel';

/** 各频道品牌色：绑定成功后图标点亮用 */
export const CHANNEL_BRAND_COLOR: Record<ChannelType, string> = {
  dingtalk: '#0089FF',
  wechat: '#07C160',
};

/** 移动端 App 品牌色（小龙虾橙） */
export const MOBILE_APP_BRAND_COLOR = '#FF6A00';

export const inlineSelectTriggerClass = cn(
  'flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-[#E5E6EB] bg-white px-2.5 text-left text-[12px] font-medium text-[#1D2129]',
  'shadow-none outline-none transition-colors hover:bg-[#F7F8FA]',
  'focus-visible:ring-2 focus-visible:ring-ring/30',
  'dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]',
);

export const inlineSelectMenuClass = cn(
  'z-50 rounded-[8px] border border-[#E5E6EB] bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]',
  'dark:border-border dark:bg-card',
);

/** 频道行图标按钮：中性悬停底，与删除成组时用 gap-0.5 */
export const channelIconBtnClass = cn(
  'h-8 w-8 shrink-0 rounded-md text-[#86909C] shadow-none',
  'hover:bg-[#F2F3F5] hover:text-[#1D2129]',
  'dark:text-muted-foreground dark:hover:bg-white/[0.08] dark:hover:text-foreground',
);

export const channelDeleteIconBtnClass = cn(
  'h-8 w-8 shrink-0 rounded-md text-[#86909C] shadow-none',
  'hover:bg-destructive/10 hover:text-destructive',
  'dark:text-muted-foreground',
);

export const channelOutlineBtnClass =
  'h-8 shrink-0 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]';

export const channelBindOutlineBtnClass =
  'h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[12px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]';
