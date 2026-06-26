/**
 * RecordItem 组件
 * 单条执行记录
 * 对应原型 .task-record
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { myTaskRecordDetailButtonClass, myTaskRecordItemShellClass } from '@/lib/surfaces';
import { STATUS_I18N_KEY } from '../constants';
import type { ExecutionRecord } from '../types';

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

interface RecordItemProps {
  /** 执行记录数据 */
  record: ExecutionRecord;
  /** 查看详情回调 */
  onViewDetail?: (record: ExecutionRecord) => void;
}

export function RecordItem({ record, onViewDetail }: RecordItemProps) {
  const { t } = useTranslation('tasks');

  return (
    <article className={myTaskRecordItemShellClass}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <span className="truncate">{record.taskName}</span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-[5px] text-[12.5px] font-medium',
              record.status === 'running' ? 'text-primary' :
              record.status === 'success' ? 'text-success' : 'text-destructive',
            )}
          >
            <span
              className={cn(
                'shrink-0 rounded-full bg-current',
                record.status === 'running'
                  ? 'h-[11px] w-[11px] animate-spin border-2 border-primary/30 border-t-primary bg-transparent'
                  : 'h-[7px] w-[7px]',
              )}
            />
            {t(STATUS_I18N_KEY[record.status])}
          </span>
        </div>
        <div className="mt-[3px] text-[12.5px] text-muted-foreground">
          {record.startTime} ·{' '}
          {record.status === 'running'
            ? t('myTask.recordItem.inProgress')
            : record.status === 'failed'
              ? t('myTask.recordItem.failedWithReason', { reason: record.failReason || '' })
              : formatDurationI18n(record.durationMs, t)}
        </div>
      </div>

      <button type="button" onClick={() => onViewDetail?.(record)} className={myTaskRecordDetailButtonClass}>
        {t('myTask.recordItem.viewDetail')}
      </button>
    </article>
  );
}
