import { Clock, Plus } from 'lucide-react';

interface RecommendTask {
  title: string;
  desc: string;
  schedule: string;
}

interface CronTaskEmptyStateProps {
  searchQuery: string;
  onCreate: () => void;
  onRecommendAdd: (task: RecommendTask) => void;
}

export function CronTaskEmptyState({ searchQuery, onCreate }: CronTaskEmptyStateProps) {
  // Search no results
  if (searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg className="text-muted-foreground/40 mb-4" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" strokeLinecap="round" />
        </svg>
        <h3 className="text-base font-medium text-foreground mb-1">未找到匹配的任务</h3>
        <p className="text-[13px] text-muted-foreground">
          试试其他关键词，或创建一个新任务
        </p>
      </div>
    );
  }

  // Completely empty
  return (
    <div className="flex flex-col items-center py-10">
      {/* Empty Head */}
      <div className="text-center mb-8">
        <div className="w-[120px] h-[120px] mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
          <Clock className="h-12 w-12 text-muted-foreground/40" strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1">暂无定时任务</h2>
        <p className="text-[13px] text-muted-foreground mb-5">
          创建定时任务来自动化执行周期性 AI 代理工作
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          新建定时任务
        </button>
      </div>

      {/* Recommend Grid */}
      <div className="w-full">
        <p className="text-[13px] text-muted-foreground mb-3">推荐任务</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {RECOMMEND_TASKS.map((task, i) => (
            <article
              key={i}
              className="flex flex-col rounded-xl border border-border bg-background p-4 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
            >
              <div className="flex items-start gap-2.5 mb-2">
                <Clock className="h-[18px] w-[18px] text-primary shrink-0 mt-0.5" strokeWidth={1.75} />
                <h3 className="text-[14px] font-semibold text-foreground">{task.title}</h3>
              </div>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-4 flex-1 line-clamp-3">
                {task.desc}
              </p>
              <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/60">
                <span className="text-[12px] text-muted-foreground font-medium">{task.schedule}</span>
                <button
                  type="button"
                  onClick={() => onRecommendAdd(task)}
                  className="text-[12.5px] px-3 py-1.5 rounded-lg border border-border bg-background text-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  添加
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export type { RecommendTask };
