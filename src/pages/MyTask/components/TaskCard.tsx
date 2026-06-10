/**
 * TaskCard 组件
 * 单个定时任务卡片
 * 对应原型 .task-card
 */

import { useState, useRef, useEffect } from 'react';
import { Clock, Play, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseScheduleToLabel } from '@/lib/schedule-label';
import type { TaskViewModel } from '../types';

/** TaskCard 接收的任务数据 */
interface TaskCardData extends TaskViewModel {
  /** 人类可读的计划时间文本（可选，缺省显示 cronExpr） */
  scheduleText?: string;
}

interface TaskCardProps {
  /** 任务数据 */
  task: TaskCardData;
  /** 编辑任务回调 */
  onEdit?: (task: TaskCardData) => void;
  /** 删除任务回调 */
  onDelete?: (task: TaskCardData) => void;
  /** 立即运行回调 */
  onRun?: (task: TaskCardData) => void;
  /** 开关切换回调 */
  onToggle?: (enabled: boolean) => void;
  /** 点击卡片回调（编辑） */
  onClick?: (task: TaskCardData) => void;
}

export function TaskCard({ task, onEdit, onDelete, onRun, onToggle, onClick }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const handleCardClick = (e: React.MouseEvent) => {
    // 如果点击的是按钮或菜单内部，不触发卡片点击
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-menu]')) return;
    onClick?.(task);
  };

  return (
    <article
      className={cn(
        'flex flex-col min-w-0 p-[14px_16px_14px] rounded-2xl bg-[#fff] transition-all relative',
        'border border-border cursor-pointer',
        'hover:border-[#dfe2e8] hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)]',
        menuOpen && 'z-30',
      )}
      onClick={handleCardClick}
    >
      {/* 标题行：图标 + 标题 + 开关 */}
      <div className="flex items-start gap-2 mb-2">
        <Clock className="shrink-0 mt-[1px] text-muted-foreground" style={{ width: 18, height: 18 }} strokeWidth={1.75} />
        <h3 className="flex-1 min-w-0 m-0 text-[15px] font-bold leading-[1.35] tracking-[-0.02em] text-foreground inline-flex items-center">
          <button
            type="button"
            className="text-inherit no-underline cursor-pointer hover:underline bg-transparent border-none p-0 font-inherit"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(task);
            }}
            title="编辑任务"
          >
            {task.name}
          </button>
          {task.workflowName && (
            <span className="inline-flex items-center gap-[4px] ml-[6px] px-[7px] py-[1px] rounded-full text-[11px] font-medium leading-[1.55] text-[#4f46a8] bg-[#eeedfe] border border-[#dcd9f7] whitespace-nowrap">
              {task.workflowName}
            </span>
          )}
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={task.enabled}
          aria-pressed={task.enabled}
          aria-label="启用或暂停任务"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(!task.enabled);
          }}
          className={cn(
            'shrink-0 mt-[1px] w-9 h-5 p-0 border-none rounded-full cursor-pointer relative transition-colors',
            task.enabled ? 'bg-[#22c55e]' : 'bg-[#e5e7eb]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.15)] transition-transform',
              task.enabled && 'translate-x-4',
            )}
          />
        </button>
      </div>

      {/* 描述 */}
      <p className="m-0 mb-3 flex-1 text-[13px] leading-[1.5] text-muted-foreground line-clamp-2">
        {task.description}
      </p>

      {/* 底部：计划时间 + 操作按钮 */}
      <div className="flex items-center justify-between gap-3 mt-auto pt-2.5 border-t border-border text-xs">
        <span className="inline-flex items-center text-muted-foreground font-normal leading-[1.4]">
          {parseScheduleToLabel(task.cronExpr)}
        </span>
        <div className="inline-flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRun?.(task);
            }}
            className="inline-flex items-center justify-center min-h-[28px] px-2.5 border-none rounded-lg bg-[#f0f1f3] font-inherit text-xs font-medium text-foreground cursor-pointer transition-colors hover:bg-[#e6e8ec]"
          >
            <Play className="h-3 w-3 mr-1" />
            立即运行
          </button>
          <div className="relative" ref={menuRef} data-menu>
            <button
              type="button"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className="inline-flex items-center justify-center w-8 h-8 p-0 border-none rounded-[10px] bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 z-10 min-w-[132px] p-1.5 border border-border rounded-xl bg-background shadow-[0_10px_28px_rgba(15,23,42,0.12)]"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onEdit?.(task);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-lg text-[13px] text-foreground cursor-pointer transition-colors hover:bg-muted"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  编辑任务
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onDelete?.(task);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-lg text-[13px] text-destructive cursor-pointer transition-colors hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                  删除任务
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
