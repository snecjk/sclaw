import type { RecommendItem } from '@/lib/recommend-api';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';

export type RecommendTaskPrefill = {
  name: string;
  message?: string;
  composerSegments?: PersistedComposerSegment[];
};

/** 由推荐卡片生成创建弹窗预填：标题 → 任务名称；有 segments 则真混排，否则描述 → 任务描述 */
export function buildRecommendTaskPrefill(item: RecommendItem): RecommendTaskPrefill {
  const name = (item.title || '').trim();
  if (item.composer_segments?.length) {
    return {
      name,
      composerSegments: item.composer_segments as PersistedComposerSegment[],
    };
  }
  return {
    name,
    message: (item.description || '').trim(),
  };
}
