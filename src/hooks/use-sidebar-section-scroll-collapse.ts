import { useEffect, useRef, type RefObject } from 'react';

export interface UseSidebarSectionScrollCollapseOptions {
  /** 侧栏展开时才监听 */
  enabled: boolean;
  projectsSectionOpen: boolean;
  taskListSectionOpen: boolean;
  /** 任务标题到达项目 sticky 下沿时收起项目模块（不清空组展开 map） */
  onCollapseProjectsSection: () => void;
  /** 最近 sentinel 到达任务 sticky 下沿时收起任务模块 */
  onCollapseTaskSection: () => void;
}

export interface UseSidebarSectionScrollCollapseResult {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  projectSectionHeaderRef: RefObject<HTMLDivElement | null>;
  taskSectionHeaderRef: RefObject<HTMLDivElement | null>;
  /** 放在「任务」列表与「最近」标题之间 */
  recentSectionSentinelRef: RefObject<HTMLDivElement | null>;
}

/**
 * 三级 sticky 滚动自动收起：
 * - 任务标题越过项目 sticky 下沿 → 收起项目模块（一次越界一次）
 * - 最近 sentinel 越过任务 sticky 下沿 → 收起任务模块（一次越界一次）
 *
 * 不清除组展开 map；手动展开后的 suppress 由调用方负责。
 */
export function useSidebarSectionScrollCollapse({
  enabled,
  projectsSectionOpen,
  taskListSectionOpen,
  onCollapseProjectsSection,
  onCollapseTaskSection,
}: UseSidebarSectionScrollCollapseOptions): UseSidebarSectionScrollCollapseResult {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const projectSectionHeaderRef = useRef<HTMLDivElement>(null);
  const taskSectionHeaderRef = useRef<HTMLDivElement>(null);
  const recentSectionSentinelRef = useRef<HTMLDivElement>(null);

  // 越界边沿：仅 false→true 触发，避免 scroll 高频 setState
  const projectsPastRef = useRef(false);
  const tasksPastRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      projectsPastRef.current = false;
      tasksPastRef.current = false;
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId = 0;

    const check = () => {
      const projectHeader = projectSectionHeaderRef.current;
      const taskHeader = taskSectionHeaderRef.current;
      const sentinel = recentSectionSentinelRef.current;
      const containerRect = container.getBoundingClientRect();

      if (projectsSectionOpen && projectHeader && taskHeader) {
        const projectRect = projectHeader.getBoundingClientRect();
        const taskRect = taskHeader.getBoundingClientRect();
        const projectStickyBottom = Math.max(
          containerRect.top + projectRect.height,
          projectRect.bottom,
        );
        const past = taskRect.top <= projectStickyBottom + 0.5;
        if (past && !projectsPastRef.current) {
          onCollapseProjectsSection();
        }
        projectsPastRef.current = past;
      } else {
        projectsPastRef.current = false;
      }

      if (taskListSectionOpen && taskHeader && sentinel) {
        const taskRect = taskHeader.getBoundingClientRect();
        const sentinelRect = sentinel.getBoundingClientRect();
        const taskStickyBottom = Math.max(containerRect.top + taskRect.height, taskRect.bottom);
        // 项目仍打开时任务 sticky 在下方，用真实 bottom 更稳
        const past = sentinelRect.top <= taskStickyBottom + 0.5;
        if (past && !tasksPastRef.current) {
          onCollapseTaskSection();
        }
        tasksPastRef.current = past;
      } else {
        tasksPastRef.current = false;
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
  }, [
    enabled,
    projectsSectionOpen,
    taskListSectionOpen,
    onCollapseProjectsSection,
    onCollapseTaskSection,
  ]);

  return {
    scrollContainerRef,
    projectSectionHeaderRef,
    taskSectionHeaderRef,
    recentSectionSentinelRef,
  };
}
