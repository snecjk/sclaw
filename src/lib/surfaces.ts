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

/** 任务子项聊天：与设计壳层 MainLayout 中 `<main>` 一致（浅色 `--sto-page-bg`，深色 `background`），避免与主区两侧 / 滚动条带叠色出缝 */
export const stoTaskSubitemChatCanvasBg = cn(
  'bg-[var(--sto-page-bg)]',
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

/**
 * 列表/设置类页面主内容区：最大 `--sto-main-inner-max`，窗口变宽时两侧留白（非 sm/md/lg 断点）。
 * @see .cursor/rules/02-styles.mdc §响应式
 */
export const stoMainInnerShell = 'mx-auto w-full min-w-0 max-w-[var(--sto-main-inner-max)]';

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

/** Hero 输入框 + 快捷提示行：随容器伸缩，最大 780px 居中 */
export const workflowHeroInteractiveShellClass =
  'mx-auto mt-9 flex w-full min-w-0 max-w-[780px] flex-col gap-3';

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

/** 详情弹窗浮动菜单 */
export const workflowDetailModalMenuClass =
  'absolute bottom-[calc(100%+8px)] right-0 z-20 w-[208px] rounded-lg border border-border bg-card p-1.5 shadow-[0_6px_30px_rgba(0,0,0,0.08)]';

/**
 * 工作流编辑器：抵消 main 内距，占满主区可视高度（TitleBar + main py 合计 5rem）。
 */
export const workflowBuilderShell = cn(
  '-mx-[var(--sto-content-pad-x)] -mt-5 flex min-h-0 min-w-0 flex-col',
  'h-[calc(100dvh-5rem)]',
);
