import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';
import { timelineBlockResetKey } from '@/lib/thinking-timeline-active';

/**
 * useSequentialTypewriterQueue — 流式思考/工具块按序打字，避免后续块一次性闪出
 *
 * Gateway 批量追加多块时，仅当前队列头块启用打字机；完成后才展示下一块。
 * enableTypewriter=false（历史 / 重进已生成内容）→ 全部 instant 展示。
 */
export function useSequentialTypewriterQueue(
  timeline: ThinkingTimelineItem[],
  enableTypewriter: boolean,
) {
  const [finishedKeys, setFinishedKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enableTypewriter) {
      setFinishedKeys(new Set());
    }
  }, [enableTypewriter]);

  const sequentialIndex = useMemo(() => {
    if (!enableTypewriter) return null;
    for (let i = 0; i < timeline.length; i += 1) {
      const key = timelineBlockResetKey(timeline[i], i);
      if (!finishedKeys.has(key)) return i;
    }
    return null;
  }, [enableTypewriter, timeline, finishedKeys]);

  const markBlockRevealFinished = useCallback((key: string) => {
    setFinishedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const getBlockRevealState = useCallback(
    (index: number, resetKey: string) => {
      if (!enableTypewriter) {
        return { isVisible: true, isTypewriterActive: false, isRevealFinished: true };
      }
      if (finishedKeys.has(resetKey)) {
        return { isVisible: true, isTypewriterActive: false, isRevealFinished: true };
      }
      if (sequentialIndex === null) {
        return { isVisible: true, isTypewriterActive: false, isRevealFinished: true };
      }
      if (index < sequentialIndex) {
        return { isVisible: true, isTypewriterActive: false, isRevealFinished: true };
      }
      if (index > sequentialIndex) {
        return { isVisible: false, isTypewriterActive: false, isRevealFinished: false };
      }
      return { isVisible: true, isTypewriterActive: true, isRevealFinished: false };
    },
    [finishedKeys, enableTypewriter, sequentialIndex],
  );

  return { markBlockRevealFinished, getBlockRevealState, sequentialIndex };
}
