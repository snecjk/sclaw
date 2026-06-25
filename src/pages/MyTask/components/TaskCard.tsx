/**
 * TaskCard 组件
 * 我的任务 — 定时任务卡片（MasterGo 容器 7377）
 *
 * 结构：顶栏开关 + 更多菜单 → 标题/描述 → 弹性间距（≥18px）→ 底栏计划时间 + 下次执行
 */

import { useState, useRef, useEffect } from 'react';
import { Clock, Loader2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseScheduleToLabel } from '@/lib/schedule-label';
import {
  myTaskCardBodyClass,
  myTaskCardDescriptionClass,
  myTaskCardDetailFooterGapClass,
  myTaskCardFooterClass,
  myTaskCardMenuClass,
  myTaskCardMenuItemClass,
  myTaskCardNextRunClass,
  myTaskCardScheduleRowClass,
  myTaskCardShellClass,
  myTaskCardTitleClass,
  myTaskCardTopRowClass,
  myTaskWorkflowBadgeClass,
  scheduleToggleThumbClass,
  scheduleToggleTrackClass,
} from '@/lib/surfaces';
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
  /** 立即运行回调（返回 Promise 以驱动 loading） */
  onRun?: (task: TaskCardData) => Promise<void> | void;
  /** 开关切换回调 */
  onToggle?: (enabled: boolean) => void;
  /** 点击卡片回调（编辑） */
  onClick?: (task: TaskCardData) => void;
}

/** 将接口 nextRunAt 格式化为设计稿底栏文案 */
function formatNextRunLabel(nextRunAt: string | null, enabled: boolean): string | null {
  if (!enabled || nextRunAt === null) return null;
  const diffMs = new Date(nextRunAt).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return null;
  if (diffMs <= 0) return '即将执行';
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (hours < 24) return `下次执行${hours}小时内`;
  const days = Math.ceil(hours / 24);
  return `下次执行${days}天内`;
}

export function TaskCard({ task, onEdit, onDelete, onRun, onToggle, onClick }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [running, setRunning] = useState(false);
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
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-menu]')) return;
    onClick?.(task);
  };

  const scheduleLabel = task.scheduleText ?? parseScheduleToLabel(task.cronExpr);
  const nextRunLabel = formatNextRunLabel(task.nextRunAt, task.enabled);
  /** 关联工作流 code，用于显示"工作流"badge */
  const workflowId = task.workflowCode ?? null;

  return (
    <article
      className={cn(myTaskCardShellClass, 'cursor-pointer', menuOpen && 'z-30')}
      onClick={handleCardClick}
    >
      {/* 顶栏：开关（左）+ 未读红点 + 更多（右） */}
      <div className={myTaskCardTopRowClass}>
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
          className={scheduleToggleTrackClass(task.enabled)}
        >
          <span
            className={cn(scheduleToggleThumbClass, task.enabled && 'translate-x-4')}
          />
        </button>

        <div className="flex items-center gap-1.5 shrink-0">

        <div className="relative shrink-0" ref={menuRef} data-menu>
          <button
            type="button"
            aria-label="更多"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-[10px] border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen ? (
            <div className={myTaskCardMenuClass} role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={running}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (running) return;
                  setRunning(true);
                  try {
                    await onRun?.(task);
                  } finally {
                    setRunning(false);
                    setMenuOpen(false);
                  }
                }}
                className={cn(myTaskCardMenuItemClass(), running && 'opacity-50')}
              >
                {running ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    执行中…
                  </span>
                ) : (
                  '立即执行'
                )}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onEdit?.(task);
                }}
                className={myTaskCardMenuItemClass()}
              >
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
                className={myTaskCardMenuItemClass(true)}
              >
                删除任务
              </button>
            </div>
          ) : null}
        </div>
        </div>
      </div>

      {/* 标题 + 描述 */}
      <div className={myTaskCardBodyClass}>
        <h3 className={cn(myTaskCardTitleClass, 'flex items-center gap-0')}>
          <span className="truncate">{task.name}</span>
          {workflowId && (
            <span className={myTaskWorkflowBadgeClass}>
              <svg className="w-[11px] h-[11px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="6" cy="6" r="2.1" /><circle cx="18" cy="18" r="2.1" /><path d="M8 6h6.5a3 3 0 0 1 3 3v6.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              工作流
            </span>
          )}
        </h3>
        {task.description ? (
          <p className={myTaskCardDescriptionClass}>{task.description}</p>
        ) : null}
      </div>

      {/* 详情与底栏之间：最小 18px，同行等高时由此吸收高度差 */}
      <div className={myTaskCardDetailFooterGapClass} aria-hidden />

      {/* 底栏：计划时间 + 下次执行（贴壳层底，保留 p-4 底边距） */}
      <div className={myTaskCardFooterClass}>
        <span className={myTaskCardScheduleRowClass} title={scheduleLabel}>
          <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="truncate">{scheduleLabel}</span>
        </span>
        {nextRunLabel ? <span className={myTaskCardNextRunClass}>{nextRunLabel}</span> : null}
      </div>
    </article>
  );
}
