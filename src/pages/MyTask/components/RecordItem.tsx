/**
 * RecordItem 组件
 * 单条执行记录
 * 对应原型 .task-record
 */

import { cn } from '@/lib/utils';
import { myTaskRecordDetailButtonClass, myTaskRecordItemShellClass } from '@/lib/surfaces';
import type { ExecutionRecord } from '../types';

interface RecordItemProps {
  /** 执行记录数据 */
  record: ExecutionRecord;
  /** 查看详情回调 */
  onViewDetail?: (record: ExecutionRecord) => void;
}

const STATUS_CONFIG = {
  running: { label: '执行中', textClass: 'text-primary' },
  success: { label: '执行成功', textClass: 'text-success' },
  failed: { label: '执行失败', textClass: 'text-destructive' },
} as const;

export function RecordItem({ record, onViewDetail }: RecordItemProps) {
  const statusConfig = STATUS_CONFIG[record.status];

  return (
    <article className={myTaskRecordItemShellClass}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <span className="truncate">{record.taskName}</span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-[5px] text-[12.5px] font-medium',
              statusConfig.textClass,
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
            {statusConfig.label}
          </span>
        </div>
        <div className="mt-[3px] text-[12.5px] text-muted-foreground">
          {record.startTime} ·{' '}
          {record.status === 'running'
            ? '进行中'
            : record.status === 'failed'
              ? `失败${record.failReason ? ` · ${record.failReason}` : ''}`
              : `耗时 ${record.duration}`}
        </div>
      </div>

      <button type="button" onClick={() => onViewDetail?.(record)} className={myTaskRecordDetailButtonClass}>
        查看详情
      </button>
    </article>
  );
}
