/**
 * RecordDetailModal 组件
 * 执行记录详情弹窗，展示任务执行的完整信息
 * 对应原型 .task-record-detail-modal
 */

import { useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { ExecutionRecord, RecordStatus } from '../types';

interface RecordDetailModalProps {
  /** 当前展示的记录，null 表示关闭 */
  record: ExecutionRecord | null;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

/** 状态 pill 配置（语义 token，亮暗色通用） */
const STATUS_PILL: Record<RecordStatus, { label: string; icon: string; className: string }> = {
  success: {
    label: '成功',
    icon: '✓',
    className: 'bg-success/10 text-success',
  },
  failed: {
    label: '失败',
    icon: '✕',
    className: 'bg-destructive/10 text-destructive',
  },
  running: {
    label: '执行中',
    icon: '',
    className: 'bg-primary/10 text-primary',
  },
};

/** 详情行组件 */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-[11px]">
      <span className="shrink-0 w-[84px] text-sm text-muted-foreground">{label}</span>
      <span className="flex-1 min-w-0 text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

export function RecordDetailModal({ record, onClose }: RecordDetailModalProps) {
  // Escape 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (record) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [record, handleKeyDown]);

  if (!record) return null;

  const pill = STATUS_PILL[record.status];
  const isFailed = record.status === 'failed' && record.failReason;

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-5">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/45"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 面板 */}
      <div
        className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-2xl border border-border bg-card shadow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-detail-title"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 id="record-detail-title" className="text-lg font-bold text-foreground m-0">
            执行记录详情
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="px-1 text-[22px] leading-none text-muted-foreground transition-colors hover:text-foreground"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* 内容 */}
        <div className="px-[22px] pt-[8px] pb-[22px]">
          <DetailRow label="任务名称">{record.taskName}</DetailRow>

          <DetailRow label="关联工作流">
            {record.workflowName || '-'}
          </DetailRow>

          <DetailRow label="执行状态">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[13px] font-medium',
                pill.className,
              )}
            >
              {pill.icon && <span>{pill.icon}</span>}
              {pill.label}
            </span>
          </DetailRow>

          <DetailRow label="执行时间">{record.startTime}</DetailRow>

          <DetailRow label="执行耗时">{record.duration}</DetailRow>

          {/* 失败原因：仅 failed 状态显示 */}
          {isFailed && (
            <DetailRow label="失败原因">
              <span className="text-destructive">{record.failReason}</span>
            </DetailRow>
          )}
        </div>
      </div>
    </div>
  );
}
