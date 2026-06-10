/**
 * TaskEmptyState 组件
 * 定时任务空状态：无任务时显示推荐卡片，搜索无结果时显示提示
 * 对应原型 .task-center-empty
 */

import listEmptyIcon from '@/assets/task-list-empty-icon.png';
import searchEmptyIcon from '@/assets/task-search-empty-icon.png';
import { RECOMMEND_TASKS } from '../constants';
import type { RecommendTask } from '../types';

interface TaskEmptyStateProps {
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 新建任务回调 */
  onCreate: () => void;
  /** 推荐任务添加回调 */
  onRecommendAdd: (task: RecommendTask) => void;
}

export function TaskEmptyState({ searchQuery, onCreate, onRecommendAdd }: TaskEmptyStateProps) {
  // 搜索无结果
  if (searchQuery) {
    return (
      <div className="flex flex-col items-start w-full">
        <div className="flex flex-col items-center justify-start gap-1.5 w-full py-8 pb-6">
          <img
            src={searchEmptyIcon}
            alt=""
            width="120"
            height="120"
            decoding="async"
            className="block w-[min(120px,32vw)] h-auto mb-0.5 select-none pointer-events-none"
          />
          <h2 className="m-0 text-[18px] font-semibold leading-[1.4] text-foreground text-center">
            未找到匹配的任务
          </h2>
        </div>
      </div>
    );
  }

  // 完全无任务：显示推荐卡片
  return (
    <div className="flex flex-col items-start justify-start w-full flex-1">
      {/* 空状态头部 */}
      <div className="flex flex-col items-center justify-start gap-1.5 w-full py-8 pb-6">
        <img
          src={listEmptyIcon}
          alt=""
          width="120"
          height="120"
          decoding="async"
          className="block w-[min(120px,32vw)] h-auto mb-0.5 select-none pointer-events-none"
        />
        <h2 className="m-0 text-[18px] font-semibold leading-[1.4] text-foreground text-center">
          无定时任务
        </h2>
        <p className="m-0 max-w-[420px] text-sm font-normal leading-[1.5] text-muted-foreground text-center">
          创建定时任务来自动化执行周期性 AI 代理工作
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="mt-1.5 mb-0 inline-flex items-center justify-center gap-1.5 h-[34px] px-[14px] text-sm font-semibold rounded-lg bg-[#111] text-white shadow-[0_2px_10px_rgba(0,0,0,0.15)] hover:brightness-[1.08] active:brightness-[0.96] transition-[background,box-shadow,filter] duration-75"
        >
          + 新建定时任务
        </button>
      </div>

      {/* 推荐任务网格 */}
      <div className="w-full shrink-0 self-stretch mt-auto">
        <div
          role="list"
          aria-label="推荐任务"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[clamp(12px,1.4vw,16px)]"
        >
          {RECOMMEND_TASKS.map((task, i) => (
            <article
              key={i}
              role="listitem"
              className="flex flex-col min-w-0 p-[14px_16px] border border-border rounded-[var(--radius-lg,12px)] bg-[var(--white,#fff)] cursor-pointer transition-[border-color,box-shadow] duration-75 hover:border-[#dfe2e8] hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)]"
            >
              <div className="flex items-start gap-2 mb-2">
                <svg
                  className="shrink-0 mt-px text-muted-foreground"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <h2 className="m-0 flex-1 min-w-0 text-[15px] font-bold tracking-[-0.02em] leading-[1.35] text-foreground">
                  {task.title}
                </h2>
              </div>
              <p className="m-0 mb-3 flex-1 text-[13px] leading-[1.5] text-muted-foreground line-clamp-2">
                {task.desc}
              </p>
              <div className="flex items-center justify-between gap-3 mt-auto pt-2.5 border-t border-border text-xs">
                <span className="inline-flex items-center min-w-0 text-muted-foreground font-normal leading-[1.4]">
                  {task.schedule}
                </span>
                <button
                  type="button"
                  onClick={() => onRecommendAdd(task)}
                  className="inline-flex items-center justify-center min-h-[28px] px-2.5 border-none rounded-lg bg-[#f0f1f3] text-xs font-medium text-foreground cursor-pointer transition-[background,color] duration-75 hover:bg-[#e6e8ec]"
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