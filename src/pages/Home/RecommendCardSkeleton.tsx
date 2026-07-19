import { cn } from '@/lib/utils';
import {
  homeHubInteractiveCardShellClass,
  homeHubCardBodyRegionClass,
  homeHubCardFooterRegionClass,
} from './home-hub-surface-styles';

/** 推荐卡片骨架屏：与 RecommendCard 结构对齐（标题行 + 描述区 + 头像底栏） */
export function RecommendCardSkeleton() {
  return (
    <div className={homeHubInteractiveCardShellClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" />
            <span className="inline-block h-4 w-8 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className={homeHubCardBodyRegionClass}>
        <span className="inline-block h-3 w-full animate-pulse rounded bg-muted" />
        <span className="mt-1.5 inline-block h-3 w-3/4 animate-pulse rounded bg-muted" />
      </div>
      <div className={cn(homeHubCardFooterRegionClass, 'border-t-0')}>
        <span className="inline-block h-8 w-8 animate-pulse rounded-full bg-muted" />
        <span className="inline-block h-8 w-8 animate-pulse rounded-full bg-muted" />
        <span className="inline-block h-8 w-8 animate-pulse rounded-full bg-muted" />
        <span className="min-w-0 flex-1 inline-block h-3 w-16 animate-pulse rounded bg-muted" />
        <span className="inline-block h-3 w-20 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

/** 骨架屏占位组：默认渲染 3 个 RecommendCardSkeleton */
export function RecommendCardSkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <RecommendCardSkeleton key={i} />
      ))}
    </>
  );
}
 