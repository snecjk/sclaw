/**
 * RecordDetailModal 组件
 * 执行记录详情弹窗，展示任务执行的完整信息
 * 对应原型 .task-record-detail-modal
 */

import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ExecutionRecord, RecordStatus } from '../types';

/** Format duration from milliseconds into a localized string */
function formatDurationI18n(
  durationMs: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (durationMs < 0) return '-';
  if (durationMs === 0) return t('myTask.recordItem.durationLessThanOneSecond');
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes > 0) {
    return t('myTask.recordItem.durationMinutesSeconds', { minutes, seconds: String(remainSeconds).padStart(2, '0') });
  }
  return t('myTask.recordItem.durationSeconds', { seconds });
}

interface RecordDetailModalProps {
  /** 当前展示的记录，null 表示关闭 */
  record: ExecutionRecord | null;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

/** 状态 pill 配置（语义 token，亮暗色通用） */
const STATUS_PILL: Record<RecordStatus, { i18nKey: string; icon: string; className: string }> = {
  success: {
    i18nKey: 'myTask.recordDetail.statusPill.success',
    icon: '✓',
    className: 'bg-success/10 text-success',
  },
  failed: {
    i18nKey: 'myTask.recordDetail.statusPill.failed',
    icon: '✕',
    className: 'bg-destructive/10 text-destructive',
  },
  running: {
    i18nKey: 'myTask.recordDetail.statusPill.running',
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
  const { t } = useTranslation('tasks');

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
            {t('myTask.recordDetail.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="px-1 text-[22px] leading-none text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('myTask.recordDetail.closeAria')}
          >
            ×
          </button>
        </div>

        {/* 内容 */}
        <div className="px-[22px] pt-[8px] pb-[22px]">
          <DetailRow label={t('myTask.recordDetail.taskName')}>{record.taskName}</DetailRow>

          <DetailRow label={t('myTask.recordDetail.workflow')}>
            {record.workflowName || '-'}
          </DetailRow>

          <DetailRow label={t('myTask.recordDetail.status')}>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[13px] font-medium',
                pill.className,
              )}
            >
              {pill.icon && <span>{pill.icon}</span>}
              {t(pill.i18nKey)}
            </span>
          </DetailRow>

          <DetailRow label={t('myTask.recordDetail.startTime')}>{record.startTime}</DetailRow>

          <DetailRow label={t('myTask.recordDetail.duration')}>{formatDurationI18n(record.durationMs, t)}</DetailRow>

          {/* 失败原因：仅 failed 状态显示 */}
          {isFailed && (
            <DetailRow label={t('myTask.recordDetail.failReason')}>
              <span className="text-destructive">{record.failReason}</span>
            </DetailRow>
          )}
        </div>
      </div>
    </div>
  );
}
