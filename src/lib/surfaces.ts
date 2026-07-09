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

/** 设置页右侧内容区白卡片（MasterGo：8px 圆角、#E5E6EB 描边、白底） */
export const stoSettingsSectionCardClass = cn(
  'overflow-hidden rounded-[8px] border border-[#E5E6EB] bg-white p-6',
  'dark:border-border dark:bg-card',
);

/** 设置页右侧内容卡片外槽：顶/右/底 8px 留白（MasterGo top:8px） */
export const stoSettingsContentPanelWrapClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col pt-2 pr-2 pb-2',
);

/** 设置页右侧内容卡片（MasterGo：18px 圆角、#F7F8FA、0 0 16px rgba(0,0,0,0.01)） */
export const stoSettingsContentPanelClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-[#F7F8FA]',
  'shadow-[0_0_16px_0_rgba(0,0,0,0.01)]',
  'dark:bg-background dark:shadow-none',
);

/** 设置页右侧内容卡片内滚动区 */
export const stoSettingsContentPanelBodyClass = cn(
  'min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]',
);

/** 设置页右侧内容主列（MasterGo 容器 7361：862×958、left 145px 于卡片内、top 72px、gap 36px） */
export const stoSettingsContentInnerClass = cn(
  'mx-auto box-border flex w-full max-w-[862px] flex-col gap-[36px] pt-[72px] pb-10',
  'px-6 min-[974px]:px-0',
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
 * 用户消息气泡（chat-interaction-style-spec §4.1）：#F0F2F5、圆角 12px 0 12px 12px、内距 8px。
 * 使用位置：ChatMessage MessageBubble、对话列表用户侧。
 */
export const userChatBubbleSurfaceClass = cn(
  'rounded-xl rounded-tr-none bg-[#F0F2F5] p-2 text-foreground shadow-none',
  'dark:bg-muted dark:shadow-none',
);

/**
 * 首页/对话页 home 布局输入复合框壳（rounded-[22px]）。
 * 使用位置：ChatInput composerLayout=home。
 */
export const chatComposerHomeShellClass = cn(
  'relative flex min-h-[120px] flex-col overflow-visible rounded-[22px] border border-border bg-card',
  'shadow-[0_6px_30px_rgba(43,17,0,0.03)] transition-[box-shadow,border-color,ring-width,ring-color] duration-200',
  'dark:shadow-[0_4px_14px_rgba(0,0,0,0.22)]',
);

/** home 输入壳：拖拽文件悬停 */
export const chatComposerHomeShellDragOverClass =
  'border-primary ring-2 ring-primary/25 dark:ring-primary/30';

/** home 输入壳：默认 hover / focus-within */
export const chatComposerHomeShellIdleClass = cn(
  'hover:border-primary/80 dark:hover:border-primary/70',
  'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 dark:focus-within:ring-primary/28',
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

/** 首页对话/消息/输入内容区最大宽（780px，无列内 px-6 场景直接用） */
export const stoChatShellHomeClass =
  'mx-auto w-full min-w-0 max-w-[var(--sto-chat-max-w-home)]';

/** 非首页对话/内容区最大宽（862px，无列内 px-6 场景直接用） */
export const stoChatShellPageClass =
  'mx-auto w-full min-w-0 max-w-[var(--sto-chat-max-w-page)]';

/**
 * 对话列壳 max-w：border-box 下 {@link stoChatColumnClass} 的 px-6 会吃掉内容宽，
 * 壳层需加上 3rem（24px×2）后，列内消息/输入等内容区才能贴齐设计 token。
 */
export const stoChatShellHomeColumnMaxClass =
  'mx-auto w-full min-w-0 max-w-[calc(var(--sto-chat-max-w-home)+3rem)]';

export const stoChatShellPageColumnMaxClass =
  'mx-auto w-full min-w-0 max-w-[calc(var(--sto-chat-max-w-page)+3rem)]';

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
  'transition-colors duration-fast hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 我的任务卡片外框（MasterGo 容器 7377）：18px 圆角 + 16px 内距 + glow，无描边；等高网格内 h-full */
export const myTaskCardShellClass = cn(
  'relative flex h-full min-w-0 flex-col rounded-[18px] bg-card p-4 shadow-glow dark:bg-secondary',
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

/** 表单字段 focus（input / select / textarea） */
export const formFieldFocusClass = cn(
  'focus:outline-none focus:ring-0',
  'focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)]',
  'dark:focus:border-primary/50 dark:focus:shadow-[0_0_0_3px_rgba(255,111,0,0.15)]',
);

/** 表单触发器 focus-visible（button 类下拉） */
export const formFieldFocusVisibleClass = cn(
  'focus-visible:outline-none focus-visible:ring-0',
  'focus-visible:border-[#c5cad3] focus-visible:shadow-[0_0_0_3px_rgba(15,23,42,0.06)]',
  'dark:focus-visible:border-primary/50 dark:focus-visible:shadow-[0_0_0_3px_rgba(255,111,0,0.15)]',
);

/** 表单触发器 hover 描边 */
export const formFieldHoverBorderClass = 'hover:border-[#c5cad3] dark:hover:border-primary/40';

/** 表单触发器展开态 */
export const formFieldOpenClass = cn(
  'border-[#c5cad3] shadow-[0_0_0_3px_rgba(15,23,42,0.06)]',
  'dark:border-primary/50 dark:shadow-[0_0_0_3px_rgba(255,111,0,0.15)]',
);

/** 反色主钮底色/字色：亮色深底白字；暗色浅底深字（背景 80% 不透明，避免暗色下过亮） */
export const invertedPrimarySurfaceClass = cn(
  'bg-foreground text-primary-foreground hover:bg-foreground/90',
  'dark:bg-foreground/80 dark:text-background dark:hover:bg-foreground/90',
);

/** 弹窗底栏主提交钮（新建/编辑定时任务等） */
export const modalPrimarySubmitButtonClass = cn(
  'h-[42px] rounded-[10px] border-none px-5 text-sm shadow-soft',
  invertedPrimarySurfaceClass,
);

/** SchedulePicker 触发器（与 formField 系列一致） */
export const schedulePickerTriggerClass = cn(
  'flex h-[42px] w-full cursor-pointer items-center justify-between gap-1.5',
  'rounded-[10px] border bg-background px-3.5 pr-2.5 text-sm font-medium text-foreground',
  'outline-none transition-colors',
  formFieldHoverBorderClass,
);

/** SchedulePicker 下拉面板 */
export const schedulePickerDropdownPanelClass = cn(
  'overflow-hidden rounded-xl border border-border bg-popover',
  'shadow-[0_12px_32px_rgba(15,23,42,0.12)] dark:shadow-modal',
);

/** 下拉选项：选中 / hover 统一 primary 浅底 */
export function dropdownOptionClass(isActive: boolean): string {
  return cn(
    'transition-[background,color]',
    isActive
      ? 'bg-primary/10 font-semibold text-primary'
      : 'text-foreground hover:bg-primary/10 hover:text-primary',
  );
}

/** 我的任务 / 工作流排期开关轨道 */
export function scheduleToggleTrackClass(checked: boolean): string {
  return cn(
    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-none p-0 transition-colors duration-fast',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    checked ? 'bg-success dark:bg-success/90' : 'bg-border dark:bg-muted',
  );
}

/** 排期开关滑块（暗色下用浅底，避免与卡片底色融为一体） */
export const scheduleToggleThumbClass = cn(
  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card dark:bg-foreground/80',
  'shadow-[0_1px_2px_rgba(15,23,42,0.15)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.45)]',
  'transition-transform duration-fast',
);

/** 我的任务卡片：关联工作流 badge（复用 cover purple token） */
export const myTaskWorkflowBadgeClass = cn(
  'ml-[6px] inline-flex shrink-0 items-center gap-[4px] whitespace-nowrap rounded-full',
  'border border-[var(--sto-wf-cover-purple-accent)] bg-[var(--sto-wf-cover-purple-bg)]',
  'px-[7px] py-[1px] text-[11px] font-medium leading-[1.55] text-[var(--sto-wf-cover-purple-icon)]',
);

/** 执行记录单行：暗色用 secondary 与主卡片底色分层 */
export const myTaskRecordItemShellClass = cn(
  'flex items-center gap-3.5 rounded-[12px] border border-border bg-card p-[14px_16px]',
  'dark:bg-secondary',
);

/** 执行记录「查看详情」 */
export const myTaskRecordDetailButtonClass = cn(
  'shrink-0 cursor-pointer rounded-lg border border-border bg-card px-3.5 py-1.5',
  'font-[inherit] text-[13px] text-muted-foreground transition-colors',
  'hover:bg-muted hover:text-foreground dark:hover:bg-white/[0.06]',
);

/** 空状态主 CTA（新建定时任务） */
export const myTaskEmptyPrimaryCtaClass = cn(
  'inline-flex items-center justify-center gap-1.5 h-[34px] px-[14px]',
  'rounded-lg text-sm font-semibold shadow-soft',
  invertedPrimarySurfaceClass,
  'transition-[background,transform,filter] duration-75 active:scale-[0.98]',
);

/** 空状态官方推荐模板卡 */
export const myTaskEmptyTemplateCardClass = cn(
  'flex min-w-0 cursor-pointer flex-col rounded-[var(--radius-lg,12px)]',
  'border border-border bg-card p-[14px_16px]',
  'transition-[border-color,box-shadow] duration-75 hover:shadow-soft',
);

/** 空状态模板「添加」按钮 */
export const myTaskEmptyTemplateAddButtonClass = cn(
  'inline-flex min-h-[28px] cursor-pointer items-center justify-center rounded-lg',
  'border-none bg-muted px-2.5 text-xs font-medium text-foreground',
  'transition-[background,color] duration-75 hover:bg-muted/80 dark:hover:bg-white/[0.08]',
);

/** 我的任务排序触发器 */
export const myTaskSortTriggerClass = cn(
  'flex h-[34px] items-center gap-[6px] rounded-[10px] border border-border bg-card',
  'px-[10px] text-[13px] font-medium text-foreground transition-[border-color,box-shadow]',
  formFieldHoverBorderClass,
  formFieldFocusVisibleClass,
);

/** 首页对话整列（toolbar + 消息 + 输入同宽居中，列内内容区最大 780px） */
export const stoChatShellHomeColumnClass = cn(
  stoChatShellHomeColumnMaxClass,
  'flex min-h-0 flex-1 flex-col',
);

/** 非首页对话整列（toolbar + 消息 + 输入同宽居中，列内内容区最大 862px） */
export const stoChatShellPageColumnClass = cn(
  stoChatShellPageColumnMaxClass,
  'flex min-h-0 flex-1 flex-col',
);

/** 三栏对话区卡片（MasterGo 矩形 2498：18px 圆角 + #F7F8FA + shadow-glow） */
export const stoSplitChatCardClass = cn(
  'min-h-0 min-w-0 overflow-hidden rounded-[18px] bg-[var(--sto-main-card-bg)] shadow-glow',
);

/** 三栏模式：左栏卡片外层（贴满分割面板；内层对话仍用 page/home 限宽壳居中） */
export const stoSplitChatPaneCardWrapClass = cn(
  stoSplitChatCardClass,
  'flex min-h-0 min-w-0 w-full flex-1 flex-col',
);

export type StoChatColumnVariant = 'page' | 'home';

/**
 * 对话列壳：toolbar + 消息 + 输入同宽居中。
 * 双栏 / 三栏均相同限宽（列内内容 page 862px / home 780px），不随浏览器无限变宽。
 */
export function stoChatColumnShellClass(variant: StoChatColumnVariant): string {
  return variant === 'home' ? stoChatShellHomeColumnClass : stoChatShellPageColumnClass;
}

/**
 * 对话列完整 class：Chat / 任务子项 / 首页会话共用。
 * 双栏 / 三栏共用列内 862/780 内容宽轨；三栏 self-center 居中阅读轨（勿加 max-w-full，会盖掉列壳 max-w）。
 */
export function stoChatColumnClass(variant: StoChatColumnVariant, isSplit = false): string {
  return cn(
    stoChatColumnShellClass(variant),
    'px-6',
    isSplit && 'min-w-0 self-center',
  );
}

/**
 * 对话列内居中阅读轨（消息 / 输入 / 底栏共用）：限宽 + 水平内距，不含滚动。
 * 滚动条挂在 {@link stoChatScrollPaneClass}，贴内容列右缘而非阅读轨内。
 */
export function stoChatColumnContentTrackClass(
  variant: StoChatColumnVariant,
  isSplit = false,
): string {
  return cn(
    variant === 'home' ? stoChatShellHomeColumnMaxClass : stoChatShellPageColumnMaxClass,
    'w-full px-6',
    isSplit && 'min-w-0',
  );
}

/**
 * 对话消息列表滚动区：铺满内容列宽，滚动条贴列右缘。
 */
export const stoChatScrollPaneClass = cn(
  'relative z-10 min-h-0 flex-1 w-full py-4',
  'overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]',
);

/**
 * 三栏对话消息滚动区。
 * min-w-0 + overflow-x-hidden：flex 子项默认 min-width:auto 会被 WorkflowCard 等块撑破列宽，
 * 导致右侧描边贴边或被卡片壳 overflow-hidden 裁切；垂直滚动仍保留。
 */
export const stoChatScrollPaneSplitClass = cn(
  stoChatScrollPaneClass,
  'min-w-0 overflow-x-hidden',
);

/** @deprecated 使用 {@link stoChatScrollPaneSplitClass} */
export const stoSplitChatScrollClass = stoChatScrollPaneSplitClass;

/** 三栏对话消息列表内层：与滚动区配合 min-w-0，防止块级子项撑宽 */
/** 对话消息列表内层间距（规范 §2.3 消息之间 20px） */
export const stoChatScrollContentClass = 'min-w-0 w-full space-y-5';

/** 三栏左栏内容外包：split 时加卡片壳，否则仅占满 pane 并居中限宽轨 */
export function stoSplitChatPaneContentWrapClass(isSplit: boolean): string {
  return isSplit
    ? stoSplitChatPaneCardWrapClass
    : 'flex min-h-0 min-w-0 w-full flex-1 flex-col';
}

/** 三栏壳层水平 inset（挂在 main，Header + split row 共用同一网格可用宽） */
export const stoSplitShellInsetsClass = cn(
  'pl-[var(--sto-content-header-pad-start)]',
  'pr-[var(--sto-content-header-pad-end)]',
);

/** @deprecated 使用 {@link stoSplitShellInsetsClass} 挂 main；子级 grid 不再重复 pl/pr */
export const stoSplitHorizontalInsetsClass = stoSplitShellInsetsClass;

/** 三栏 split row 仅保留垂直 py-2（非统一 grid 双栏回退用） */
export const stoSplitRowInsetsClass = cn('box-border py-2');

/**
 * 三栏统一 grid（main）：2 行 × 3 列；--sto-split-preview-col 只写在 main。
 * header / body / split row 用 {@link stoSplitGridContentsClass} 参与同一网格。
 */
export const stoSplitUnifiedMainClass = cn(
  'grid min-h-0 min-w-0 flex-1 overflow-hidden box-border',
  'grid-rows-[var(--sto-content-header-h,52px)_minmax(0,1fr)]',
  'grid-cols-[minmax(0,1fr)_4px_var(--sto-split-preview-col,50%)]',
  'gap-x-2',
);

/** 三栏：中间层 display:contents，子元素直接参与 main grid */
export const stoSplitGridContentsClass = 'contents';

/** @deprecated 三栏改用 {@link stoSplitRowContentsClass} + main {@link stoSplitUnifiedMainClass} */
export const stoSplitRowClass = cn(
  stoSplitRowInsetsClass,
  'grid min-h-0 min-w-0 w-full flex-1 overflow-x-hidden',
  'gap-x-2',
  '[grid-template-columns:minmax(0,1fr)_4px_var(--sto-split-preview-col,50%)]',
);

/** 三栏 split row 外壳：display:contents，列定位由子项 grid class 承担 */
export const stoSplitRowContentsClass = stoSplitGridContentsClass;

/** 三栏 header 行 col1：会话 chip + 顶圆角左（外层 drag-region，内层 no-drag 见 ContentHeader） */
export const stoSplitGridHeaderChatClass = cn(
  'drag-region col-start-1 row-start-1 self-stretch min-w-0',
  'flex items-center',
  'box-border h-[var(--sto-content-header-h,52px)] min-h-[var(--sto-content-header-h,52px)] max-h-[var(--sto-content-header-h,52px)]',
  'rounded-tl-[var(--sto-main-card-radius)] bg-[var(--sto-main-card-bg)]',
);

/** 三栏 header 行 col2：与 body 拖拽条同列对齐 */
export const stoSplitGridHeaderResizerClass = cn(
  'drag-region col-start-2 row-start-1 self-stretch',
  'h-[var(--sto-content-header-h,52px)] min-h-[var(--sto-content-header-h,52px)] max-h-[var(--sto-content-header-h,52px)] w-1 shrink-0',
  'bg-[var(--sto-main-card-bg)]',
);

/** 三栏 header 行 col3：☰ + tab + actions + 顶圆角右（外层 drag-region，内层 no-drag） */
export const stoSplitGridHeaderPreviewClass = cn(
  'drag-region col-start-3 row-start-1 self-stretch min-w-0',
  'flex items-center',
  'box-border h-[var(--sto-content-header-h,52px)] min-h-[var(--sto-content-header-h,52px)] max-h-[var(--sto-content-header-h,52px)]',
  'rounded-tr-[var(--sto-main-card-radius)] bg-[var(--sto-main-card-bg)]',
);

/** 三栏 body 行 col1：对话列 */
export const stoSplitGridBodyChatClass = cn(
  'col-start-1 row-start-2 self-stretch',
  'relative flex min-h-0 min-w-0 flex-col overflow-hidden py-2 box-border',
);

/** 三栏 body 行 col3：预览面板 */
export const stoSplitGridBodyPreviewClass = cn(
  'col-start-3 row-start-2 self-stretch',
  'flex min-h-0 min-w-0 flex-col overflow-hidden py-2 box-border',
  '[contain:inline-size]',
);

/** ParameterFormDock layout（与对话列 variant 一致） */
export function stoParameterFormDockLayout(variant: StoChatColumnVariant): 'home' | 'page' {
  return variant === 'home' ? 'home' : 'page';
}

/** ParameterForm chat-dock 顶部条（浅灰底；暗色 secondary，避免白条） */
export const parameterFormDockHeaderClass =
  'shrink-0 rounded-t-[18px] bg-[#FAFBFC] px-3.5 pb-2 pt-3 dark:border-b dark:border-border dark:bg-secondary';

/** ParameterForm chat-dock 继续 / 确认主按钮（暗色用品牌主色，避免整颗白钮） */
export const parameterFormDockPrimaryButtonClass = cn(
  'inline-flex h-6 items-center gap-1 rounded-[7px] px-3 text-xs font-medium transition-colors disabled:opacity-50',
  'bg-foreground text-primary-foreground hover:bg-foreground/90',
  'dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90',
);

/** ParameterForm chat-dock 可选项 hover（暗色不用 #FAFAFA 白底） */
export const parameterFormDockOptionHoverClass =
  'bg-transparent hover:bg-muted/40 dark:hover:bg-muted/60';

/** ParameterForm chat-dock 可选项选中底 */
export const parameterFormDockOptionSelectedClass =
  'bg-muted/30 dark:bg-muted/50';

/** ParameterForm chat-dock 规则行 / 数字字段卡片外框 */
export const parameterFormDockFieldRowClass =
  'rounded-[10px] border border-border p-2';

/** ParameterForm chat-dock 序号徽章（规则 1–6 等） */
export const parameterFormDockIndexBadgeClass = cn(
  'flex shrink-0 items-center justify-center rounded-[9px] bg-muted text-[10px] text-muted-foreground',
  'h-[18px] w-[18px]',
);

/** ParameterForm chat-dock 步进器外壳（− 数字 + 一体边框） */
export const parameterFormDockStepperShellClass =
  'inline-flex h-7 items-stretch overflow-hidden rounded-md border border-border bg-card';

/** ParameterForm chat-dock 步进器 ± 按钮 */
export const parameterFormDockStepperButtonClass =
  'flex items-center justify-center bg-muted/50 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

/** ParameterForm chat-dock 步进器 / 区间输入框 */
export const parameterFormDockStepperInputClass = cn(
  'border-border bg-card text-center text-[13px] text-foreground',
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
);

/** Hero / 大输入复合框壳层（最大 780px 居中，与首页 Hero 区同源变量） */
export const stoHeroInputShellClass =
  'mx-auto flex w-full min-w-0 max-w-[var(--sto-hero-input-max-w)] flex-col';

/** 三栏模式：对话区 grid 第一列（贴满 1fr 轨道） */
export const stoSplitChatPaneClass = cn(
  'relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden',
);

/** 三栏模式：预览区（列宽由 split row grid 的 --sto-split-preview-col 控制） */
export const stoSplitPreviewPaneClass =
  'flex h-full min-h-0 min-w-0 flex-col overflow-hidden [contain:inline-size]';

/** 三栏预览区产物内容壳（描边在 tab 行下方，不含 tab） */
export const stoPreviewContentShellClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-border',
  'bg-[var(--sto-main-card-bg)] shadow-glow',
);

/** @deprecated 整卡描边已拆至 {@link stoPreviewContentShellClass}，tab 行在外 */
export const stoSplitPreviewCardClass = stoPreviewContentShellClass;

/** 预览产物 tab pill（选中 #E5E6EB / 未选 #F5F6F7；暗色未选用 muted 底 + 次级字色） */
export function stoPreviewArtifactTabClass(isActive: boolean): string {
  return cn(
    'inline-flex h-8 max-w-[143px] shrink-0 items-center gap-1 rounded-[10px] px-2 text-sm leading-none transition-colors duration-fast',
    isActive
      ? 'bg-border text-foreground'
      : cn(
          'bg-[#F5F6F7] text-foreground hover:bg-muted',
          'dark:bg-muted/50 dark:text-muted-foreground dark:hover:bg-muted/70',
        ),
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

/** 三栏 body 行 col2：拖拽条（须在 {@link stoSplitResizerClass} 之后定义） */
export const stoSplitGridBodyResizerClass = cn(
  'col-start-2 row-start-2 self-stretch',
  stoSplitResizerClass,
);

/** ContentHeader 预览列：☰ + tab 与右侧操作 icon 同一 52px 行内对齐 */
export const contentHeaderPreviewTabsRowClass = cn(
  'flex h-full min-h-0 min-w-0 flex-1 items-center gap-2 overflow-hidden',
);

/** @deprecated 别名 {@link contentHeaderPreviewTabsRowClass} */
export const stoPreviewTabRowClass = contentHeaderPreviewTabsRowClass;

/** ContentHeader 预览列内产物 tab 可滚动区 */
export const contentHeaderPreviewTabsWrapClass = cn(
  'flex h-full min-h-0 min-w-0 flex-1 items-center justify-start gap-2 overflow-x-auto overflow-y-hidden',
);

/** ContentHeader 预览列产物 tab 内按钮（去浏览器默认 padding，避免 pill 偏上） */
export const contentHeaderPreviewArtifactTabBtnClass = cn(
  'inline-flex min-w-0 items-center bg-transparent p-0 font-inherit text-inherit leading-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

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

/**
 * 三栏预览展开时 body 槽：display:contents，子项直接参与 main 统一 grid。
 * 与 {@link stoMainCardBodyClass} 互斥使用。
 */
export const stoMainCardBodySplitClass = stoSplitGridContentsClass;

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

/**
 * Win 省区帧less 壳：为右上角最小化/最大化/关闭留出 no-drag 点击区。
 * drag-region 会吞掉该区域的 pointer event（与 z-index 无关），无 actions 的列表页必须显式预留。
 */
export const contentHeaderWinControlsReserveClass = 'no-drag w-28 shrink-0 self-stretch';

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
  'no-drag flex h-full min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden',
);

/** 三栏 header 右区（预览列宽）：产物 tab + 操作 icon 同一行 */
export const contentHeaderSplitPreviewZoneClass = cn(
  'no-drag flex h-full min-w-0 w-full items-center gap-1 overflow-hidden',
);

/** 三栏 grid 可用宽：main 内容区（统一 grid 唯一量宽基准） */
export function resolveSplitGridContainerWidth(anchorEl: HTMLElement | null): number {
  if (anchorEl === null) return 0;
  const main = anchorEl.closest('main');
  if (main === null) return anchorEl.clientWidth;
  const style = getComputedStyle(main);
  const pl = Number.parseFloat(style.paddingLeft) || 0;
  const pr = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(0, main.clientWidth - pl - pr);
}

/** @deprecated 三栏改用 main {@link stoSplitUnifiedMainClass} + {@link stoSplitGridContentsClass} */
export const contentHeaderSplitBarClass = cn(
  'drag-region box-border w-full min-w-0 shrink-0 overflow-hidden',
  'h-[var(--sto-content-header-h,52px)] min-h-[var(--sto-content-header-h,52px)] max-h-[var(--sto-content-header-h,52px)]',
  'rounded-t-[var(--sto-main-card-radius)] bg-[var(--sto-main-card-bg)]',
  'grid items-center justify-normal gap-x-2',
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

/**
 * 列表页搜索/表单 focus：浅色 Grey-5 描边；暗色 primary 轻 ring。
 * 使用位置：工作流列表搜索、我的任务工具栏（阶段 2 接入 TaskCreateModal）。
 */
export const listSearchFocusClass = cn(
  'focus:outline-none focus:ring-0',
  'focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)]',
  'dark:focus:border-primary/50 dark:focus:shadow-[0_0_0_3px_rgba(255,111,0,0.15)]',
);

/** 下拉/浮层面板阴影：工作流/我的任务排序、SchedulePicker 等 */
export const dropdownPanelShadowClass = cn(
  'shadow-[0_12px_32px_rgba(15,23,42,0.12)]',
  'dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
);

/** 浮动菜单/下拉容器（border + bg-card + 阴影） */
export const dropdownPanelClass = cn('border border-border bg-card', dropdownPanelShadowClass);

/** 下拉面板容器（圆角 12 + padding） */
export const dropdownPanelRoundedClass = cn(
  'rounded-[12px] p-[6px]',
  dropdownPanelClass,
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
  'shadow-[0_6px_24px_rgba(43,17,0,0.03)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.22)]',
);

/** Hero 快捷提示 chip 行 + 手动创建 */
export const workflowHeroQuickPromptsRowClass = 'flex min-w-0 w-full items-center';

/**
 * 工作流 Hero 快捷提示 chip（MasterGo 214:64646 / 组 7063）
 * 白 35% 底 + 白描边 + 12px 圆角 + backdrop-blur；文案 12/14 Regular Grey-9 #4E5969
 */
export const workflowHeroQuickChipClass = cn(
  'shrink-0 whitespace-nowrap rounded-xl border border-white bg-white/35 py-[10px] pl-[14px] pr-4',
  'text-xs font-normal leading-[14px] text-[var(--sto-grey-9)]',
  'shadow-[0_2px_24px_rgba(43,17,0,0.03)] backdrop-blur-[2px]',
  'transition-[background-color,box-shadow] duration-fast hover:bg-white/50',
  'dark:border-white/20 dark:bg-white/10 dark:shadow-[0_2px_24px_rgba(0,0,0,0.22)] dark:hover:bg-white/15',
);

/**
 * 工作流 Hero「手动创建」（MasterGo 214:59127 / 组 7064）
 * 白底 + 12px 圆角 + 轻阴影；icon 16×16 + 文案 12/14 Medium Grey-10 #1D2129；内距 9/14/16
 */
export const workflowHeroManualCreateClass = cn(
  'relative z-[2] box-border inline-flex shrink-0 flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-card',
  'py-[9px] pl-[14px] pr-4 text-xs font-medium leading-[14px] text-foreground',
  'shadow-[0_2px_20px_rgba(0,0,0,0.06)]',
  'transition-[background-color,box-shadow,border-color] duration-fast hover:bg-card/90',
  'dark:border-white/20 dark:bg-white/12 dark:shadow-[0_2px_20px_rgba(0,0,0,0.35)] dark:hover:bg-white/18',
);

/**
 * 工作流页底纹夹层：绝对定位，不占文档流。
 * left/right 负 inset 抵消 MainLayout `<main>` 的 padding + scrollbar-gutter 预留，贴齐主区可视边缘。
 */
export const workflowPageShadingLayerClass =
  'pointer-events-none absolute top-[var(--sto-wf-page-shading-top)] z-0 h-[var(--sto-wf-page-shading-h)] left-[calc(-1*var(--sto-content-pad-x))] right-[calc(-1*var(--sto-content-pad-x)-var(--sto-main-scrollbar-gutter))] overflow-hidden';

/** 底纹平铺层：repeat-x + 与切图像素一致的 background-size，避免多 img 横排亚像素缝 */
export const workflowPageShadingPatternClass =
  'h-full w-full bg-left-top bg-repeat-x bg-[length:var(--sto-wf-page-shading-tile-w)_var(--sto-wf-page-shading-h)] opacity-[var(--sto-wf-page-shading-opacity)]';

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
  listSearchFocusClass,
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
  'flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[18px] bg-card dark:bg-secondary',
  'shadow-[0_0_4px_rgba(0,0,0,0.04)] dark:shadow-glow',
  'transition-[box-shadow] duration-base',
  'hover:shadow-[0_0_16px_rgba(0,0,0,0.06)] dark:hover:shadow-soft',
);

/** 工作流卡片头图：距卡片边框上/左/右 4px（设计稿） */
export const workflowListCardCoverWrapClass = 'px-1 pt-1';

/** 工作流卡片头图内圆角（外框 18px − 内边距 4px） */
export const workflowListCardCoverClass = 'rounded-[14px]';

/** 工作流卡片内容区：描述区与底栏间距 20px（gap-5）；上区 flex-1 吸收同行等高差 */
export const workflowListCardBodyClass =
  'flex flex-1 flex-col gap-5 px-[18px] pt-[13px] pb-4';

/** 工作流卡片主内容区（标题 / 描述 / 节点模块）；标题区与描述间距 4px */
export const workflowListCardMainClass = 'flex min-h-0 flex-1 flex-col gap-1';

/** 工作流卡片底栏：固定距主内容区 20px（由 body gap-5） */
export const workflowListCardFooterClass = 'shrink-0';

/** 标题 + 调度：标题与「每日运行」间距 4px（gap-1） */
export const workflowListCardHeadClass = 'flex flex-col gap-1';

/** 标题行（与右侧开关同一行对齐） */
export const workflowListCardTitleRowClass = 'flex min-w-0 items-center justify-between gap-2';

/** 调度说明行 */
export const workflowListCardScheduleRowClass = 'text-xs text-muted-foreground';

/** 工作流节点灰底区块：描边/底走 CSS 变量，亮暗色在 globals.css 切换 */
export const workflowListCardFlowBlockClass =
  'flex flex-col gap-1.5 rounded-md border border-[var(--sto-wf-flow-block-border)] bg-[var(--sto-wf-flow-block-bg)] px-[10px] py-2 text-xs';

/** 工作流节点标题行（灰底内，带图标） */
export const workflowListCardFlowTitleClass =
  'flex items-center gap-1 font-medium text-foreground';

/** 工作流节点步骤行：换行后行间距 4px；箭头与节点均为独立 flex 子项 */
export const workflowListCardFlowStepsClass = 'flex flex-wrap items-center gap-x-1 gap-y-1';

export const workflowListCardFlowSepClass = 'font-medium leading-snug text-foreground';

export const workflowListCardFlowStepClass =
  'rounded-md bg-card px-2 py-0.5 text-xs leading-snug text-foreground dark:bg-background';

/** 工作流卡片底栏三钮共用圆角 8px（`rounded-lg` = `--radius`） */
export const workflowListCardActionRadiusClass = 'rounded-lg';

/**
 * 工作流卡片底栏操作钮共用面（··· / 编辑流程 / 立即运行）。
 * 暗色卡片为 secondary 底，子钮须透明底 + border，避免 bg-card 与壳层融成「纯色块」。
 */
export const workflowListCardFooterActionSurfaceClass = cn(
  'border border-border bg-transparent text-foreground',
  'transition-[transform,background-color,border-color,color] duration-fast',
  'hover:bg-black/[0.02] dark:hover:bg-white/[0.06]',
);

/** 工作流卡片底栏文字操作钮共用几何 */
export const workflowListCardActionBaseClass = cn(
  workflowListCardActionRadiusClass,
  workflowListCardFooterActionSurfaceClass,
  'inline-flex h-[34px] box-border items-center justify-center px-4 text-[13px] font-medium leading-none',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 工作流卡片底栏主操作钮（立即运行 / 安装） */
export const workflowListCardPrimaryActionClass = workflowListCardActionBaseClass;

/** 工作流卡片底栏次操作钮（编辑流程 / 预览） */
export const workflowListCardSecondaryActionClass = workflowListCardActionBaseClass;

/** 工作流卡片更多菜单钮（···） */
export const workflowListCardMoreActionClass = cn(
  workflowListCardActionRadiusClass,
  workflowListCardFooterActionSurfaceClass,
  'inline-flex h-[34px] w-[34px] box-border items-center justify-center text-muted-foreground',
  'hover:text-foreground active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 工作流卡片 DropdownMenu 内容壳 — Radix portal，层级高于侧栏 sticky */
export const workflowListCardMenuClass = cn(
  'z-[10041] w-[200px] rounded-xl border border-border bg-card p-1.5',
  'shadow-[0_8px_40px_rgba(0,0,0,0.16)] dark:shadow-modal',
);

/** 工作流卡片浮动菜单项 */
export const workflowListCardMenuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted';

/** 工作流详情 / 新建弹窗遮罩（暗色需更高不透明度，否则与页面底融在一起） */
export const workflowDetailModalOverlayClass = cn(
  'bg-black/20 backdrop-blur-[1px]',
  'dark:bg-black/60 dark:backdrop-blur-sm',
);

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

/** 技能广场「使用」：输入框 token / 用户气泡标签（Brand-1 + Brand-6） */
export const skillComposerTagClass = cn(
  'skill-token',
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium align-middle',
  'bg-[rgba(249,115,22,0.12)] text-[#ff6700]',
);

export const skillMessageTagClass = skillComposerTagClass;

/** Composer 技能 Picker 浮层容器（glass + 圆角，对齐 WorkflowPicker） */
export const skillPickerShellClass = cn(
  'absolute left-0 bottom-full z-50 mb-2 w-80 overflow-hidden rounded-2xl border border-glass-border glass p-2',
);

/** 技能 Picker 列表区：最多可见 5 行 + 内部滚动 */
export const skillPickerListClass = 'max-h-[260px] overflow-y-auto';

/** 技能 Picker 列表行 */
export const skillPickerRowClass = cn(
  'flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
  'hover:bg-black/5 dark:hover:bg-white/5',
);

/** 技能 Picker 搜索命中高亮（Brand-6） */
export const skillPickerHighlightClass = 'text-[#FF6F00]';

/** 详情弹窗更多菜单（浮动下拉菜单容器） */
export const workflowDetailModalMenuClass = cn(
  'absolute right-0 top-full z-10 mt-1.5 min-w-[160px] rounded-xl border border-border bg-card p-1.5',
  'shadow-[0_8px_40px_rgba(0,0,0,0.16)] dark:shadow-modal',
);

/** 详情弹窗底栏 */
export const workflowDetailModalFooterClass =
  'sticky bottom-0 flex items-end justify-between gap-2 bg-card px-[18px] py-4';

/** 详情弹窗底栏主钮（立即运行） */
export const workflowDetailModalPrimaryActionClass = cn(
  'h-[34px] rounded-xl px-4 text-sm font-medium',
  invertedPrimarySurfaceClass,
  'transition-[transform,background-color] duration-fast active:scale-[0.98]',
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

/** 新建工作流弹窗遮罩（复用详情弹窗语义） */
export const createWorkflowModalOverlayClass = workflowDetailModalOverlayClass;

/** 新建工作流弹窗内容壳（MasterGo 8:79172 组 7109 — 460×392 / 圆角 18） */
export const createWorkflowModalContentClass = cn(
  'flex w-full max-w-[460px] flex-col overflow-hidden rounded-[18px] bg-card shadow-modal',
  'dark:border dark:border-border',
);

/** 新建工作流弹窗标题区 */
export const createWorkflowModalHeaderClass = 'flex shrink-0 flex-col gap-2 px-4 pt-4';

/** 新建工作流弹窗标题行（标题 + 关闭） */
export const createWorkflowModalTitleRowClass =
  'flex items-start justify-between gap-3';

/** 新建工作流弹窗标题 */
export const createWorkflowModalTitleClass =
  'text-base font-medium leading-5 text-foreground';

/** 新建工作流弹窗副标题 */
export const createWorkflowModalSubtitleClass =
  'text-xs font-normal leading-4 text-muted-foreground';

/** 新建工作流弹窗关闭钮（标题行内 18×18） */
export const createWorkflowModalCloseClass = cn(
  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm',
  'text-foreground transition-colors duration-fast hover:bg-black/[0.04]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/** 新建工作流弹窗表单区 */
export const createWorkflowModalBodyClass =
  'flex flex-col gap-3 px-4 pb-6 pt-2';

/** 新建工作流弹窗字段 label（12px medium） */
export const createWorkflowModalFieldLabelClass =
  'text-xs font-medium leading-[18px] text-foreground';

/** 新建工作流名称输入（42px / 圆角 4px） */
export const createWorkflowModalNameInputClass =
  'h-[42px] rounded-sm px-3 py-2 text-xs leading-[18px]';

/** 新建工作流描述区（含字数统计） */
export const createWorkflowModalDescriptionWrapClass = 'relative';

/** 新建工作流描述输入（60px / 圆角 8px） */
export const createWorkflowModalDescriptionInputClass = cn(
  'min-h-[60px] resize-none rounded-md px-3 py-2 text-xs leading-4',
  'pb-5',
);

/** 新建工作流描述字数（0/50） */
export const createWorkflowModalDescriptionCounterClass =
  'pointer-events-none absolute bottom-2 right-3 text-[10px] leading-[14px] text-[#C9CDD4]';

/** 新建工作流分类下拉（覆盖 Select 默认 h-10/py-2，避免 28px 裁切文字） */
export const createWorkflowModalCategorySelectClass =
  'h-9 rounded-md px-3 py-1.5 text-xs leading-[18px]';

/** 新建工作流弹窗底栏 */
export const createWorkflowModalFooterClass =
  'flex shrink-0 items-center justify-end px-4 py-4';

/** 新建工作流确认钮（#1D2129 底 / 34px / 圆角 12px） */
export const createWorkflowModalConfirmButtonClass = cn(
  'h-[34px] min-w-[60px] rounded-xl px-4 text-sm font-medium',
  invertedPrimarySurfaceClass,
  'transition-[transform,background-color] duration-fast active:scale-[0.98]',
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
 * MasterGo 148:049540 — 工作流完成结果摘要（参数已确认块外独立层级）
 * 14px / 行高 24 / Regular / Grey-10 #1D2129；左对齐、多行自适应高度。
 */
export const workflowResultSummaryClass =
  'w-full text-left text-sm font-normal leading-6 tracking-normal text-foreground whitespace-pre-wrap break-words';

/**
 * 工具调用块外层（规范 §4.4：标题行 + 左竖线内容区）
 */
/** 工具/思考块内标题↔内容间距 6px（MasterGo 4:2177 gap 6px） */
export const chatToolCallShellClass = 'flex w-full flex-col gap-1.5';

/** 工具调用标题行（13px #86909C，图标 16px，标题行 gap 4px） */
export const chatToolCallHeaderBtnClass = cn(
  'flex w-full items-center gap-1 text-left',
  'text-[13px] leading-5 font-normal text-[#86909C] transition-colors duration-150 hover:text-foreground',
);

/** 工具/思考内容区：16px icon 列 + 竖线固定在 icon 中线 */
export const chatProcessIconRailClass = 'relative w-4 shrink-0 self-stretch';
export const chatProcessIconRailLineClass = 'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border';
/** 竖线列与正文间距 4px（正文起点 16+4=20px，与标题文字对齐） */
export const chatProcessContentTextWrapClass = 'min-w-0 flex-1 pl-1';
/** 标题行 chevron/spinner 占位：16px 控件 + gap 4px */
export const chatProcessContentLeadOffsetClass = 'w-5 shrink-0';

/** @deprecated 使用 ChatProcessContentRail；保留别名避免外部引用断裂 */
export const chatProcessContentBorderClass = cn(
  chatProcessContentTextWrapClass,
);

/** 工具入参展开区（竖线由 ChatProcessContentRail 渲染） */
export const chatToolCallContentShellClass = chatProcessContentTextWrapClass;

/** 工具入参正文（规范 §4.4：13px 灰色 pre-wrap） */
export const chatToolCallInputPreClass = cn(
  'm-0 max-h-[min(42vh,400px)] overflow-y-auto whitespace-pre-wrap break-words',
  'text-[13px] leading-5 font-normal text-[#86909C]',
);

/** 思考/工具汇总条标题（MasterGo 4:2177：13/20 #86909C，chevron gap 4px） */
export const chatThinkingSummaryHeaderClass = cn(
  'flex w-full items-center gap-1 py-1 text-left',
  'text-[13px] leading-5 font-normal text-[#86909C]',
  'transition-colors duration-150 hover:text-foreground',
);

/** 分段思考栈内一级摘要：与 phase-text 间距由外层 gap-3（12px）控制，去掉 py-1 避免视觉超出 12px */
export const chatThinkingSegmentSummaryHeaderClass = cn(
  chatThinkingSummaryHeaderClass,
  'py-0',
);

/** 思考/工具过程次要正文（规范 §4.3 / §4.4 内容区） */
export const chatProcessSecondaryTextClass = 'text-[13px] leading-5 font-normal text-[#86909C]';

/** Loading 等待文案（chat-interaction-style-spec §2.1 text-muted / §4.6） */
export const chatProcessLoadingTextClass = 'text-[13px] leading-[18px] font-normal text-[#6B737D]';

/** 过程块标题行（MasterGo 4:2177：icon 16px + 文案，gap 4px） */
export const chatProcessTitleRowClass = cn(
  'flex items-center gap-1',
  chatProcessSecondaryTextClass,
);

/**
 * 工作流编辑器：抵消 main 内距，占满主区可视高度（TitleBar + main py 合计）。
 */
export const workflowBuilderShell = cn(
  '-mx-[var(--sto-content-pad-x)] -mt-5 flex min-h-0 min-w-0 flex-col',
  stoPageFillBelowTitleClass,
);

/**
 * MC iframe 工作流编辑：顶栏由 useWorkflowEditorContentHeader 注入 ContentHeader；
 * 仅抵消水平 main 内距，iframe 占满 ContentHeader 下方剩余高度。
 */
export const workflowMcEditorShell = cn(
  '-mx-[var(--sto-content-pad-x)] flex min-h-0 min-w-0 flex-1 flex-col',
);

/**
 * 侧栏文字色 — MasterGo 8:46454「调整标题颜色+任务icon」（MCP goto/U0JBJlCx）。
 * 规范见 `.cursor/rules/02-styles.mdc` §侧栏文字色。
 */

/** 侧栏正文 14/20 Regular — MCP font_4:0587 / font_4:0607 / font_8:35114（默认态） */
export const sidebarBodyTextClass = 'text-sm font-normal leading-5';

/** 侧栏正文 14/20 Medium — 仅设计稿明确标注 font_8:34896 的场景（当前侧栏默认不用，保留供后续态） */
export const sidebarBodyTextMediumClass = 'text-sm font-medium leading-5';

/** 一级正文色 Grey-10 #1D2129 — MCP paint_4:0441「文字/文本-默认」 */
export const sidebarTextDefaultClass = 'text-[var(--sto-sidebar-text-default)]';

/** 行内图标色 Grey-9 #4E5969 — MCP paint_4:0490「文字/文本-浅色-二级信息」 */
export const sidebarTextIconClass =
  'text-[var(--sto-sidebar-text-icon)] [&_svg]:stroke-[var(--sto-sidebar-text-icon)]';

/** 三级文字 Grey-8 #86909C — MCP paint_4:0520「文字/文本-更浅-三级信息」 */
export const sidebarTextSectionClass = 'text-[var(--sto-sidebar-text-section)]';

/** 品牌头版本号 — Grey-8，MCP font_8:49208（SF Pro 11px）；相对 logo 基线下移 6px */
export const sidebarBrandVersionClass = cn(
  'mt-1.5 text-[11px] leading-[13px]',
  sidebarTextSectionClass,
);

/** 侧栏字 logo 尺寸 — 暗色用 sidebar-logo-dark.svg（sidebar-brand-header.tsx 按 theme 切换） */
export const sidebarBrandLogoClass = 'sto-sidebar-brand-logo';

/** 分区标题（任务 / 最近 / 工作台）默认 Grey-8 Regular；hover/focus → Grey-10 Regular（字重不变） */
export const sidebarSectionLabelClass = cn(
  sidebarBodyTextClass,
  sidebarTextSectionClass,
  'group-hover/sto-sidebar-section-toggle:text-[var(--sto-sidebar-text-default)]',
  'group-focus-within/sto-sidebar-section-toggle:text-[var(--sto-sidebar-text-default)]',
);

/** 分区标题 chevron — 跟随分区标题色态 */
export const sidebarSectionChevronClass = cn(
  'shrink-0 transition-colors',
  sidebarTextSectionClass,
  'group-hover/sto-sidebar-section-toggle:text-[var(--sto-sidebar-text-default)]',
  'group-focus-within/sto-sidebar-section-toggle:text-[var(--sto-sidebar-text-default)]',
);

/**
 * 侧栏滚动区内分区标题 sticky 壳层 — §5.6 吸顶 + 实底盖住下方列表（无描边）。
 * 任务 top-0；分组·最近同 top 接力（z 分组 19 > 最近 18，section 内分组压住最近，滚出后最近接管）。
 */
export const sidebarSectionStickyShellClass = cn(
  'sticky bg-[var(--sto-sidebar-bg)]',
);

/** 任务分区 sticky 锚点 */
export const sidebarSectionStickyTopTaskClass = 'top-0 z-20';

/** 自建分组 sticky 锚点 — 与「最近」同 top 接力；section 内 z 高于最近，滚出本组后释放 */
export const sidebarSectionStickyTopGroupClass =
  'top-[var(--sto-sidebar-section-sticky-h)] z-[19]';

/** 最近分区 sticky 锚点 — 叠在任务标题下方；无活跃分组 section 时显示于同 top 层 */
export const sidebarSectionStickyTopRecentClass =
  'top-[var(--sto-sidebar-section-sticky-h)] z-[18]';

/** 侧栏滚动列表 — 层级低于 sticky 分区标题 */
export const sidebarScrollListClass = 'relative z-0';

/** 侧栏中部滚动区（classic 滚动条见 globals.css `html[data-scrollbar-layout=classic]`） */
export const sidebarScrollContainerClass = cn(
  'sidebar-scroll-container',
  'flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-y-contain',
);

/** 展开侧栏主导航 idle — 正文 Grey-10 + 图标 Grey-9 */
export const sidebarNavExpandedIdleClass = cn(
  'h-9 min-h-9 rounded-[8px] px-[10px] font-normal leading-5',
  sidebarTextDefaultClass,
  '[&_svg]:stroke-[var(--sto-sidebar-text-icon)]',
  'hover:bg-[var(--sto-sidebar-row-hover-bg)]',
);

/** 展开侧栏主导航 active — 底 #DCDCDC + Regular（选中仅靠底色，字重与 idle 一致） */
export const sidebarNavExpandedActiveClass = cn(
  'h-9 min-h-9 rounded-[8px] px-[10px] font-normal leading-5 shadow-none',
  'bg-[var(--sto-sidebar-nav-active-bg)]',
  sidebarTextDefaultClass,
  '[&_svg]:stroke-[var(--sto-sidebar-text-icon)]',
  'hover:bg-[var(--sto-sidebar-row-hover-bg)]',
);

/** 任务组名 / 最近会话 / 三级子项 — Grey-10 Regular */
export const sidebarListItemTextClass = cn(sidebarBodyTextClass, sidebarTextDefaultClass);

/** 三级子项 idle — Grey-10 Regular */
export const sidebarSubitemTextIdleClass = cn(
  sidebarListItemTextClass,
  'hover:bg-[var(--sto-sidebar-row-hover-bg)]',
);

/** 三级子项路由选中 — Grey-10 Regular + Grey-4 底（MCP 子项无加粗） */
export const sidebarSubitemTextActiveClass = cn(
  sidebarBodyTextClass,
  sidebarTextDefaultClass,
  'bg-[var(--sto-sidebar-subitem-active-bg)]',
);

/** 「展开全部 / 显示更多」等辅助链 — 12px Regular Grey-8 → hover Grey-10 */
export const sidebarMetaLinkClass = cn(
  'text-xs font-normal',
  sidebarTextSectionClass,
  'transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)] hover:text-[var(--sto-sidebar-text-default)]',
);

/** 侧栏底部账号名 — MCP 8:46481 / 14px Regular（视觉与列表项一致） */
export const sidebarFooterNameClass =
  'truncate text-sm font-normal leading-[18px] text-[var(--sto-sidebar-footer-name)]';

/** 侧栏底部账号元信息 — MCP 8:46481 #8B9099 Grey-6 / 13px Regular */
export const sidebarFooterMetaClass =
  'truncate text-[13px] font-normal leading-[18px] text-[var(--sto-sidebar-footer-meta)]';

/** 侧栏底部设置图标 — Grey-9 */
export const sidebarFooterSettingsIconClass = cn('h-5 w-5 shrink-0', sidebarTextIconClass);

/** 最近会话运行中 spinner — MasterGo #5F9274 */
export const sidebarRunningSpinnerClass = 'text-[var(--sto-sidebar-running-spinner)]';

/** 侧栏未读红点 — 6×6px，destructive */
export const sidebarUnreadDotClass = 'h-1.5 w-1.5 shrink-0 rounded-full bg-destructive';

/** 最近分组内会话选中底 — light #DCDCDC；dark 走 --sto-sidebar-subitem-active-bg */
export const sidebarRecentSessionActiveClass = 'bg-[var(--sto-sidebar-subitem-active-bg)]';

/** 最近会话/分组下拉 — MCP 140px 菜单容器 */
export const sidebarRecentMenuContentClass =
  'min-w-[140px] rounded-lg border border-border bg-card p-1 shadow-[0_4px_12px_rgba(0,0,0,0.1)]';

/** 最近会话/分组下拉项 — MCP 132×34；hover 走 muted，light/dark 自适应 */
export const sidebarRecentMenuItemClass = cn(
  'flex h-[34px] cursor-pointer select-none items-center gap-1 rounded-md px-2 text-sm leading-[18px] text-foreground outline-none',
  'focus:bg-muted data-[highlighted]:bg-muted data-[state=open]:bg-muted',
);

/** 最近会话下拉删除项 hover — destructive 浅底 + 字/图标 */
export const sidebarRecentMenuDeleteItemClass = cn(
  sidebarRecentMenuItemClass,
  'focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
  '[&_svg]:text-[var(--sto-sidebar-text-icon)] focus:[&_svg]:text-destructive data-[highlighted]:[&_svg]:text-destructive',
);

/** 最近分组子菜单分隔 — 走 border token，light/dark 自适应 */
export const sidebarRecentMenuDividerClass = '-mx-1 my-1 h-px bg-border';

/** 分组/最近空态行 — MCP Grey-5 #C9CDD4 */
export const sidebarRecentEmptyLineClass = cn(
  sidebarBodyTextClass,
  'px-[10px] py-2 text-[#C9CDD4]',
);
