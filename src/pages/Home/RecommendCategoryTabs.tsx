/**
 * 首页推荐类别胶囊 Tab：直接使用接口 categories，
 * 选中后按 category.code 与条目 recommend_category 精确匹配过滤。
 */
import { cn } from '@/lib/utils';
import type { RecommendCategory } from '@/lib/recommend-api';

interface RecommendCategoryTabsProps {
  categories: RecommendCategory[];
  value: string;
  onChange: (code: string) => void;
}

export function RecommendCategoryTabs({
  categories,
  value,
  onChange,
}: RecommendCategoryTabsProps) {
  if (categories.length === 0) return null;

  return (
    <div
      className="mb-[18px] inline-flex h-9 items-center justify-center gap-2 rounded-[10px] bg-[#EDEDED] p-1 dark:bg-muted"
      role="tablist"
      aria-label="推荐类别"
    >
      {categories.map((tab) => {
        const active = value === tab.code;
        return (
          <button
            key={tab.code}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              'inline-flex h-7 items-center justify-center rounded-lg px-3 py-1.5 text-sm leading-[18px] transition-colors',
              active
                ? 'bg-[#1D2129] font-medium text-white dark:bg-foreground dark:text-background'
                : 'font-normal text-[#4E5969] dark:text-muted-foreground',
            )}
            onClick={() => onChange(tab.code)}
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
