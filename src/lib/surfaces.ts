import { cn } from '@/lib/utils';

/** Page section surface (Models page, Settings proxy, etc.) — glass gradient + blur */
export const glassSectionSurface = cn(
  'rounded-2xl border border-border p-6',
  'bg-[linear-gradient(165deg,rgba(255,255,255,0.96),rgba(255,255,255,0.88)),linear-gradient(165deg,hsl(var(--glass-bg)/0.75),hsl(var(--glass-bg)/0.58))]',
  'backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)]',
  'shadow-[0_2px_16px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.55)]',
  'dark:border-border dark:bg-[linear-gradient(165deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04)),linear-gradient(165deg,hsl(var(--glass-bg)/0.58),hsl(var(--glass-bg)/0.42))]',
  'dark:shadow-[0_4px_28px_rgba(0,0,0,0.22),inset_0_1px_0_hsl(var(--glass-highlight)/0.08)]',
);

/** Chat assistant bubbles/cards: light = soft white; dark = neutral muted/card（与用户侧主色气泡区分） */
export const assistantChatCardBg = cn(
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(255,255,255,0.86))]',
  'dark:bg-[linear-gradient(180deg,hsl(var(--muted)/0.95),hsl(var(--card)/0.98))]',
);

export const assistantChatCardBgStreaming = cn(
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.88))]',
  'dark:bg-[linear-gradient(180deg,hsl(var(--muted)),hsl(var(--card)))]',
);

/**
 * 铺在 {@link glassSectionSurface} 上的卡片/列表行（浅色）：冷白 + 内高光，避免多层 glass-bg 半透明叠出发灰发黄；
 * 深色：保持原有 glass 层次。
 */
export const glassNestedCard = cn(
  'bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]',
  'dark:bg-[hsl(var(--glass-bg)/0.12)] dark:shadow-[inset_0_1px_0_hsl(var(--glass-highlight)/0.06)]',
);

/**
 * 再内一层的列表行、账号行等（浅色）：`card` 令牌 + 细描边 + 轻外阴影；
 * 深色：半透明 glass。
 */
export const glassNestedInsetRow = cn(
  'border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
  'dark:border-white/10 dark:bg-[hsl(var(--glass-bg)/0.08)] dark:shadow-none',
);

/** 分段开关轨道（如用量筛选）：浅色不用 glass 渐变底，避免发污 */
export const glassSegmentTrack = cn(
  'flex rounded-md border border-border p-0.5',
  'bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]',
  'dark:bg-[linear-gradient(180deg,hsl(var(--glass-bg)/0.55),hsl(var(--glass-bg)/0.35))] dark:shadow-[inset_0_1px_0_hsl(var(--glass-highlight)/0.12)]',
);
