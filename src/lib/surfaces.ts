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

/** 任务子项聊天：与省区 MainLayout 白卡片 {@link stoMainCardShellClass} 同色，避免输入框下方露出 gutter 灰 */
export const stoTaskSubitemChatCanvasBg = cn(
  'bg-[var(--sto-main-card-bg)]',
  'dark:bg-background',
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

/** 首页对话/消息阅读区最大宽（780px） */
export const stoChatShellHomeClass = 'mx-auto w-full min-w-0 max-w-[780px]';

/** 非首页对话/内容区最大宽（862px） */
export const stoChatShellPageClass = 'mx-auto w-full min-w-0 max-w-[862px]';

/**
 * 非首页主内容区：最大 862px（与 {@link stoChatShellPageClass} 同源），窗口变宽时两侧留白。
 * @see .cursor/rules/02-styles.mdc §响应式
 */
export const stoMainInnerShell = stoChatShellPageClass;

/**
 * 列表页主标题（MasterGo：24px / 行高 30px / Semibold / 字间距 0 / #1A1A1A）
 * 用于：我的任务、定时任务（云/本地）、技能广场
 */
export const stoPageTitleClass =
  'm-0 text-2xl font-semibold leading-[30px] tracking-normal text-[#1A1A1A] dark:text-foreground';

/**
 * 我的任务页标题行：标题与右侧操作同一高度对齐。
 */
export const myTaskPageHeaderRowClass = 'flex min-w-0 items-center justify-between gap-4';

/**
 * 我的任务页「新建定时任务」：Grey-4（border）底 + Grey-10 文字 + 10px 圆角。
 */
export const myTaskCreateButtonClass = cn(
  'inline-flex shrink-0 items-center gap-1.5 h-[34px] px-3.5 text-sm font-medium',
  'rounded-[10px] bg-border text-foreground',
  'transition-colors duration-fast hover:bg-black/[0.04] active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 我的任务卡片外框（MasterGo 容器 7377）：18px 圆角 + 16px 内距 + glow，无描边；等高网格内 h-full */
export const myTaskCardShellClass = cn(
  'relative flex h-full min-w-0 flex-col rounded-[18px] bg-card p-4 shadow-glow',
  'transition-[box-shadow] duration-base hover:shadow-soft',
);

/** 我的任务卡片顶栏：开关左、更多右（与开关同高，保证开关→标题 18px） */
export const myTaskCardTopRowClass = 'flex shrink-0 items-start justify-between gap-3';

/** 我的任务卡片标题区：距顶栏开关 18px；标题与描述间距 6px */
export const myTaskCardBodyClass = 'mt-[18px] flex shrink-0 flex-col gap-1.5';

/** 详情与底栏之间的弹性占位：最小 18px；同行卡片等高时多余高度落在此处 */
export const myTaskCardDetailFooterGapClass = 'min-h-[18px] flex-1';

/** 我的任务卡片标题：14px / 行高 18 / Medium */
export const myTaskCardTitleClass = 'm-0 text-sm font-medium leading-[18px] text-foreground';

/** 我的任务卡片描述：12px / 行高 18 / 两行截断 */
export const myTaskCardDescriptionClass =
  'm-0 line-clamp-2 text-xs leading-[18px] text-muted-foreground';

/** 我的任务卡片底栏：计划时间左、下次执行右；贴壳层底部，与卡片底边固定 16px（壳层 p-4） */
export const myTaskCardFooterClass =
  'flex shrink-0 items-center justify-between gap-3';

/** 我的任务卡片计划时间行 */
export const myTaskCardScheduleRowClass =
  'inline-flex min-w-0 items-center gap-1 text-xs leading-[14px] text-foreground/80';

/** 我的任务卡片下次执行文案 */
export const myTaskCardNextRunClass = 'shrink-0 text-xs leading-[14px] text-muted-foreground';

/** 我的任务卡片更多菜单（图2） */
export const myTaskCardMenuClass = cn(
  'absolute right-0 top-full z-10 mt-1.5 min-w-[120px] rounded-[18px] border border-border bg-card p-1.5',
  'shadow-modal',
);

/** 我的任务卡片菜单项 */
export function myTaskCardMenuItemClass(isDestructive = false): string {
  return cn(
    'flex w-full items-center rounded-[10px] px-3 py-2 text-left text-sm transition-colors duration-fast',
    isDestructive ? 'text-destructive hover:bg-muted' : 'text-foreground hover:bg-muted',
  );
}

/** 首页对话整列（toolbar + 消息 + 输入同宽居中，最大 780px） */
export const stoChatShellHomeColumnClass = cn(
  stoChatShellHomeClass,
  'flex min-h-0 flex-1 flex-col',
);

/** 非首页对话整列（toolbar + 消息 + 输入同宽居中，最大 862px） */
export const stoChatShellPageColumnClass = cn(
  stoChatShellPageClass,
  'flex min-h-0 flex-1 flex-col',
);

/** 三栏对话区卡片（MasterGo 矩形 2498：18px 圆角 + #F7F8FA + shadow-glow） */
export const stoSplitChatCardClass = cn(
  'min-h-0 min-w-0 overflow-hidden rounded-[18px] bg-[var(--sto-main-card-bg)] shadow-glow',
);

/** 三栏模式：左栏卡片外层（贴满分割面板；内层对话仍用 page/home 限宽壳） */
export const stoSplitChatPaneCardWrapClass = cn(
  stoSplitChatCardClass,
  'flex min-h-0 min-w-0 flex-1 flex-col items-center',
);

export type StoChatColumnVariant = 'page' | 'home';

/**
 * 对话列壳：toolbar + 消息 + 输入同宽居中。
 * 双栏 / 三栏均相同限宽（page 862px / home 780px），不随浏览器无限变宽。
 */
export function stoChatColumnShellClass(variant: StoChatColumnVariant): string {
  return variant === 'home' ? stoChatShellHomeColumnClass : stoChatShellPageColumnClass;
}

/**
 * 对话列完整 class：Chat / 任务子项 / 首页会话共用。
 * 三栏时外层卡片 items-center，此处 self-center 防止 flex stretch 撑破 max-w。
 */
export function stoChatColumnClass(variant: StoChatColumnVariant, isSplit = false): string {
  return cn(
    stoChatColumnShellClass(variant),
    'px-6',
    isSplit && 'self-center',
  );
}

/** 三栏左栏内容外包：split 时加卡片壳，否则仅占满 pane（均 items-center 居中限宽轨） */
export function stoSplitChatPaneContentWrapClass(isSplit: boolean): string {
  return isSplit
    ? stoSplitChatPaneCardWrapClass
    : 'flex min-h-0 min-w-0 flex-1 flex-col items-center';
}

/**
 * 三栏模式外层 row（Chat / 任务子项 / 首页会话共用）。
 * 配合 {@link stoMainCardBodySplitClass}（body px-0）：左/右 inset 与 ContentHeader 同一套 CSS 变量。
 */
export const stoSplitRowInsetsClass = cn(
  'box-border gap-2 py-2',
  'pl-[var(--sto-content-header-pad-start)]',
  '-mr-[var(--sto-main-scrollbar-gutter)]',
  'pr-[var(--sto-content-header-pad-end)]',
);

/** ParameterFormDock layout（与对话列 variant 一致） */
export function stoParameterFormDockLayout(variant: StoChatColumnVariant): 'home' | 'page' {
  return variant === 'home' ? 'home' : 'page';
}

/** Hero / 大输入复合框壳层（固定 780px 居中） */
export const stoHeroInputShellClass =
  'mx-auto flex w-[var(--sto-hero-input-max-w)] max-w-full min-w-0 flex-col';

/** 三栏模式：对话区（最小占比 30%） */
export const stoSplitChatPaneClass = 'relative flex min-h-0 min-w-[var(--sto-split-min-chat)] flex-1 flex-col';

/** 三栏模式：预览区（默认/最大 70% 由 width 百分比控制） */
export const stoSplitPreviewPaneClass =
  'flex h-full min-h-0 max-w-[var(--sto-split-max-preview)] shrink-0 flex-col overflow-hidden [contain:inline-size]';

/** 三栏预览区产物内容壳（描边在 tab 行下方，不含 tab） */
export const stoPreviewContentShellClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-border',
  'bg-[var(--sto-main-card-bg)] shadow-glow',
);

/** @deprecated 整卡描边已拆至 {@link stoPreviewContentShellClass}，tab 行在外 */
export const stoSplitPreviewCardClass = stoPreviewContentShellClass;

/** @deprecated tab 已迁至 ContentHeader */
export const stoPreviewTabRowClass = cn(
  'flex shrink-0 items-center gap-2 pb-2 pl-4 pr-4 pt-0',
);

/** 预览产物 tab pill（选中 #E5E6EB / 未选 #F5F6F7） */
export function stoPreviewArtifactTabClass(isActive: boolean): string {
  return cn(
    'inline-flex h-[30px] max-w-[143px] shrink-0 items-center gap-1 rounded-[10px] px-2 text-sm leading-[18px] transition-colors duration-fast',
    isActive
      ? 'bg-border text-foreground'
      : 'bg-[#F5F6F7] text-foreground hover:bg-muted',
  );
}

/** 预览操作行（标题 + 元信息 + 图标按钮） */
export const stoPreviewActionRowClass = cn(
  'flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3',
);

/** 预览操作行图标按钮（30×30，圆角 7px） */
export const stoPreviewActionButtonClass = cn(
  'inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-muted-foreground transition-colors duration-fast',
  'hover:bg-black/[0.04] hover:text-foreground',
);

/** 三栏拖拽分隔条 */
export const stoSplitResizerClass = cn(
  'relative z-20 flex h-full w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent transition-colors duration-fast',
  'hover:bg-primary/20',
);

export const stoSplitResizerActiveClass = 'bg-primary/40';

/** 三栏预览区宽度占比下限 / 默认 / 上限（对话区对应 70%–50%–30%） */
export const STO_PREVIEW_SPLIT_MIN = 30;
export const STO_PREVIEW_SPLIT_DEFAULT = 50;
export const STO_PREVIEW_SPLIT_MAX = 70;

/** 三栏预览区分割：预览区宽度占容器百分比，限制在 30%–70% */
export function clampPreviewPanelPercent(containerWidth: number, previewPx: number): number {
  if (containerWidth <= 0) return STO_PREVIEW_SPLIT_DEFAULT;
  const pct = (previewPx / containerWidth) * 100;
  return Math.max(STO_PREVIEW_SPLIT_MIN, Math.min(STO_PREVIEW_SPLIT_MAX, pct));
}

/** 全高页面壳层：TitleBar + main 上下内距（省区壳内 --sto-header-h 为 0） */
export const stoPageFillBelowTitleClass =
  'h-[calc(100dvh-var(--sto-header-h,40px)-var(--sto-main-pad-y-total,40px))]';

/** 省区 AppShell：chrome 下方侧栏 + 卡片行 */
export const stoAppShellBodyClass =
  'sto-app-shell-body flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-hidden';

/** 省区主内容白卡片外层（展开：上/左/下 8px；收起：由 body 四边 8px，此处无 padding） */
export function stoMainCardWrapClass(isSidebarCollapsed: boolean): string {
  return cn(
    'sto-main-card-wrap flex min-h-0 min-w-0 flex-1 flex-col box-border',
    isSidebarCollapsed ? 'p-0' : 'pt-2 pl-2 pb-2',
  );
}

/** 省区壳层 body：收起态四边 8px gutter */
export function stoAppShellBodyProvincialClass(isSidebarCollapsed: boolean): string {
  return cn(
    stoAppShellBodyClass,
    'no-drag box-border',
    isSidebarCollapsed && 'p-2',
  );
}

/** 省区主内容白卡片：18px 圆角、无描边、MasterGo drop shadow */
export const stoMainCardShellClass = cn(
  'min-h-0 min-w-0 flex-1 overflow-hidden border-0',
  'bg-[var(--sto-main-card-bg)] shadow-[var(--sto-main-card-shadow)]',
  'rounded-[var(--sto-main-card-radius)]',
  '[overflow-anchor:none]',
);

/** 省区主卡片内容槽（标题栏下方滚动区；顶内距由 ContentHeader 承担） */
export const stoMainCardBodyClass = cn(
  'min-h-0 min-w-0 flex-1 overflow-auto overscroll-y-contain',
  'px-[var(--sto-content-pad-x)] pb-5 pt-0 [scrollbar-gutter:stable]',
);

/** 三栏预览展开时：去掉 body 水平 px，避免与 ContentHeader / split row 双重 inset */
export const stoMainCardBodySplitClass = 'px-0';

/**
 * 内容区 52px 全局标题栏（MasterGo 组 7046）。
 * 单层 52px 白条：drag-region，双击最大化由系统处理。
 */
export const contentHeaderBarClass = cn(
  'drag-region flex shrink-0 items-center justify-between gap-2 overflow-hidden',
  'box-border h-[var(--sto-content-header-h,52px)] min-h-[var(--sto-content-header-h,52px)] max-h-[var(--sto-content-header-h,52px)]',
  'rounded-t-[var(--sto-main-card-radius)] bg-[var(--sto-main-card-bg)]',
  'pl-[var(--sto-content-header-pad-start)] pr-[var(--sto-content-header-pad-end)]',
);

/** @deprecated 合并为 {@link contentHeaderBarClass} */
export const contentHeaderShellClass = contentHeaderBarClass;

/** @deprecated 合并为 {@link contentHeaderBarClass} */
export const contentHeaderInnerClass = contentHeaderBarClass;

/** 标题栏左侧：会话标题 + 侧栏展开钮（与三栏容器左缘对齐，不被 previewTabs 挤没） */
export const contentHeaderTitleGroupClass = cn(
  'flex min-w-[120px] max-w-[min(34vw,280px)] shrink-0 items-center gap-2 overflow-hidden',
);

/** 三栏 header 左区（对话列宽）：侧栏钮 + 会话 tab，可横滑 */
export const contentHeaderSplitChatZoneClass = cn(
  'no-drag flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden',
);

/** 三栏 header 右区（预览列宽）：产物 tab + 操作 icon，与下方预览描边框对齐 */
export const contentHeaderSplitPreviewZoneClass = cn(
  'no-drag flex min-w-0 items-center gap-1 overflow-hidden',
);

/** 三栏 ContentHeader：grid 列宽与 split row（1fr + resizer + preview%）一致 */
export const contentHeaderSplitBarClass = cn(
  contentHeaderBarClass,
  'grid items-center gap-x-2',
  '[grid-template-columns:minmax(0,1fr)_4px_var(--sto-split-preview-col,50%)]',
);

/** 标题栏会话标题（纯文本 fallback） */
export const contentHeaderTitleClass =
  'min-w-0 truncate text-sm font-medium leading-5 text-foreground';

/** 标题栏会话 chip（MasterGo 组 7046：#F5F6F7 pill + truncate + 关闭） */
export const contentHeaderSessionChipClass = cn(
  'inline-flex h-[30px] min-w-0 max-w-full items-center gap-1 rounded-[10px] bg-[#F5F6F7] pl-2.5 pr-1',
);

/** 标题栏会话 chip 文案 */
export const contentHeaderSessionChipLabelClass =
  'min-w-0 flex-1 truncate text-sm font-medium leading-[18px] text-foreground';

/** 标题栏会话 chip 关闭钮 */
export const contentHeaderSessionChipCloseClass = cn(
  'no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground',
  'transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 标题栏右侧 icon 按钮（16×16 icon，Grey-9 默认） */
export const contentHeaderActionBtnClass = cn(
  'no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
  'text-[#4E5969] transition-colors duration-fast',
  'hover:bg-black/[0.04] hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 标题栏 icon 激活态（深度思考开、搜索开等） */
export const contentHeaderActionBtnActiveClass = 'bg-primary/10 text-primary';

/** ContentHeader 预览列内产物 tab 行（占预览区剩余宽，左对齐） */
export const contentHeaderPreviewTabsWrapClass = cn(
  'flex min-w-0 flex-1 items-center gap-2 overflow-x-auto',
);

/**
 * 工作流 Hero 输入复合框（MasterGo 2:7326）：白底 + Grey-4 描边 + 22px 圆角 + 轻阴影。
 * @see .cursor/rules/02-styles.mdc §工作流列表 Hero
 */
/** 工作流 Hero 区：标题距内容区顶部 64px（设计稿 Y） */
export const workflowHeroSectionClass = 'flex flex-col pt-16';

/**
 * 工作流 Hero 标题（MasterGo）：苹方-简 Medium，24px / 行高 36px，居中，字间距 0。
 */
export const workflowHeroTitleClass =
  'text-center text-2xl font-medium leading-9 tracking-normal text-foreground';

/** Hero 输入框 + 快捷提示行：固定 780px 居中 */
export const workflowHeroInteractiveShellClass = cn(stoHeroInputShellClass, 'mt-9 gap-3');

export const workflowHeroComposer = cn(
  'flex h-[120px] w-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-border bg-card',
  'shadow-[0_6px_24px_rgba(43,17,0,0.03)]',
);

/** Hero 快捷提示 chip 行 + 手动创建 */
export const workflowHeroQuickPromptsRowClass = 'flex min-w-0 w-full items-center';

/** 工作流 Hero 快捷提示 chip：12px / 行高 16px，上下 8px、左右 16px */
export const workflowHeroQuickChipClass = cn(
  'shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-4 py-2 text-xs font-normal leading-4',
  '!text-[#4E5969] transition-colors duration-fast hover:border-primary/30 hover:!text-primary',
);

/**
 * 工作流 Hero「手动创建」：文字与 chip 一致；icon 16×16，左 12px、与文字间距 6px、右 16px。
 */
export const workflowHeroManualCreateClass = cn(
  'relative z-[2] box-border inline-flex shrink-0 flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-[18px] border border-border bg-card',
  'pl-3 pr-4 py-2 text-xs font-normal leading-4 !text-[#4E5969]',
  'shadow-[0_2px_24px_rgba(43,17,0,0.03)] transition-colors duration-fast hover:border-primary/30 hover:!text-primary',
);

/**
 * 工作流页底纹夹层：绝对定位，不占文档流。
 * left/right 负 inset 抵消 MainLayout `<main>` 的 padding + scrollbar-gutter 预留，贴齐主区可视边缘。
 */
export const workflowPageShadingLayerClass =
  'pointer-events-none absolute top-[var(--sto-wf-page-shading-top)] z-0 h-[var(--sto-wf-page-shading-h)] left-[calc(-1*var(--sto-content-pad-x))] right-[calc(-1*var(--sto-content-pad-x)-var(--sto-main-scrollbar-gutter))] overflow-hidden';

/** 底纹平铺层：repeat-x + 与切图像素一致的 background-size，避免多 img 横排亚像素缝 */
export const workflowPageShadingPatternClass =
  'h-full w-full bg-left-top bg-repeat-x bg-[length:var(--sto-wf-page-shading-tile-w)_var(--sto-wf-page-shading-h)]';

/** 工作流列表页根容器：底纹与内容叠层 */
export const workflowPageRootClass = 'relative min-w-0';

/** 工作流列表页业务内容层：始终在底纹之上 */
export const workflowPageContentClass = 'relative z-[1] min-w-0';

/**
 * 工作流列表主区：距 Hero 快捷提示行 64px；Tab 工具栏与下方二级筛选、卡片网格同块联动。
 */
export const workflowListMainSectionClass = 'mt-16 flex flex-col';

/** 工作流列表：主 Tab + 搜索工具栏容器 */
export const workflowListToolbarClass =
  'flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-3';

/** 工作流列表搜索框 label（与定时任务 TaskHero 同款结构） */
export const workflowListSearchLabelClass = 'relative flex shrink-0 items-center';

/** 工作流列表搜索图标容器：left-3，14×14 */
export const workflowListSearchIconWrapClass = 'absolute left-3 text-muted-foreground';

/**
 * 工作流列表搜索 input：184×34，圆角 8px；focus 描边 #c5cad3 + 轻阴影（非 ring）。
 */
export const workflowListSearchInputClass = cn(
  'h-[34px] w-[184px] rounded-[8px] border border-border bg-card py-0 pl-[30px] pr-[10px]',
  'text-[13px] placeholder:text-muted-foreground',
  'focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] focus:ring-0',
);

/**
 * 工作流列表：二级筛选 nav 行（单行横向滚动，避免换行导致 Tab/筛选切换时整页高度跳动）
 */
export const workflowListSubnavNavClass =
  'flex min-h-10 w-full min-w-0 items-center gap-x-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** 二级筛选行外层：固定占位，主 Tab 与二级 pill 切换时列表区起始位置不变 */
export const workflowListSubnavSlotClass = 'my-3.5 mb-4 min-h-10';

/** 工作流列表主 Tab：固定行高，选中加粗主色，无下划线 */
export function workflowListTabClass(active: boolean): string {
  return cn(
    'inline-flex h-9 shrink-0 items-center bg-transparent text-base transition-colors duration-fast',
    active
      ? 'font-semibold text-foreground'
      : 'font-medium text-muted-foreground hover:text-foreground',
  );
}

/** 工作流列表二级筛选 pill */
export function workflowListSubnavClass(active: boolean): string {
  return cn(
    'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors duration-fast',
    active
      ? 'bg-border font-semibold text-foreground'
      : 'bg-transparent font-medium text-muted-foreground hover:text-foreground/80',
  );
}

/** 工作流列表二级筛选计数 */
export function workflowListSubnavCountClass(active: boolean): string {
  return cn('tabular-nums', active ? 'text-muted-foreground' : 'text-muted-foreground/70');
}

/**
 * 工作流列表卡片网格：同行等高（items-stretch）；节点换行拉高整行时，矮卡底部留白落在节点区与底栏钮之间。
 */
export const workflowListCardGridClass =
  'grid grid-cols-[repeat(auto-fill,minmax(max(238px,(100%-24px)/3),1fr))] items-stretch gap-3 [overflow-anchor:none]';

/** 工作流列表卡片外框 */
export const workflowListCardShellClass = cn(
  'flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[18px] bg-card',
  'shadow-[0_0_4px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-base',
  'hover:shadow-[0_0_16px_rgba(0,0,0,0.06)]',
);

/** 工作流卡片头图：距卡片边框上/左/右 4px（设计稿） */
export const workflowListCardCoverWrapClass = 'px-1 pt-1';

/** 工作流卡片头图内圆角（外框 18px − 内边距 4px） */
export const workflowListCardCoverClass = 'rounded-[14px]';

/** 工作流卡片内容区：与底栏固定 gap-4（16px）；上区 flex-1 吸收同行等高差 */
export const workflowListCardBodyClass =
  'flex flex-1 flex-col gap-4 px-[18px] pt-[13px] pb-4';

/** 工作流卡片主内容区（标题 / 描述 / 节点模块）；增高落在节点模块下方 */
export const workflowListCardMainClass = 'flex min-h-0 flex-1 flex-col gap-[9px]';

/** 工作流卡片底栏：固定距节点模块 16px（由 body gap-4） */
export const workflowListCardFooterClass = 'shrink-0';

/** 标题 + 调度：标题与「每日运行」间距 4px（gap-1） */
export const workflowListCardHeadClass = 'flex flex-col gap-1';

/** 标题行（与右侧开关同一行对齐） */
export const workflowListCardTitleRowClass = 'flex min-w-0 items-center justify-between gap-2';

/** 调度说明行 */
export const workflowListCardScheduleRowClass = 'text-xs text-muted-foreground';

/** 工作流节点灰底区块：描边 #F2F3F5、圆角 8px、底 #FAFBFC；标题与流程间距 6px */
export const workflowListCardFlowBlockClass =
  'flex flex-col gap-1.5 rounded-md border border-[#F2F3F5] bg-[#FAFBFC] px-[10px] py-2 text-xs';

/** 工作流节点标题行（灰底内，带图标） */
export const workflowListCardFlowTitleClass =
  'flex items-center gap-1 font-medium text-foreground';

/** 工作流节点步骤行：换行后行间距 4px；箭头与节点均为独立 flex 子项 */
export const workflowListCardFlowStepsClass = 'flex flex-wrap items-center gap-x-1 gap-y-1';

export const workflowListCardFlowSepClass = 'font-medium leading-snug text-foreground';

export const workflowListCardFlowStepClass =
  'rounded-md bg-card px-2 py-0.5 text-xs leading-snug text-foreground';

/** 工作流卡片底栏三钮共用圆角 8px（`rounded-lg` = `--radius`） */
export const workflowListCardActionRadiusClass = 'rounded-lg';

/** 工作流卡片底栏主操作钮（立即运行 / 安装） */
export const workflowListCardPrimaryActionClass = cn(
  workflowListCardActionRadiusClass,
  'bg-foreground px-4 py-1.5 text-[13px] font-semibold text-primary-foreground',
  'transition-[transform,background-color] duration-fast hover:bg-foreground/90 active:scale-[0.98]',
);

/** 工作流卡片底栏次操作钮（编辑流程 / 预览） */
export const workflowListCardSecondaryActionClass = cn(
  'inline-flex items-center gap-1 border border-border bg-transparent px-3 py-1.5 text-[13px] font-medium text-foreground',
  workflowListCardActionRadiusClass,
  'transition-colors duration-fast hover:bg-black/[0.02]',
);

/** 工作流卡片更多菜单钮（···） */
export const workflowListCardMoreActionClass = cn(
  workflowListCardActionRadiusClass,
  'border border-border px-2 py-1.5 text-muted-foreground',
  'transition-colors duration-fast hover:bg-black/[0.02] hover:text-foreground',
);

/** 工作流卡片浮动菜单容器 */
export const workflowListCardMenuClass =
  'fixed z-[126] w-[200px] rounded-xl border border-border bg-card p-1.5 shadow-[0_8px_40px_rgba(0,0,0,0.16)]';

/** 工作流卡片浮动菜单项 */
export const workflowListCardMenuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted';

/** 工作流详情弹窗遮罩 */
export const workflowDetailModalOverlayClass = 'bg-black/20';

/** 工作流详情弹窗内容壳（540px / 圆角 24 / MasterGo 阴影） */
export const workflowDetailModalContentClass = cn(
  'flex w-full max-w-[540px] flex-col overflow-hidden rounded-[24px] bg-card',
  'max-h-[min(960px,calc(100vh-40px))]',
  'shadow-[var(--sto-wf-detail-modal-shadow)]',
);

/** 详情弹窗头图区：距壳层上/左右 8px */
export const workflowDetailModalCoverWrapClass = 'relative shrink-0 px-2 pt-2';

/** 详情弹窗头图：固定高 180px、圆角 12 */
export const workflowDetailModalCoverClass =
  'aspect-auto h-[180px] rounded-xl bg-[var(--sto-wf-detail-cover-bg)]';

/** 详情弹窗关闭钮 */
export const workflowDetailModalCloseClass = cn(
  'absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border-0',
  'bg-black/20 text-white shadow-none outline-none transition-colors duration-fast',
  'hover:bg-black/35 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
);

/** 详情弹窗标题区 */
export const workflowDetailModalTitleBlockClass =
  'flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-4 pb-2';

/** 详情弹窗分类 badge */
export const workflowDetailModalCategoryBadgeClass = cn(
  'inline-flex shrink-0 rounded-md px-1.5 py-1 text-xs font-medium',
  'bg-[var(--sto-wf-detail-category-bg)] text-[var(--sto-wf-detail-category-text)]',
);

/** 详情弹窗正文水平内距 */
export const workflowDetailModalBodyPadClass = 'px-3';

/** 详情弹窗信息行 */
export const workflowDetailModalInfoRowClass =
  'flex items-start gap-3 border-b border-border py-3 text-sm';

/** 详情弹窗信息行 label（固定四字标题列宽） */
export const workflowDetailModalInfoLabelClass =
  'w-[72px] shrink-0 text-muted-foreground';

/** 详情弹窗步骤区 */
export const workflowDetailModalStepsSectionClass = 'px-3 py-4';

/** 详情弹窗步骤区标题 */
export const workflowDetailModalStepsHeadingClass =
  'mb-4 flex items-center gap-1.5 text-sm font-normal text-muted-foreground';

/** 详情弹窗步骤序号 */
export const workflowDetailModalStepIndexClass = cn(
  'flex h-5 w-5 items-center justify-center rounded-full border border-border',
  'bg-card text-xs font-normal text-foreground/80',
);

/** 详情弹窗步骤标题 + 说明（同行，说明在标题后） */
export const workflowDetailModalStepTitleRowClass =
  'mt-0.5 flex flex-wrap items-baseline gap-x-1.5 leading-[18px]';

export const workflowDetailModalStepTitleClass = 'text-sm font-normal text-foreground';

export const workflowDetailModalStepDescClass =
  'text-[13px] leading-4 text-muted-foreground';

/** 详情弹窗技能 tag（复用封面紫色 token） */
export const workflowDetailModalSkillTagClass = cn(
  'inline-flex items-center gap-1 rounded-lg border px-[9px] py-1 text-xs font-medium',
  'border-[var(--sto-wf-cover-purple-accent)] bg-[var(--sto-wf-cover-purple-bg)]',
  'text-[var(--sto-wf-cover-purple-icon)]',
);

/** 详情弹窗更多菜单（浮动下拉菜单容器） */
export const workflowDetailModalMenuClass =
  'absolute right-0 top-full z-10 mt-1.5 min-w-[160px] rounded-xl border border-border bg-card p-1.5 shadow-[0_8px_40px_rgba(0,0,0,0.16)]';

/** 详情弹窗底栏 */
export const workflowDetailModalFooterClass =
  'sticky bottom-0 flex items-end justify-between gap-2 bg-card px-[18px] py-4';

/** 详情弹窗底栏主钮（立即运行） */
export const workflowDetailModalPrimaryActionClass = cn(
  'h-[34px] rounded-xl px-4 text-sm font-medium',
  'bg-foreground text-primary-foreground transition-[transform,background-color] duration-fast',
  'hover:bg-foreground/90 active:scale-[0.98]',
);

/** 详情弹窗底栏次钮（编辑流程） */
export const workflowDetailModalSecondaryActionClass = cn(
  'h-[34px] rounded-xl border-border px-4 text-sm font-medium',
  'transition-colors duration-fast hover:bg-black/[0.02]',
);

/** 详情弹窗更多钮 */
export const workflowDetailModalMoreActionClass = cn(
  'order-1 h-8 w-8 rounded-xl border-border px-0',
  'transition-colors duration-fast hover:bg-black/[0.02]',
);

/**
 * MasterGo 148:046134 — 工作流分组参数摘要外框（对话流内助手 A）
 * 圆角 12 / Grey-4 描边 / 内距 14×12；组间距 8、组内标题-内容间距 2。
 */
export const workflowParamsSummaryCardClass =
  'w-full rounded-xl border border-border px-[14px] py-3';

export const workflowParamsSummaryGroupsClass = 'flex w-full flex-col gap-2';

export const workflowParamsSummaryGroupClass = 'flex flex-col gap-0.5';

export const workflowParamsSummaryGroupTitleClass =
  'text-[13px] leading-5 font-normal text-foreground';

export const workflowParamsSummaryGroupContentClass =
  'text-[13px] leading-5 font-normal text-muted-foreground whitespace-pre-wrap break-words';

/**
 * 工具调用块外层（无描边；标题行在外，入参区单独套 {@link chatToolCallContentShellClass}）
 */
export const chatToolCallShellClass = 'flex w-full flex-col gap-1.5';

/** 工具调用标题行（与 ParamsConfirmedHeader / 参数分组标题同级，在描边容器外） */
export const chatToolCallHeaderBtnClass = cn(
  'flex items-center gap-1 text-left',
  'text-[13px] leading-5 font-normal text-muted-foreground transition-colors duration-150 hover:text-foreground',
  'disabled:cursor-default disabled:hover:text-muted-foreground',
);

/** 工具入参展开区外框（与 {@link workflowParamsSummaryCardClass} / 数据来源一致） */
export const chatToolCallContentShellClass = workflowParamsSummaryCardClass;

/** 工具入参正文（与 {@link workflowParamsSummaryGroupContentClass} 一致，保留等宽字体便于读 JSON） */
export const chatToolCallInputPreClass = cn(
  workflowParamsSummaryGroupContentClass,
  'm-0 max-h-[min(42vh,400px)] overflow-y-auto font-mono text-xs leading-5',
);

/**
 * 工作流编辑器：抵消 main 内距，占满主区可视高度（TitleBar + main py 合计）。
 */
export const workflowBuilderShell = cn(
  '-mx-[var(--sto-content-pad-x)] -mt-5 flex min-h-0 min-w-0 flex-col',
  stoPageFillBelowTitleClass,
);
