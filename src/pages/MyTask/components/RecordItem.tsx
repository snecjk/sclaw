/**
 * RecordItem 组件
 * 单条执行记录
 * 对应原型 .task-record
 */

import { cn } from '@/lib/utils';
import type { ExecutionRecord } from '../types';

interface RecordItemProps {
  /** 执行记录数据 */
  record: ExecutionRecord;
  /** 查看详情回调 */
  onViewDetail?: (record: ExecutionRecord) => void;
}

const STATUS_CONFIG = {
  running: { label: '执行中', dotClass: 'text-[#3b82f6]', textClass: 'text-[#3b82f6]' },
  success: { label: '执行成功', dotClass: 'text-[#22c55e]', textClass: 'text-[#22c55e]' },
  failed: { label: '执行失败', dotClass: 'text-[#ef4444]', textClass: 'text-[#ef4444]' },
};

export function RecordItem({ record, onViewDetail }: RecordItemProps) {
  const statusConfig = STATUS_CONFIG[record.status];

  return (
    <article className="flex items-center gap-3.5 p-[14px_16px] bg-[#fff] border border-border rounded-[12px]">
      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-[#111827]">
          {record.taskName}
          <span className={cn('inline-flex items-center gap-[5px] shrink-0 text-[12.5px] font-medium', statusConfig.textClass)}>
            <span
              className={cn(
                'shrink-0 rounded-full bg-current',
                record.status === 'running'
                  ? 'w-[11px] h-[11px] bg-transparent border-2 border-[rgba(59,130,246,0.3)] border-t-[#3b82f6] animate-[spin_0.7s_linear_infinite]'
                  : 'w-[7px] h-[7px]',
              )}
            />
            {statusConfig.label}
          </span>
        </div>
        <div className="mt-[3px] text-[12.5px] text-[#6b7280]">
          {record.startTime} · {record.status === 'running' ? `已运行 ${record.duration}` : record.status === 'failed' ? `失败${record.failReason ? ` · ${record.failReason}` : ''}` : `耗时 ${record.duration}`}
        </div>
      </div>

      {/* 查看详情 */}
      <button
        type="button"
        onClick={() => onViewDetail?.(record)}
        className="shrink-0 px-3.5 py-1.5 border border-border rounded-lg bg-white text-[13px] text-[#4b5563] font-family-inherit cursor-pointer transition-colors hover:border-[#c5cad3] hover:text-[#111827] hover:bg-[#f7f8fa]"
      >
        查看详情
      </button>
    </article>
  );
}
