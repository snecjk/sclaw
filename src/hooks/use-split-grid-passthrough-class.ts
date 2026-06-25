import { useContentHeaderDisplay } from '@/components/layout/content-header-context';
import { stoSplitGridContentsClass } from '@/lib/surfaces';

/**
 * 三栏统一 grid 时，Outlet 到 split row 之间的壳层须 display:contents，
 * 否则对话/预览列无法成为 main grid 的 row2 子项（表现为三栏空白）。
 */
export function useSplitGridPassthroughClass(enabled = true) {
  const { isSplitLayout } = useContentHeaderDisplay();
  const isSplitGridPassthrough = enabled && isSplitLayout;

  return {
    isSplitGridPassthrough,
    splitGridPassthroughClass: isSplitGridPassthrough ? stoSplitGridContentsClass : undefined,
  };
}
