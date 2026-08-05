import { useContentHeaderLayoutMode } from '@/components/layout/content-header-context';
import { cn } from '@/lib/utils';
import { stoSplitGridContentsClass } from '@/lib/surfaces';

/** 双栏 / expanded：填满 Workspace；去掉叠加在 Header 下的结构 pt */
const conversationShellClass =
  'mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden';

/**
 * 三栏统一 grid 时，outlet 到 split row 之间的壳层须 display:contents，
 * 否则对话/预览列无法成为 main grid 的 row2 子项（表现为三栏空白）。
 * Preview expanded 使用 flex 填满，不使用 contents，也不叠加 pt。
 */
export function useSplitGridPassthroughClass(enabled = true) {
  const layoutMode = useContentHeaderLayoutMode();
  const isSplitLayout = layoutMode === 'split';
  const isSplitGridPassthrough = enabled && isSplitLayout;
  const isPreviewExpanded = enabled && layoutMode === 'preview-expanded';

  const splitGridPassthroughClass = isSplitGridPassthrough
    ? stoSplitGridContentsClass
    : isPreviewExpanded
      ? conversationShellClass
      : enabled
        ? conversationShellClass
        : undefined;

  return {
    isSplitGridPassthrough,
    isPreviewExpandedLayout: isPreviewExpanded,
    /** Stage 3：统一壳层 class（split=contents；其余=flex 填满无结构 pt） */
    splitGridPassthroughClass: enabled
      ? cn(splitGridPassthroughClass)
      : undefined,
  };
}
