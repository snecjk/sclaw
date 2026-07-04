import { cn } from '@/lib/utils';

/** 无外层卡片：思考过程直接铺在对话区底色上 */
export const thinkingPanelRootClass = 'w-full';

/** 一级摘要 / phase-text / loading 之间垂直间距（MasterGo 图二：12px） */
export const thinkingProcessSegmentStackClass = 'flex flex-col gap-3';

/** chat-interaction-style-spec §5.6：高度 0↔auto，300ms ease */
export function thinkingPanelBodyGridClass(expanded: boolean, animate: boolean): string {
  return cn(
    'grid transition-[grid-template-rows]',
    animate ? 'duration-300 ease-[ease]' : 'transition-none',
    expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
  );
}

/** §5.6 / §6.2：箭头 200ms ease；收起向下，展开向上（rotate-180） */
export function thinkingPanelChevronClass(expanded: boolean, animate: boolean): string {
  return cn(
    'h-3.5 w-3.5 shrink-0 opacity-70 transition-transform',
    animate ? 'duration-200 ease-[ease]' : 'transition-none',
    expanded && 'rotate-180',
  );
}
