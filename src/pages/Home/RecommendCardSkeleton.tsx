import { homeHubInteractiveCardShellClass } from './home-hub-surface-styles';

/** 推荐卡片骨架屏：与精简 RecommendCard（标题 + 描述）对齐 */
export function RecommendCardSkeleton() {
  return (
    <div className={homeHubInteractiveCardShellClass}>
      <span className="inline-block h-4 w-32 animate-pulse rounded bg-muted" />
      <span className="mt-2 inline-block h-3 w-full animate-pulse rounded bg-muted" />
      <span className="mt-1.5 inline-block h-3 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}

/** 骨架屏占位组：默认渲染 4 个 RecommendCardSkeleton */
export function RecommendCardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <RecommendCardSkeleton key={i} />
      ))}
    </>
  );
}
