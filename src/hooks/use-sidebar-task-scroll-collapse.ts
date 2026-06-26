import { useEffect, useRef, type RefObject } from 'react';

export interface UseSidebarTaskScrollCollapseOptions {
  /** 侧栏展开且任务区展开时才监听 */
  enabled: boolean;
  taskListSectionOpen: boolean;
  /** 侵入吸顶区时收起任务列表（不自动展开） */
  onCollapseTaskSection: () => void;
}

export interface UseSidebarTaskScrollCollapseResult {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  taskSectionHeaderRef: RefObject<HTMLDivElement | null>;
  /** 放在「任务」列表与「最近」标题之间，用于检测最近区上滚 */
  recentSectionSentinelRef: RefObject<HTMLDivElement | null>;
}

/**
 * 「最近」上滚进入「任务」sticky 标题区时自动收起任务列表。
 *
 * 不自动重新展开；手风琴 expandedTaskGroupKey 不受影响。
 *
 * @see docs/侧边栏改造-任务与最近.md §5.6
 */
export function useSidebarTaskScrollCollapse({
  enabled,
  taskListSectionOpen,
  onCollapseTaskSection,
}: UseSidebarTaskScrollCollapseOptions): UseSidebarTaskScrollCollapseResult {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const taskSectionHeaderRef = useRef<HTMLDivElement>(null);
  const recentSectionSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !taskListSectionOpen) return;

    const container = scrollContainerRef.current;
    const taskHeader = taskSectionHeaderRef.current;
    const sentinel = recentSectionSentinelRef.current;
    if (!container || !taskHeader || !sentinel) return;

    let rafId = 0;

    const check = () => {
      if (!taskListSectionOpen) return;

      const containerRect = container.getBoundingClientRect();
      const taskHeaderRect = taskHeader.getBoundingClientRect();
      const sentinelRect = sentinel.getBoundingClientRect();

      // 任务标题已吸顶（相对滚动容器顶端）
      const isTaskHeaderStuck = taskHeaderRect.top <= containerRect.top + 1;
      if (!isTaskHeaderStuck) return;

      const stickyBottom = containerRect.top + taskHeaderRect.height;
      if (sentinelRect.top <= stickyBottom + 0.5) {
        onCollapseTaskSection();
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(check);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [enabled, taskListSectionOpen, onCollapseTaskSection]);

  return {
    scrollContainerRef,
    taskSectionHeaderRef,
    recentSectionSentinelRef,
  };
}
