import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** chat-interaction-style-spec §5.6：高度 0↔auto，300ms ease */
export function chatProcessBlockBodyCollapseGridClass(expanded: boolean, animate: boolean) {
  return cn(
    'grid transition-[grid-template-rows]',
    animate ? 'duration-300 ease-[ease]' : 'transition-none',
    expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
  );
}

/** §5.6 / §6.2：箭头 200ms ease；收起向下，展开向上（rotate-180） */
export function chatProcessBlockChevronClass(expanded: boolean, animate: boolean) {
  return cn(
    'h-3.5 w-3.5 shrink-0 opacity-70 transition-transform',
    animate ? 'duration-200 ease-[ease]' : 'transition-none',
    expanded && 'rotate-180',
  );
}

export interface UseProcessBlockCollapseOptions {
  /** 是否启用二级折叠（思考面板内思考/工具块） */
  collapsible: boolean;
  /** 该段已结束 → 自动收起（优先级高于 autoExpand） */
  isComplete: boolean;
  /** 流式进行中且未完成 → 自动展开 */
  autoExpand: boolean;
  /** 首次渲染时是否展开；默认沿用“未完成即展开”的现有行为 */
  defaultExpanded?: boolean;
  /** 展开时滚入视口（§5.5） */
  scrollOnExpand?: boolean;
}

/**
 * useProcessBlockCollapse — 思考/工具过程块二级折叠
 *
 * 对齐 sai-desktop ChartMessageThinking / ChartMessageToolCollapsible：
 * isComplete 强制收起；autoExpand 时展开；支持手动 toggle。
 */
export function useProcessBlockCollapse({
  collapsible,
  isComplete,
  autoExpand,
  defaultExpanded,
  scrollOnExpand = true,
}: UseProcessBlockCollapseOptions) {
  const [expanded, setExpanded] = useState(() => defaultExpanded ?? !isComplete);
  const [collapseAnimationEnabled, setCollapseAnimationEnabled] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCollapseAnimationEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!collapsible) return;
    if (isComplete) {
      setExpanded(false);
      return;
    }
    if (autoExpand) {
      setExpanded(true);
    }
  }, [collapsible, isComplete, autoExpand]);

  useEffect(() => {
    if (!collapsible || !scrollOnExpand || !expanded) return;
    wrapperRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [collapsible, scrollOnExpand, expanded]);

  const toggle = () => {
    if (!collapsible) return;
    setExpanded((value) => !value);
  };

  return {
    wrapperRef,
    expanded: collapsible ? expanded : true,
    collapseAnimationEnabled,
    toggle,
    bodyGridClass: chatProcessBlockBodyCollapseGridClass(
      collapsible ? expanded : true,
      collapseAnimationEnabled,
    ),
    chevronClass: chatProcessBlockChevronClass(
      collapsible ? expanded : true,
      collapseAnimationEnabled,
    ),
  };
}
